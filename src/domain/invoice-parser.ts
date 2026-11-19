import { isNumberWord, lexNumbers, tokenize, type NumberToken, type Token } from './spoken-numbers';
import type { InvoiceLine, LineKind, LineUnit } from './types';

/**
 * Turns a spoken invoice into draft line items. This step only labels words: it decides which
 * number is a quantity and which is a unit price. It never adds, multiplies or taxes anything.
 */

export interface ParsedInvoice {
  title: string | null;
  lines: InvoiceLine[];
}

export interface ParseOptions {
  laborTaxable: boolean;
  newId: () => string;
}

const HOUR_WORDS = new Set(['hour', 'hours', 'hr', 'hrs']);
const MINUTE_WORDS = new Set(['minute', 'minutes', 'min', 'mins']);
const LABOR_WORDS = new Set(['labor', 'labour', ...HOUR_WORDS, ...MINUTE_WORDS]);
const PRICE_BEFORE = new Set(['at', '@', 'for', 'is', 'costs', 'cost', 'price', 'priced', 'charge']);
const PRICE_AFTER = new Set(['each', 'apiece', 'ea']);
const RATE_WORDS = new Set(['an', 'a', 'per']);
const QTY_MARKERS = new Set(['x', 'times']);
/** A number right before one of these is a size that belongs to the part name ("40 gallon", "50 amp"), not a quantity. */
const SIZE_WORDS = new Set([
  'gallon', 'gallons', 'gal', 'inch', 'inches', 'amp', 'amps', 'volt', 'volts', 'ton', 'tons', 'btu', 'watt', 'watts', 'psi', 'mm',
]);
const FILLER = new Set([
  'at', '@', 'for', 'each', 'apiece', 'ea', 'per', 'an', 'a', 'x', 'times', 'the', 'and', 'of', 'um', 'uh',
  'dollars', 'dollar', 'bucks', 'buck', 'cents', 'cent', 'is', 'costs', 'cost', 'price', 'priced', 'that', 'was',
  'okay', 'ok', 'so', 'then', 'with', 'plus', 'also', 'next',
]);
const FEE_PHRASES: ReadonlyArray<readonly [RegExp, string]> = [
  [/\btrip (charge|fee)\b/, 'Trip charge'],
  [/\bservice (call|fee|charge)\b/, 'Service call'],
  [/\bdiagnostic( fee)?\b/, 'Diagnostic fee'],
  [/\bhaul ?away( fee)?\b/, 'Haul-away fee'],
  [/\bdisposal fee\b/, 'Disposal fee'],
  [/\bpermit( fee)?\b/, 'Permit fee'],
  [/\b(after hours|emergency) (fee|charge|surcharge)\b/, 'After-hours fee'],
];

const TAX_YES = /\b(taxed|taxable|plus tax|with tax|add tax)\b/;
const TAX_NO = /\b(no tax|not taxed|tax free|tax exempt|untaxed|non taxable|nontaxable)\b/;
const TAX_WORDS = /\b(taxed|taxable|plus tax|with tax|add tax|no tax|not taxed|tax free|tax exempt|untaxed|non taxable|nontaxable)\b/g;

const hasNumber = (words: readonly string[]): boolean => lexNumbers(words).some((t) => t.type === 'num');
const isNumeric = (word: string | undefined): boolean =>
  word !== undefined && (/^\$?\d/.test(word) || (isNumberWord(word) && word !== 'oh'));
const SCALE_WORDS = new Set(['hundred', 'thousand']);
/** Words that continue the number before them, so "and fifteen minutes" is not a new item. */
const CONTINUES_NUMBER = new Set(['cent', 'cents', 'dollar', 'dollars', 'buck', 'bucks', 'minute', 'minutes', 'min', 'mins']);

/**
 * True when the "and" at `index` separates two priced items, as in "ninety nine dollars and a
 * thermostat for forty" or "one hour and two dryer belts at fifty". It stays inside one item for
 * "three hundred and twenty nine", "ninety dollars and fifty cents", "two and a half hours" and
 * "an hour and fifteen minutes".
 */
function andStartsNewItem(words: readonly string[], index: number): boolean {
  const left = words.slice(0, index);
  const right = words.slice(index + 1);
  const prev = left[left.length - 1];
  const next = right[0];
  if (!hasNumber(left) || next === undefined) return false;
  if (next === 'half' || (next === 'a' && right[1] === 'half')) return false;
  if (prev !== undefined && SCALE_WORDS.has(prev) && isNumeric(next)) return false;
  if (isNumeric(next)) {
    let k = 0;
    while (k < right.length && (isNumeric(right[k]) || (right[k] === 'and' && isNumeric(right[k + 1])))) k += 1;
    const after = right[k];
    if (after === undefined || CONTINUES_NUMBER.has(after)) return false;
  }
  const rightText = right.join(' ');
  return hasNumber(right) || right.some((w) => LABOR_WORDS.has(w)) || FEE_PHRASES.some(([re]) => re.test(rightText));
}

