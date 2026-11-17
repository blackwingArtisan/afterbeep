import { formatCents } from './money';
import { parseInvoiceSpeech } from './invoice-parser';
import { checkLine, findEntry, isOutlier, unitsCompatible, type PriceBookEntry, type PriceCheck } from './price-book';
import { computeTotals } from './tax';
import type { InvoiceLine, InvoiceTotals } from './types';

export interface DraftContext {
  book: readonly PriceBookEntry[];
  laborTaxable: boolean;
  taxRateMilli: number;
  newId: () => string;
}

export interface Quote {
  lines: InvoiceLine[];
  checks: PriceCheck[];
  totals: InvoiceTotals;
  /** True while any line needs the owner's decision. Sending is refused while blocked. */
  blocked: boolean;
}

export interface InvoiceDraft extends Quote {
  title: string | null;
  heard: string;
}

/** Re-checks (possibly edited) lines and recomputes totals. Pure; the server calls this before sending. */
export function quoteLines(lines: readonly InvoiceLine[], ctx: Pick<DraftContext, 'book' | 'taxRateMilli'>): Quote {
  const checks = lines.map((line) => checkLine(line, ctx.book));
  const totals = computeTotals(lines, ctx.taxRateMilli);
  const blocked = lines.length === 0 || checks.some((c) => c.blocking);
  return { lines: [...lines], checks, totals, blocked };
}

/**
 * Uses the price book to settle what the speaker meant, without inventing prices:
 * - no price said: fill in the usual price (marked as from the price book);
 * - ambiguous phrase ("twelve fifty"): pick the reading that matches history.
 */
function settleWithHistory(line: InvoiceLine, book: readonly PriceBookEntry[]): InvoiceLine {
  const entry = findEntry(book, line.description, line.kind);
  if (!entry || !unitsCompatible(entry.unit, line.unit)) return line;
  if (line.unitPriceCents === 0) {
    return { ...line, unitPriceCents: entry.medianCents, priceSource: 'price-book' };
  }
  if (isOutlier(line.unitPriceCents, entry.medianCents)) {
    const better = line.alternativesCents.find((alt) => !isOutlier(alt, entry.medianCents));
    if (better !== undefined) {
      return {
        ...line,
        unitPriceCents: better,
        alternativesCents: [line.unitPriceCents, ...line.alternativesCents.filter((a) => a !== better)],
        note: `Heard "${line.heard}" as ${formatCents(better)}, which matches your usual ${formatCents(entry.medianCents)}.`,
      };
    }
  }
  return line;
}

export function draftFromSpeech(speech: string, ctx: DraftContext): InvoiceDraft {
  const parsed = parseInvoiceSpeech(speech, { laborTaxable: ctx.laborTaxable, newId: ctx.newId });
  const lines = parsed.lines.map((line) => settleWithHistory(line, ctx.book));
  return { title: parsed.title, heard: speech, ...quoteLines(lines, ctx) };
}
