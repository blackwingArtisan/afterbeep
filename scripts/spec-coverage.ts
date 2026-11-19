/**
 * Spec coverage: every EARS requirement in .kiro/specs must be named by at least one test,
 * or listed below with the reason it is checked another way.
 *
 * Tests name requirements in their titles, for example `it('[VI 3.4, 3.7] holds a labor rate...')`.
 * MC is the missed-call-booking spec and VI is the voice-invoicing spec.
 *
 * Usage: tsx scripts/spec-coverage.ts [--list]
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const SPECS = { MC: 'missed-call-booking', VI: 'voice-invoicing' } as const;
type Prefix = keyof typeof SPECS;

/** Requirements that live on the real AWS or Stripe path, which is type-checked but not called in tests. */
const CHECKED_ELSEWHERE: Record<string, string> = {
  'MC 1.1': 'Amazon Connect contact flow in infra/connect/ plays the greeting and beep; not run in tests.',
  'MC 2.1': 'Amazon Transcribe adapter is type-checked; calling it needs an AWS account.',
  'VI 5.3': 'Stripe test-mode adapter is type-checked; calling it needs a Stripe test key.',
  'VI 5.4': 'Stripe total check runs inside the Stripe adapter; calling it needs a Stripe test key.',
};

const root = process.cwd();

function requirementIds(prefix: Prefix): string[] {
  const text = readFileSync(join(root, '.kiro/specs', SPECS[prefix], 'requirements.md'), 'utf8');
  return [...text.matchAll(/^(\d+\.\d+) /gm)].map((m) => `${prefix} ${m[1]}`);
}

function testFiles(dir: string): string[] {
  return readdirSync(join(root, dir), { recursive: true, encoding: 'utf8' })
    .filter((f) => /\.(test|spec)\.ts$/.test(f))
    .map((f) => join(dir, f));
}

const named = new Map<string, Set<string>>();
for (const file of [...testFiles('tests/unit'), ...testFiles('tests/e2e')]) {
  const text = readFileSync(join(root, file), 'utf8');
  for (const [, prefix, ids = ''] of text.matchAll(/\[(MC|VI) ([\d., ]+)\]/g)) {
    for (const id of ids.split(',').map((s) => s.trim()).filter(Boolean)) {
      const key = `${prefix} ${id}`;
      if (!named.has(key)) named.set(key, new Set());
      named.get(key)!.add(file);
    }
  }
}

const all = (Object.keys(SPECS) as Prefix[]).flatMap(requirementIds);
const known = new Set(all);
const missing = all.filter((id) => !named.has(id) && !CHECKED_ELSEWHERE[id]);
const unknown = [...named.keys()].filter((id) => !known.has(id));
const covered = all.filter((id) => named.has(id)).length;

if (process.argv.includes('--list')) {
  for (const id of all) {
    const where = named.get(id);
    console.log(`${id.padEnd(8)} ${where ? [...where].join(', ') : CHECKED_ELSEWHERE[id] ? `elsewhere: ${CHECKED_ELSEWHERE[id]}` : 'MISSING'}`);
  }
}

console.log(
  `Spec coverage: ${covered} of ${all.length} requirements named by tests, ${Object.keys(CHECKED_ELSEWHERE).length} checked on the real-service path.`,
);
if (missing.length) console.error(`No test names: ${missing.join(', ')}`);
if (unknown.length) console.error(`Tests name requirements that do not exist: ${unknown.join(', ')}`);
process.exit(missing.length || unknown.length ? 1 : 0);
