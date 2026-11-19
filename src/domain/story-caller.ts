/**
 * Last two digits of the (614) 555-01xx numbers the demo data already uses: seeded callers and
 * their call-back numbers, last week's hang-ups in the graveyard and the business line. The story's
 * caller never reuses one, or the demo would treat her as a caller who already got through.
 */
export const SEEDED_SUFFIXES: ReadonlySet<number> = new Set([10, 15, 16, 21, 23, 27, 34, 42, 46, 52, 63, 68, 77, 79, 85, 88, 93]);

/** The suffixes left for the story's caller. */
export const STORY_CALLER_SUFFIXES: readonly number[] = Array.from({ length: 90 }, (_, i) => i + 10).filter((n) => !SEEDED_SUFFIXES.has(n));

/**
 * A fresh caller ID in the 555-01xx range reserved for fiction, so the story can run again without
 * the 10-minute text cooldown, and never one of the seeded numbers.
 */
export function storyCallerId(random: () => number = Math.random): string {
  const index = Math.min(STORY_CALLER_SUFFIXES.length - 1, Math.floor(random() * STORY_CALLER_SUFFIXES.length));
  return `(614) 555-01${STORY_CALLER_SUFFIXES[index]}`;
}
