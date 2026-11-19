/**
 * AfterBeep's own MCP server, for Kiro and other agents working in this repository. It speaks MCP
 * over stdio (newline-delimited JSON-RPC 2.0) with no SDK, and exposes three read-only tools:
 *
 * - spec_coverage: which EARS criteria are named by tests, from `npm run spec:coverage`
 * - price_book_lookup: the demo business's usual price for an item, from its past invoices
 * - check_greeting: the outgoing-message checks and the honest-machine rule
 *
 * Run: node --import tsx scripts/mcp/afterbeep-mcp.ts
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { greetingChecks, greetingProblem, spokenSeconds } from '../../src/domain/greeting';
import { formatCents } from '../../src/domain/money';
import { buildPriceBook, findEntry } from '../../src/domain/price-book';
import { pastInvoices } from '../../src/server/seed';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const PROTOCOL_VERSION = '2025-06-18';

interface Request {
  jsonrpc: '2.0';
  id?: number | string;
  method: string;
  params?: Record<string, unknown>;
}

type ToolResult = { content: Array<{ type: 'text'; text: string }>; isError?: boolean };

const text = (t: string, isError = false): ToolResult => ({ content: [{ type: 'text', text: t }], ...(isError ? { isError } : {}) });

export const TOOLS = [
  {
    name: 'spec_coverage',
    description: 'Runs the spec coverage check: every EARS criterion in .kiro/specs and the test titles that name it. Reports MISSING criteria.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'price_book_lookup',
    description: "Looks up the demo business's usual price for an item (or labor) from its past invoices: median, range, count and each past invoice.",
    inputSchema: {
      type: 'object',
      properties: { item: { type: 'string', description: 'The item as spoken, such as "dryer belt" or "labor".' } },
      required: ['item'],
      additionalProperties: false,
    },
  },
  {
    name: 'check_greeting',
    description: 'Checks an outgoing message: says it is a machine, promises a text, asks for name, address and problem, under 25 seconds, and never claims a person is on the line.',
    inputSchema: {
      type: 'object',
      properties: { greeting: { type: 'string' } },
      required: ['greeting'],
      additionalProperties: false,
    },
  },
] as const;

function specCoverage(): ToolResult {
  const run = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/spec-coverage.ts'], { cwd: root, encoding: 'utf8' });
  return text(`${run.stdout}${run.stderr}`.trim(), run.status !== 0);
}

function priceBookLookup(item: string): ToolResult {
  const book = buildPriceBook(pastInvoices);
  const labor = /\blabou?r\b|\bhours?\b/i.test(item);
  const entry = findEntry(book, item, labor ? 'labor' : 'part');
  if (!entry) return text(`No past invoices for "${item}". A new item is marked new and is not held for that alone.`);
  const history = entry.history.map((h) => `  ${h.invoiceNumber} ${h.date} ${formatCents(h.unitPriceCents)}`).join('\n');
  return text(
    `${entry.label} (${entry.unit}): usually ${formatCents(entry.medianCents)} across ${entry.count} invoices, ` +
      `range ${formatCents(entry.minCents)}-${formatCents(entry.maxCents)}.\n${history}`,
  );
}

function checkGreeting(greeting: string): ToolResult {
  const lines = greetingChecks(greeting).map((c) => `${c.pass ? 'PASS' : 'MISS'} ${c.label}`);
  const problem = greetingProblem(greeting);
  lines.push(`About ${spokenSeconds(greeting)} seconds.`);
  lines.push(problem ? `REFUSED: ${problem}` : 'Can be saved.');
  return text(lines.join('\n'), problem !== null);
}

/** Handles one JSON-RPC message; returns the response, or null for a notification. */
export function handle(message: Request): object | null {
  const { id, method, params = {} } = message;
  if (id === undefined) return null;
  const ok = (result: object) => ({ jsonrpc: '2.0', id, result });
  const fail = (code: number, msg: string) => ({ jsonrpc: '2.0', id, error: { code, message: msg } });
  switch (method) {
    case 'initialize':
      return ok({
        protocolVersion: typeof params.protocolVersion === 'string' ? params.protocolVersion : PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: 'afterbeep', version: '0.1.0' },
      });
    case 'ping':
      return ok({});
    case 'tools/list':
      return ok({ tools: TOOLS });
    case 'tools/call': {
      const args = (params.arguments ?? {}) as Record<string, unknown>;
      if (params.name === 'spec_coverage') return ok(specCoverage());
      if (params.name === 'price_book_lookup' && typeof args.item === 'string') return ok(priceBookLookup(args.item));
      if (params.name === 'check_greeting' && typeof args.greeting === 'string') return ok(checkGreeting(args.greeting));
      return fail(-32602, `Unknown tool or bad arguments: ${String(params.name)}`);
    }
    default:
      return fail(-32601, `Method not found: ${method}`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const lines = createInterface({ input: process.stdin });
  lines.on('line', (line) => {
    if (!line.trim()) return;
    let response: object | null;
    try {
      response = handle(JSON.parse(line) as Request);
    } catch {
      response = { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } };
    }
    if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
  });
}
