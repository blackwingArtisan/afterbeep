import { describe, expect, it } from 'vitest';
import { SEEDED_SUFFIXES, STORY_CALLER_SUFFIXES, storyCallerId } from '../../src/domain/story-caller';
import { toE164 } from '../../src/domain/voicemail-rules';
import { demoBusiness } from '../../src/server/seed';
import { seedDb } from '../../src/server/seed-db';

const NOW = new Date('2026-11-18T23:00:00Z');

describe('the story caller ID', () => {
  it('never reuses a number from the demo data, so every graveyard ghost stays in the graveyard', async () => {
    let n = 0;
    const db = await seedDb(NOW, () => `id-${n++}`, 'https://afterbeep.example.com');
    const seeded = new Set<string>([toE164(demoBusiness.phone)!]);
    for (const m of db.messages) {
      seeded.add(m.from);
      if (m.extraction.callbackNumber) seeded.add(toE164(m.extraction.callbackNumber)!);
    }
    for (const suffix of STORY_CALLER_SUFFIXES) {
      expect(seeded.has(toE164(`(614) 555-01${suffix}`)!), `555-01${suffix} is seeded`).toBe(false);
    }
    const seededSuffixes = [...seeded].filter((e164) => e164.startsWith('+16145550')).map((e164) => Number(e164.slice(-2)));
    for (const suffix of seededSuffixes) expect(SEEDED_SUFFIXES.has(suffix), `seeded 555-01${suffix} is listed`).toBe(true);
  });

  it('covers the whole range of free numbers', () => {
    expect(storyCallerId(() => 0)).toBe(`(614) 555-01${STORY_CALLER_SUFFIXES[0]}`);
    expect(storyCallerId(() => 0.999999)).toBe(`(614) 555-01${STORY_CALLER_SUFFIXES.at(-1)}`);
    expect(STORY_CALLER_SUFFIXES).toHaveLength(90 - SEEDED_SUFFIXES.size);
    expect(STORY_CALLER_SUFFIXES).not.toContain(16);
  });
});
