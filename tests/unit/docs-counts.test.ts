import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The counts the public docs quote must match the files they describe, so a new spec, criterion,
 * hook or Kiro session cannot leave a stale number behind.
 */
const read = (path: string) => readFileSync(path, 'utf8');
const files = (dir: string) => readdirSync(dir).filter((f) => !f.startsWith('.'));

const specs = files('.kiro/specs');
const criteriaPerSpec = specs.map((spec) => [...read(`.kiro/specs/${spec}/requirements.md`).matchAll(/^\d+\.\d+ /gm)].length);
const totalCriteria = criteriaPerSpec.reduce((a, b) => a + b, 0);
const checkedElsewhere = [...read('scripts/spec-coverage.ts').matchAll(/^\s+'(?:MC|VI|RR) [\d.]+':/gm)].length;
const traced = totalCriteria - checkedElsewhere;

const transcripts = files('docs/kiro-sessions');
const sessionNumber = (file: string) => Number(/^session-(\d+)-/.exec(file)![1]);
const lastSession = Math.max(...transcripts.map(sessionNumber));

const readme = read('README.md');
const kiroLog = read('KIRO-LOG.md');
const devpost = read('docs/launch/devpost.md');
const countedDocs = ['README.md', 'KIRO-LOG.md', 'docs/judging.md', 'docs/launch/devpost.md', 'docs/launch/dev-to.md', 'docs/launch/thread.md'];

/** Credits as each transcript's header records them, without the account balance in brackets. */
function transcriptCredits(file: string): number {
  const header = /credits used: (.*)/.exec(read(`docs/kiro-sessions/${file}`))![1]!.replace(/\(kiroween2026[^)]*\)/, '');
  return [...header.matchAll(/\d+\.\d+/g)].reduce((sum, m) => sum + Number(m[0]), 0);
}

describe('counts in the public docs', () => {
  it('quote only the real EARS criteria totals: all specs, or one spec', () => {
    const allowed = new Set([totalCriteria, ...criteriaPerSpec]);
    for (const doc of countedDocs) {
      // A row of the KIRO-LOG session table is history: it states what that session wrote.
      const current = read(doc).split('\n').filter((line) => !line.includes('](docs/kiro-sessions/session-'));
      for (const [, n] of current.join('\n').matchAll(/(\d+) EARS criteria/g)) {
        expect(allowed, `${doc} says ${n} EARS criteria`).toContain(Number(n));
      }
    }
    for (const doc of ['README.md', 'KIRO-LOG.md', 'docs/judging.md', 'docs/launch/devpost.md']) {
      expect(read(doc), doc).toContain(`${specs.length} specs`);
      expect(read(doc), doc).toContain(`${totalCriteria} EARS criteria`);
    }
  });

  it('quote the spec coverage line: criteria named by tests out of all criteria', () => {
    for (const [doc, text] of [['README.md', readme], ['KIRO-LOG.md', kiroLog], ['docs/launch/devpost.md', devpost]]) {
      expect(text, doc).toContain(`${traced} of ${totalCriteria}`);
    }
  });

  it('quote the steering, hook and MCP server counts in .kiro', () => {
    const mcpServers = Object.keys(JSON.parse(read('.kiro/settings/mcp.json')).mcpServers).length;
    expect(readme).toContain(`**${files('.kiro/steering').length} steering files:**`);
    expect(readme).toContain(`**${files('.kiro/hooks').length} IDE hooks**`);
    expect(readme).toContain(`**${mcpServers} MCP servers:**`);
  });

  it('list every Kiro session transcript in the KIRO-LOG table, with its credits', () => {
    const rows = [...kiroLog.matchAll(/^\| \[(\d+)\]\(docs\/kiro-sessions\/([^)]+)\) \|.*\| ([\d.]+)[^|]*\|$/gm)];
    expect(rows.map((r) => r[2]).sort()).toEqual([...transcripts].sort());
    for (const [, session, file, credits] of rows) {
      expect(sessionNumber(file!), file).toBe(Number(session));
      expect(Number(credits), file).toBeCloseTo(transcriptCredits(file!), 1);
    }
    expect(kiroLog).toContain(`| Kiro sessions (kiro-cli) | ${lastSession} so far |`);
  });

  it('quote the total Kiro credits the transcripts add up to', () => {
    const total = transcripts.reduce((sum, f) => sum + transcriptCredits(f), 0).toFixed(1);
    expect(kiroLog).toContain(`${total} credits`);
    expect(devpost).toContain(`${total} credits`);
  });
});