/** Splits one comma-free phrase at each "and" that starts a new item. */
function splitOnAnd(segment: string): string[] {
  const words = tokenize(segment);
  const cuts = new Set<number>();
  let andCount = 0;
  for (const [i, w] of words.entries()) {
    if (w !== 'and') continue;
    if (andStartsNewItem(words, i)) cuts.add(andCount);
    andCount += 1;
  }
  if (cuts.size === 0) return [segment];
  const parts: string[] = [];
  let from = 0;
  let seen = 0;
  for (const match of segment.matchAll(/\band\b/gi)) {
    if (cuts.has(seen)) {
      parts.push(segment.slice(from, match.index));
      from = match.index + match[0].length;
    }
    seen += 1;
  }
  parts.push(segment.slice(from));
  return parts.map((p) => p.trim()).filter((p) => p.length > 0);
}

/** Splits a spoken invoice into one phrase per line item. */
export function splitSegments(text: string): string[] {
  const raw = text
    .replace(/\.(?!\d)/g, ',')
    .split(/[,;\n]|\band then\b|\bthen\b|\bplus\b(?!\s+tax)|\balso\b|\bnext\b/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .flatMap(splitOnAnd);
  const segments: string[] = [];
  for (const segment of raw) {
    const onlyTax = /^(and\s+)?((it's|that's|it is|that is)\s+)?(taxed|taxable|plus tax|with tax|no tax|not taxed|tax free|untaxed)$/i;
    if (onlyTax.test(segment) && segments.length > 0) {
      segments[segments.length - 1] += `, ${segment}`;
    } else {
      segments.push(segment);
    }
  }
  return segments;
}

/** Rewrites fractional time and count phrases into digits before number lexing. */
function normaliseWords(words: string[]): string[] {
  const text = ` ${words.join(' ')} `
    .replace(/ (an|a|one) hour and a half /g, ' 1.5 hours ')
    .replace(/ hour and a half /g, ' 1.5 hours ')
    .replace(/ half (an )?hour /g, ' 0.5 hours ')
    .replace(/ (an|a) hour /g, ' 1 hours ')
    .replace(/ (a )?couple( of)? /g, ' 2 ')
    .replace(/ (a )?pair( of)? /g, ' 2 ')
    .replace(/ (a )?dozen /g, ' 12 ');
  return text.trim().split(/\s+/).filter(Boolean);
}

/** Folds "two and a half" into a single count of 2.5. */
function foldHalves(tokens: Token[]): Token[] {
  const out: Token[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    const isHalf =
      t.type === 'num' &&
      t.count !== null &&
      tokens[i + 1]?.type === 'word' && (tokens[i + 1] as { text: string }).text === 'and' &&
      tokens[i + 2]?.type === 'word' && (tokens[i + 2] as { text: string }).text === 'a' &&
      tokens[i + 3]?.type === 'word' && (tokens[i + 3] as { text: string }).text === 'half';
    if (isHalf && t.type === 'num' && t.count !== null) {
      out.push({ ...t, raw: `${t.raw} and a half`, count: t.count + 0.5, priceCents: [], explicitMoney: false });
      i += 3;
    } else {
      out.push(t);
    }
  }
  return out;
}

function titleCase(words: string[]): string {
  const text = words.join(' ').trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : '';
}

const wordAt = (tokens: Token[], i: number): string | undefined => {
  const t = tokens[i];
  return t?.type === 'word' ? t.text : undefined;
};

interface SegmentReading {
  kind: LineKind;
  description: string;
  quantity: number;
  unit: LineUnit;
  price: NumberToken | null;
  taxable: boolean | null;
  hasNumbers: boolean;
  /** Numbers that were neither the quantity nor the price, as heard. */
  unplaced: string[];
}

function readSegment(segment: string): SegmentReading {
  const lower = segment.toLowerCase();
  const taxable = TAX_NO.test(lower) ? false : TAX_YES.test(lower) ? true : null;
  const words = normaliseWords(tokenize(lower.replace(TAX_WORDS, ' ')));
  const tokens = foldHalves(lexNumbers(words));
  const nums = tokens.map((t, i) => ({ t, i })).filter((x): x is { t: NumberToken; i: number } => x.t.type === 'num');

  const isLabor = words.some((w) => LABOR_WORDS.has(w));
  const fee = FEE_PHRASES.find(([re]) => re.test(lower));
  const kind: LineKind = isLabor ? 'labor' : fee ? 'fee' : 'part';

  let price: NumberToken | null = null;
  let quantity: number | null = null;
  let hours = false;
  const used = new Set<number>();
  const sizes = new Map<number, string>();
  for (const { t, i } of nums) {
    const next = wordAt(tokens, i + 1);
    if (next && SIZE_WORDS.has(next) && t.count !== null && Number.isInteger(t.count)) {
      sizes.set(i, String(t.count));
      used.add(i);
    }
  }

  for (const { t, i } of nums) {
    const next = wordAt(tokens, i + 1);
    const after = wordAt(tokens, i + 2);
    const prev = wordAt(tokens, i - 1);
    if (next && (HOUR_WORDS.has(next) || MINUTE_WORDS.has(next)) && t.count !== null) {
      // "one hour and fifteen minutes" adds up to 1.25 hours.
      const spoken = MINUTE_WORDS.has(next) ? t.count / 60 : t.count;
      quantity = Math.round(((hours && quantity ? quantity : 0) + spoken) * 100) / 100;
      hours = true;
      used.add(i);
    } else if (next && RATE_WORDS.has(next) && after && HOUR_WORDS.has(after)) {
      price = t;
      hours = true;
      used.add(i);
    } else if ((prev && QTY_MARKERS.has(prev)) || (next && QTY_MARKERS.has(next))) {
      if (t.count !== null) quantity = t.count;
      used.add(i);
    }
  }
  for (const { t, i } of nums) {
    if (used.has(i) || price) continue;
    const prev = wordAt(tokens, i - 1);
    const next = wordAt(tokens, i + 1);
    if (t.explicitMoney || (prev && PRICE_BEFORE.has(prev)) || (next && PRICE_AFTER.has(next))) {
      price = t;
      used.add(i);
    }
  }
  // A number said like a price ("for forty", "forty dollars") is never read as a quantity.
  const priceMarked = ({ t, i }: { t: NumberToken; i: number }) => {
    const prev = wordAt(tokens, i - 1);
    const next = wordAt(tokens, i + 1);
    return t.explicitMoney || (prev !== undefined && PRICE_BEFORE.has(prev)) || (next !== undefined && PRICE_AFTER.has(next));
  };
  const unused = nums.filter(({ i }) => !used.has(i));
  if (!quantity && unused.length >= (price ? 1 : 2)) {
    const first = unused[0]!;
    if (!priceMarked(first) && first.t.count !== null && Number.isInteger(first.t.count) && first.t.count >= 1 && first.t.count <= 50) {
      quantity = first.t.count;
      used.add(first.i);
    }
  }
  if (!price) {
    const last = nums.filter(({ i }) => !used.has(i)).pop();
    if (last && last.t.priceCents.length > 0) {
      price = last.t;
      used.add(last.i);
    }
  }

  let description: string;
  if (kind === 'labor') {
    description = 'Labor';
  } else if (fee) {
    description = fee[1];
  } else {
    const descWords = tokens
      .map((t, i) => (sizes.has(i) ? sizes.get(i)! : t.type === 'word' && !used.has(i) && !FILLER.has(t.text) ? t.text : null))
      .filter((w): w is string => w !== null);
    const withoutPart = descWords.filter((w) => w !== 'part' && w !== 'parts');
    description = titleCase(withoutPart.length > 0 ? withoutPart : descWords) || (nums.length > 0 ? 'Part' : '');
  }

  const unit: LineUnit = kind === 'labor' ? (hours ? 'hour' : 'flat') : kind === 'fee' ? 'flat' : 'each';
  const unplaced = nums.filter(({ i }) => !used.has(i)).map(({ t }) => t.raw);
  return { kind, description, quantity: quantity ?? 1, unit, price, taxable, hasNumbers: nums.length > sizes.size, unplaced };
}

export function parseInvoiceSpeech(text: string, options: ParseOptions): ParsedInvoice {
  const segments = splitSegments(text);
  const readings = segments.map((s) => ({ segment: s, reading: readSegment(s) }));

  let title: string | null = null;
  const first = readings[0];
  if (first && !first.reading.hasNumbers && first.reading.kind === 'part' && readings.length > 1) {
    title = first.reading.description;
    readings.shift();
  }

  const lines: InvoiceLine[] = readings
    .filter(({ reading }) => reading.description.length > 0)
    .map(({ segment, reading }) => {
      const defaultTaxable = reading.kind === 'part' ? true : reading.kind === 'labor' ? options.laborTaxable : false;
      const [primary, ...alternatives] = reading.price?.priceCents ?? [];
      return {
        id: options.newId(),
        description: reading.description,
        kind: reading.kind,
        quantity: reading.quantity,
        unit: reading.unit,
        unitPriceCents: primary ?? 0,
        taxable: reading.taxable ?? defaultTaxable,
        priceSource: primary === undefined ? 'price-book' : 'spoken',
        heard: segment,
        alternativesCents: alternatives,
        confirmedPriceCents: null,
        confirmedQuantity: null,
        unplacedNumbers: reading.unplaced,
        note: null,
      } satisfies InvoiceLine;
    });

  return { title, lines };
}
