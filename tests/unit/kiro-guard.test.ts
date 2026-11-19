import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { blockReason } from '../../scripts/kiro/guard-write.mjs';

const root = process.cwd();
const guard = join(root, 'scripts/kiro/guard-write.mjs');

/** Runs the PreToolUse guard exactly as Kiro does: the pending tool call as JSON on stdin. */
function runGuard(toolName: string, toolInput: Record<string, unknown>) {
  const event = { hook_event_name: 'PreToolUse', cwd: root, session_id: 'test', tool_name: toolName, tool_input: toolInput };
  const run = spawnSync(process.execPath, [guard], { input: JSON.stringify(event), encoding: 'utf8' });
  return { status: run.status, stderr: run.stderr };
}

// Each case starts a Node process, as Kiro does, so allow for a busy machine.
describe('Kiro agent guard (scripts/kiro/guard-write.mjs)', { timeout: 20_000 }, () => {
  it('blocks a write to .env and says why', () => {
    const result = runGuard('fs_write', { command: 'create', path: '.env', file_text: 'AFTERBEEP_SMS=aws\n' });
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/\.env holds secrets/);
  });

  it('blocks a write to .env.local given as an absolute path', () => {
    const result = runGuard('fs_write', { command: 'create', path: join(root, '.env.local'), file_text: 'X=1\n' });
    expect(result.status).toBe(2);
  });

  it('allows .env.example, which holds no secrets', () => {
    const result = runGuard('fs_write', { command: 'str_replace', path: '.env.example', old_str: 'a', new_str: 'b' });
    expect(result.status).toBe(0);
  });

  it('blocks a live Stripe secret key anywhere, including in a shell command', () => {
    const key = ['sk', 'live', '51Hx9FakeKeyForTests'].join('_');
    expect(runGuard('fs_write', { command: 'create', path: 'docs/notes.md', file_text: `key ${key}` }).status).toBe(2);
    expect(runGuard('execute_bash', { command: `export STRIPE_SECRET_KEY=${key}` }).status).toBe(2);
  });

  it('blocks a shell command that writes a .env file', () => {
    expect(runGuard('execute_bash', { command: 'echo AFTERBEEP_SMS=aws > .env' }).status).toBe(2);
    expect(runGuard('execute_bash', { command: 'cp .env.example .env.example.bak && ls' }).status).toBe(0);
  });

  it('blocks floating-point money in src/domain', () => {
    const parse = runGuard('str_replace', { path: 'src/domain/money.ts', old_str: 'x', new_str: 'const dollars = parseFloat(spoken);' });
    expect(parse.status).toBe(2);
    expect(parse.stderr).toMatch(/integer cents/);
    const scale = runGuard('fs_write', { command: 'create', path: 'src/domain/tax.ts', file_text: 'const taxCents = subtotalCents * 0.0575;' });
    expect(scale.status).toBe(2);
  });

  it('allows integer-cent money code and the same text outside src/domain', () => {
    const ok = runGuard('fs_write', { command: 'create', path: 'src/domain/tax.ts', file_text: 'const taxCents = roundDiv(subtotalCents * rateMilli, 100_000);' });
    expect(ok.status).toBe(0);
    expect(runGuard('fs_write', { command: 'create', path: 'docs/eval.md', file_text: 'parseFloat( is banned' }).status).toBe(0);
  });

  it('passes every file already in src/domain, so the guard never blocks working code', () => {
    for (const file of readdirSync(join(root, 'src/domain')).filter((f) => f.endsWith('.ts'))) {
      const path = `src/domain/${file}`;
      const event = { cwd: root, tool_name: 'fs_write', tool_input: { command: 'create', path, file_text: readFileSync(join(root, path), 'utf8') } };
      expect(blockReason(event), path).toBeNull();
    }
  });

  it('is wired into the tracked agent on every write tool and the shell', () => {
    const agent = JSON.parse(readFileSync(join(root, '.kiro/agents/afterbeep-builder.json'), 'utf8'));
    const pre = agent.hooks.find((h: { trigger: string }) => h.trigger === 'PreToolUse');
    expect(pre.action.command).toBe('node scripts/kiro/guard-write.mjs');
    for (const tool of ['fs_write', 'str_replace', 'execute_bash']) expect(new RegExp(pre.matcher).test(tool)).toBe(true);
    // Servers fetched from a registry are pinned to an exact version; the project's own runs from the repo.
    for (const server of Object.values(agent.mcpServers) as { args: string[] }[]) {
      if (server.args.some((a) => a.startsWith('scripts/'))) continue;
      expect(server.args.join(' ')).toMatch(/@\d+\.\d+\.\d+/);
    }
  });
});
