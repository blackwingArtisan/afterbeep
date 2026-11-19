/**
 * Scores the voicemail extractors against hand-labelled voicemails in eval/voicemails.json.
 *
 * By default it scores only the free rules extractor, offline. With --bedrock it also scores the
 * Amazon Bedrock extractor side by side; that makes one paid model call per voicemail, so it also
 * needs AFTERBEEP_EVAL_PAID=1 and AWS credentials.
 *
 * Usage: tsx scripts/eval-extractor.ts [--misses] [--bedrock]
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { extractWithRules } from '../src/domain/voicemail-rules';
import type { VoicemailExtraction } from '../src/domain/types';
import { demoBusiness } from '../src/server/seed';

const FIELDS = ['callerName', 'callbackNumber', 'address', 'jobCategory', 'urgency'] as const;
type Field = (typeof FIELDS)[number];

interface Case {
  id: string;
  transcript: string;
  callerId?: string;
  expect: Record<Field, string | null>;
}

interface Score {
  right: Record<Field, number>;
  allRight: number;
  invented: number;
  fellBack: number;
  misses: string[];
}

/** Compare the way a person would: ignore case, punctuation and how a unit is spelled. */
function normalise(field: Field, value: string | null): string | null {
  if (value === null) return null;
  let v = value.toLowerCase().replace(/[.,#]/g, ' ');
  if (field === 'address') v = v.replace(/\b(apartment|apt|unit|suite|ste)\b/g, 'unit');
  return v.replace(/\s+/g, ' ').trim();
}

async function score(cases: Case[], extract: (c: Case) => Promise<VoicemailExtraction>): Promise<Score> {
  const s: Score = { right: { callerName: 0, callbackNumber: 0, address: 0, jobCategory: 0, urgency: 0 }, allRight: 0, invented: 0, fellBack: 0, misses: [] };
  for (const c of cases) {
    const got = await extract(c);
    if (got.fallbackReason) s.fellBack++;
    let caseRight = true;
    for (const f of FIELDS) {
      const want = normalise(f, c.expect[f]);
      const have = normalise(f, (got[f] as string | null) ?? null);
      if (want === have) s.right[f]++;
      else {
        caseRight = false;
        s.misses.push(`${c.id} ${f}: expected ${JSON.stringify(c.expect[f])}, got ${JSON.stringify(got[f])}`);
      }
    }
    if (caseRight) s.allRight++;
    // An address the caller never gave is the one mistake that sends a tech to the wrong house.
    if (c.expect.address === null && got.address !== null) s.invented++;
  }
  return s;
}

const { cases } = JSON.parse(readFileSync(join(process.cwd(), 'eval/voicemails.json'), 'utf8')) as { cases: Case[] };
const callerIdOf = (c: Case) => c.callerId ?? '+16145550100';
const columns: Array<[name: string, score: Score]> = [
  ['Rules', await score(cases, async (c) => extractWithRules(c.transcript, { callerId: callerIdOf(c), defaultAreaCode: '614' }))],
];

if (process.argv.includes('--bedrock')) {
  if (process.env.AFTERBEEP_EVAL_PAID !== '1') {
    console.error('--bedrock makes one paid Bedrock call per voicemail. Set AFTERBEEP_EVAL_PAID=1 to run it.');
    process.exit(2);
  }
  const { BedrockExtractor } = await import('../src/adapters/extractor/bedrock');
  const modelId = process.env.AFTERBEEP_BEDROCK_MODEL ?? 'amazon.nova-lite-v1:0';
  const bedrock = new BedrockExtractor({ region: process.env.AWS_REGION ?? 'us-east-1', modelId, log: () => {} });
  columns.push([modelId, await score(cases, (c) => bedrock.extract(c.transcript, { callerId: callerIdOf(c), business: demoBusiness }))]);
}

const pct = (n: number) => `${n} of ${cases.length} (${Math.round((n / cases.length) * 100)}%)`;
const row = (label: string, values: string[]) => console.log(`  ${label.padEnd(17)} ${values.map((v) => v.padEnd(16)).join(' ')}`);
console.log(`Extractors on ${cases.length} labelled voicemails`);
row('', columns.map(([name]) => name));
for (const f of FIELDS) row(f, columns.map(([, s]) => pct(s.right[f])));
row('every field', columns.map(([, s]) => pct(s.allRight)));
row('invented address', columns.map(([, s]) => String(s.invented)));
if (columns.length > 1) row('fell back', columns.map(([, s]) => String(s.fellBack)));
if (process.argv.includes('--misses')) {
  for (const [name, s] of columns) for (const m of s.misses) console.log(`  miss [${name}] ${m}`);
}
