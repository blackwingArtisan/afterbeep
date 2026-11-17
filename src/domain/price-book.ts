import { formatCents } from './money';
import type { Cents, InvoiceLine, LineKind, LineUnit, PastInvoice } from './types';

/** A spoken price more than 40% away from the usual price holds the invoice. */
export const OUTLIER_TOLERANCE = 0.4;

export interface PriceHistoryPoint {
  date: string;
  invoiceNumber: string;
  unitPriceCents: Cents;
}

export interface PriceBookEntry {
  key: string;
  label: string;
  kind: LineKind;
  unit: LineUnit;
  count: number;
  medianCents: Cents;
  minCents: Cents;
  maxCents: Cents;
  lastCents: Cents;
  lastDate: string;
  history: PriceHistoryPoint[];
}

const STOP_WORDS = new Set([
  'a', 'an', 'the', 'new', 'replace', 'replaced', 'replacement', 'install', 'installed', 'of', 'for',
  'with', 'and', 'on', 'part', 'parts', 'my', 'your', 'one',
]);

const SYNONYMS: Record<string, string> = {
  labour: 'labor',
  fee: 'charge',
  callout: 'trip',
  service: 'trip',
  call: 'charge',
  hrs: 'hour',
  hr: 'hour',
};

function singular(word: string): string {
  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

/** Normalised item key: "Replaced the Dryer Belts" -> "dryer belt". */
export function itemKey(description: string): string {
  const words = description
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map(singular)
    .map((w) => SYNONYMS[w] ?? w)
    .filter((w) => !STOP_WORDS.has(w));
  return words.join(' ');
}

function median(sorted: readonly number[]): number {
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}

/** Builds the owner's price book from their invoice history. */
export function buildPriceBook(invoices: readonly PastInvoice[]): PriceBookEntry[] {
  const groups = new Map<string, { label: string; kind: LineKind; unit: LineUnit; points: PriceHistoryPoint[] }>();
  const ordered = [...invoices].sort((a, b) => a.date.localeCompare(b.date));
  for (const invoice of ordered) {
    for (const line of invoice.lines) {
      const key = line.kind === 'labor' ? 'labor' : itemKey(line.description);
      if (!key) continue;
      const group = groups.get(key) ?? { label: line.description, kind: line.kind, unit: line.unit, points: [] };
      group.label = line.description;
      group.points.push({ date: invoice.date, invoiceNumber: invoice.number, unitPriceCents: line.unitPriceCents });
      groups.set(key, group);
    }
  }
  const entries: PriceBookEntry[] = [];
  for (const [key, group] of groups) {
    const prices = group.points.map((p) => p.unitPriceCents).sort((a, b) => a - b);
    const last = group.points[group.points.length - 1]!;
    entries.push({
      key,
      label: group.kind === 'labor' ? 'Labor' : group.label,
      kind: group.kind,
      unit: group.unit,
      count: prices.length,
      medianCents: median(prices),
      minCents: prices[0]!,
      maxCents: prices[prices.length - 1]!,
      lastCents: last.unitPriceCents,
      lastDate: last.date,
      history: group.points,
    });
  }
  return entries.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

function similarity(a: string, b: string): number {
  const sa = new Set(a.split(' ').filter(Boolean));
  const sb = new Set(b.split(' ').filter(Boolean));
  if (sa.size === 0 || sb.size === 0) return 0;
  let shared = 0;
  for (const w of sa) if (sb.has(w)) shared += 1;
  return shared / (sa.size + sb.size - shared);
}

/** Finds the closest price-book entry for a line, or null when nothing is similar enough. */
export function findEntry(
  book: readonly PriceBookEntry[],
  description: string,
  kind: LineKind,
): PriceBookEntry | null {
  if (kind === 'labor') return book.find((e) => e.key === 'labor') ?? null;
  const key = itemKey(description);
  let best: PriceBookEntry | null = null;
  let bestScore = 0;
  for (const entry of book) {
    if (entry.kind === 'labor') continue;
    const score = similarity(key, entry.key);
    if (score > bestScore) {
      best = entry;
      bestScore = score;
    }
  }
  return bestScore >= 0.5 ? best : null;
}

/** Hourly prices compare only with hourly prices; "each" and "flat" are both per-item prices. */
export function unitsCompatible(a: LineUnit, b: LineUnit): boolean {
  return (a === 'hour') === (b === 'hour');
}

export function isOutlier(priceCents: Cents, usualCents: Cents): boolean {
  if (usualCents <= 0) return false;
  return Math.abs(priceCents - usualCents) / usualCents > OUTLIER_TOLERANCE;
}

export type PriceCheckStatus = 'ok' | 'filled' | 'new-item' | 'outlier' | 'confirmed' | 'missing-price';

export interface PriceOption {
  label: string;
  cents: Cents;
}

export interface PriceCheck {
  lineId: string;
  status: PriceCheckStatus;
  blocking: boolean;
  usualCents: Cents | null;
  historyCount: number;
  message: string;
  options: PriceOption[];
}

function unitSuffix(unit: LineUnit): string {
  return unit === 'hour' ? '/hr' : '';
}

/** Checks one line's unit price against the owner's own history. */
export function checkLine(line: InvoiceLine, book: readonly PriceBookEntry[]): PriceCheck {
  const entry = findEntry(book, line.description, line.kind);
  const base = { lineId: line.id, usualCents: entry?.medianCents ?? null, historyCount: entry?.count ?? 0 };
  const suffix = unitSuffix(line.unit);

  if (line.unitPriceCents <= 0) {
    return {
      ...base,
      status: 'missing-price',
      blocking: true,
      message: `No price heard for "${line.description}".`,
      options: entry ? [{ label: `Use usual ${formatCents(entry.medianCents)}${suffix}`, cents: entry.medianCents }] : [],
    };
  }
  if (!entry || !unitsCompatible(entry.unit, line.unit)) {
    return {
      ...base,
      status: 'new-item',
      blocking: false,
      message: 'No history for this item yet. It will join your price book once sent.',
      options: [],
    };
  }
  const usual = `${formatCents(entry.medianCents)}${suffix}`;
  const times = `${entry.count} past invoice${entry.count === 1 ? '' : 's'}`;
  if (!isOutlier(line.unitPriceCents, entry.medianCents)) {
    return {
      ...base,
      status: line.priceSource === 'price-book' ? 'filled' : 'ok',
      blocking: false,
      message:
        line.priceSource === 'price-book'
          ? `No price said, so your usual ${usual} was used (${times}).`
          : `Matches your usual ${usual} (${times}).`,
      options: [],
    };
  }
  const said = `${formatCents(line.unitPriceCents)}${suffix}`;
  if (line.confirmedPriceCents === line.unitPriceCents) {
    return { ...base, status: 'confirmed', blocking: false, message: `You confirmed ${said} (usually ${usual}).`, options: [] };
  }
  return {
    ...base,
    status: 'outlier',
    blocking: true,
    message: `You said ${said}, but you usually charge ${usual} (${times}).`,
    options: [
      { label: `Keep ${said}`, cents: line.unitPriceCents },
      { label: `Use usual ${usual}`, cents: entry.medianCents },
    ],
  };
}
