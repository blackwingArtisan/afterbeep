#!/usr/bin/env node
/**
 * PostToolUse hook for the afterbeep-builder Kiro agent: after the agent writes a file under src/
 * or tests/unit/, run the unit suite and hand a failure back to the agent. Other writes (docs,
 * specs, steering) skip the run so spec work stays fast.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

let event = {};
try {
  event = JSON.parse(readFileSync(0, 'utf8') || '{}');
} catch {
  // An unreadable event is treated like a source write: run the tests.
}
const cwd = typeof event.cwd === 'string' ? event.cwd : process.cwd();
const raw = event.tool_input?.path ?? event.tool_input?.file_path ?? '';
const path = raw ? relative(cwd, isAbsolute(raw) ? raw : resolve(cwd, raw)).split(sep).join('/') : '';

if (path && !/^(src|tests\/unit)\//.test(path)) process.exit(0);

const run = spawnSync('npm', ['test', '--silent'], { cwd, encoding: 'utf8' });
const tail = `${run.stdout ?? ''}${run.stderr ?? ''}`.trim().split('\n').slice(-25).join('\n');
if (run.status === 0) {
  process.stdout.write(`Unit tests pass after writing ${path || 'a file'}.\n`);
} else {
  process.stderr.write(`Unit tests fail after writing ${path || 'a file'}. Fix this before the next task.\n${tail}\n`);
  process.exit(1);
}
