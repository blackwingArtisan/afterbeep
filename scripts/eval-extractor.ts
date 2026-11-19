/**
 * Scores the rules extractor against hand-labelled voicemails in eval/voicemails.json.
 * Free and offline: it runs only the local rules, never a paid model.
 *
 * Usage: tsx scripts/eval-extractor.ts [--misses]
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { extractWithRules } from '../src/domain/voicemail-rules';
import type { VoicemailExtraction } from '../src/domain/types';

const FIELDS = ['callerName', 'callbackNumber', 'address', 'jobCategory', 'urgency'] as const;
type Field = (typeof FIELDS)[number];

interface Case {
  id: string;
  transcript: string;
  callerId?: string;
  expect: Record<Field, string | null>;
}

/** Compare the way a person would: ignore case, punctuation and how a unit is spelled. */
function normalise(field: Field, value: string | null): string | null {
  if (value === null) return null;
  let v = value.toLowerCase().replace(/[.,#]/g, ' ');
  if (field === 'address') v = v.replace(/\b(apartment|apt|unit|suite|ste)\b/g, 'unit');
  return v.replace(/\s+/g, ' ').trim();
}

const { cases } = JSON.parse(readFileSync(join(process.cwd(), 'eval/voicemails.json'), 'utf8')) as { cases: Case[] };
const right: Record<Field, number> = { callerName: 0, callbackNumber: 0, address: 0, jobCategory: 0, urgency: 0 };
const misses: string[] = [];
let allRight = 0;
let invented = 0;

for (const c of cases) {
  const got: VoicemailExtraction = extractWithRules(c.transcript, { callerId: c.callerId ?? '+16145550100', defaultAreaCode: '614' });
  let caseRight = true;
  for (const f of FIELDS) {
    const want = normalise(f, c.expect[f]);
    const have = normalise(f, (got[f] as string | null) ?? null);
    if (want === have) right[f]++;
    else {
      caseRight = false;
      misses.push(`${c.id} ${f}: expected ${JSON.stringify(c.expect[f])}, got ${JSON.stringify(got[f])}`);
    }
  }
  if (caseRight) allRight++;
  // An address the caller never gave is the one mistake that sends a tech to the wrong house.
  if (c.expect.address === null && got.address !== null) invented++;
}

const pct = (n: number) => `${n} of ${cases.length} (${Math.round((n / cases.length) * 100)}%)`;
console.log(`Rules extractor on ${cases.length} labelled voicemails`);
for (const f of FIELDS) console.log(`  ${f.padEnd(15)} ${pct(right[f])}`);
console.log(`  ${'every field'.padEnd(15)} ${pct(allRight)}`);
console.log(`  ${'invented address'.padEnd(15)} ${invented}`);
if (process.argv.includes('--misses')) for (const m of misses) console.log(`  miss ${m}`);
