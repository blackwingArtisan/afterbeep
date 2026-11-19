#!/usr/bin/env node
/**
 * PreToolUse guard for the afterbeep-builder Kiro agent (.kiro/agents/afterbeep-builder.json).
 *
 * Kiro passes the pending tool call as JSON on stdin ({ hook_event_name, cwd, tool_name, tool_input }).
 * A nonzero exit blocks the call, and stderr is returned to the agent as the reason. This guard blocks:
 *   1. any write to a .env file (only .env.example is tracked),
 *   2. any write or shell command that contains a live Stripe secret key (sk_live_...),
 *   3. floating-point money in src/domain: parseFloat, or a cents amount multiplied or divided
 *      by a decimal literal. Money is integer cents; see .kiro/steering/money.md.
 *
 * Everything else exits 0. The same rules run in tests/unit/kiro-guard.test.ts.
 */
import { readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

const LIVE_KEY = /\b[sr]k_live_[A-Za-z0-9]{8,}/;
const ENV_FILE = /(^|\/)\.env(\.[\w.-]+)?$/;
const FLOAT_MONEY = [
  { pattern: /\bparseFloat\s*\(/, why: 'parseFloat turns money into a float' },
  { pattern: /cents\w*\s*[*/]\s*\d*\.\d+/i, why: 'a cents amount is scaled by a decimal literal' },
  { pattern: /\d*\.\d+\s*\*\s*\w*cents/i, why: 'a decimal literal scales a cents amount' },
];

function textOf(input) {
  if (!input || typeof input !== 'object') return '';
  return ['file_text', 'content', 'new_str', 'text', 'command']
    .map((key) => (typeof input[key] === 'string' ? input[key] : ''))
    .join('\n');
}

function repoPath(cwd, path) {
  if (typeof path !== 'string' || path === '') return null;
  const full = isAbsolute(path) ? path : resolve(cwd, path);
  return relative(cwd, full).split(sep).join('/');
}

/** Returns the reason a tool call must be blocked, or null when it may run. */
export function blockReason(event) {
  const cwd = typeof event.cwd === 'string' ? event.cwd : process.cwd();
  const input = event.tool_input ?? {};
  const text = textOf(input);
  const path = repoPath(cwd, input.path ?? input.file_path);

  if (LIVE_KEY.test(text)) {
    return 'Blocked: this change contains a live Stripe secret key. AfterBeep only ever uses Stripe test keys, read from the environment.';
  }
  if (path && ENV_FILE.test(path) && !path.endsWith('.env.example')) {
    return `Blocked: ${path} holds secrets and is never written by an agent. Add new settings to .env.example instead.`;
  }
  if (event.tool_name === 'execute_bash' && /(>|\btee\b|\bcp\b|\bmv\b|\bsed\s+-i)[^\n|;&]*\.env(?!\.example)\b/.test(text)) {
    return 'Blocked: this shell command writes a .env file. Add new settings to .env.example instead.';
  }
  if (path && path.startsWith('src/domain/')) {
    const hit = FLOAT_MONEY.find(({ pattern }) => pattern.test(text));
    if (hit) {
      return `Blocked: ${hit.why} in ${path}. Money is integer cents: use roundDiv, lineAmountCents and rates in thousandths of a percent from src/domain/money.ts and tax.ts.`;
    }
  }
  return null;
}

function main() {
  let event;
  try {
    event = JSON.parse(readFileSync(0, 'utf8') || '{}');
  } catch {
    process.stderr.write('Blocked: the hook could not read the tool call.\n');
    process.exit(2);
  }
  const reason = blockReason(event);
  if (reason) {
    process.stderr.write(`${reason}\n`);
    process.exit(2);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
