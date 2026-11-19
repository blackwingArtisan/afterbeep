import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { handle } from '../../scripts/mcp/afterbeep-mcp';

const root = join(__dirname, '../..');
const call = (name: string, args: Record<string, unknown> = {}) =>
  handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) as { result?: { content: { text: string }[]; isError?: boolean }; error?: { code: number } };

describe('AfterBeep MCP server (scripts/mcp/afterbeep-mcp.ts)', { timeout: 30_000 }, () => {
  it('lists its three tools', () => {
    const res = handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) as { result: { tools: { name: string }[] } };
    expect(res.result.tools.map((t) => t.name)).toEqual(['spec_coverage', 'price_book_lookup', 'check_greeting']);
  });

  it('[VI 3.4] looks up the usual price the voice invoice holds a wrong price against', () => {
    const text = call('price_book_lookup', { item: 'dryer belt' }).result!.content[0]!.text;
    expect(text).toContain('usually $50.00 across 4 invoices');
    expect(text).toContain('range $49.50-$52.00');
    expect(call('price_book_lookup', { item: 'labor' }).result!.content[0]!.text).toMatch(/usually \$85\.00/);
    expect(call('price_book_lookup', { item: 'flux capacitor' }).result!.content[0]!.text).toContain('No past invoices');
  });

  it('[MC 10.3, 10.4] checks a greeting and refuses one that pretends to be a person', () => {
    expect(call('check_greeting', { greeting: "Hi, you've reached Morgan. Leave a message." }).result!.content[0]!.text).toContain('MISS Says it is a machine');
    const fake = call('check_greeting', { greeting: 'Hi, this is the receptionist. Leave your name.' }).result!;
    expect(fake.isError).toBe(true);
    expect(fake.content[0]!.text).toContain('REFUSED');
  });

  it('answers unknown tools and methods with JSON-RPC errors, and ignores notifications', () => {
    expect(call('nope').error!.code).toBe(-32602);
    expect((handle({ jsonrpc: '2.0', id: 2, method: 'resources/list' }) as { error: { code: number } }).error.code).toBe(-32601);
    expect(handle({ jsonrpc: '2.0', method: 'notifications/initialized' })).toBeNull();
  });

  it('speaks MCP over stdio and runs the spec coverage check', async () => {
    const child = spawn(process.execPath, ['--import', 'tsx', 'scripts/mcp/afterbeep-mcp.ts'], { cwd: root });
    const replies: Array<{ id: number; result: Record<string, unknown> }> = [];
    let buffer = '';
    child.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      let nl;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        replies.push(JSON.parse(buffer.slice(0, nl)));
        buffer = buffer.slice(nl + 1);
      }
    });
    const send = (m: object) => child.stdin.write(`${JSON.stringify(m)}\n`);
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } } });
    send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'spec_coverage', arguments: {} } });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timed out with ${replies.length} replies`)), 25_000);
      const check = setInterval(() => {
        if (replies.length >= 2) {
          clearInterval(check);
          clearTimeout(timer);
          resolve();
        }
      }, 50);
    });
    child.kill();
    expect(replies[0]!.result).toMatchObject({ protocolVersion: '2025-06-18', serverInfo: { name: 'afterbeep' } });
    const coverage = replies[1]!.result as { content: { text: string }[]; isError?: boolean };
    expect(coverage.isError).toBeUndefined();
    expect(coverage.content[0]!.text).toMatch(/Spec coverage: \d+ of \d+ requirements named by tests/);
  });

  it('is registered for the IDE and for the builder agent', () => {
    const ide = JSON.parse(readFileSync(join(root, '.kiro/settings/mcp.json'), 'utf8'));
    const agent = JSON.parse(readFileSync(join(root, '.kiro/agents/afterbeep-builder.json'), 'utf8'));
    for (const config of [ide.mcpServers.afterbeep, agent.mcpServers.afterbeep]) {
      expect(config.args).toContain('scripts/mcp/afterbeep-mcp.ts');
    }
    expect(agent.tools).toContain('@afterbeep');
    expect(agent.allowedTools).toContain('@afterbeep');
  });
});
