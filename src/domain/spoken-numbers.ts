import type { Cents } from './types';

/**
 * Spoken-number reading for trade invoices and voicemails.
 *
 * Tradespeople say prices the short way: "three twenty-nine" ($329), "sixty-two fifty" ($62.50),
 * "twelve hundred" ($1,200). Some phrases are genuinely ambiguous ("twelve fifty" is $12.50 or
 * $1,250), so price readings return every plausible interpretation, most likely first, and the
 * price book picks between them later.
 */

const ONES: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
};
const TEENS: Record<string, number> = {
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
  sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};

export type NumberToken = {
  type: 'num';
  raw: string;
  /** The value when read as a plain count ("two" -> 2, "1.5" -> 1.5); null for price shorthand pairs. */
  count: number | null;
  /** Price readings in cents, most likely first. */
  priceCents: Cents[];
  /** True when the speaker said "dollars", "bucks" or "cents", or used a "$" or decimal digits. */
  explicitMoney: boolean;
};
export type WordToken = { type: 'word'; text: string };
export type Token = NumberToken | WordToken;

/** Lowercases and splits text into words, keeping "$329.50"-style numbers whole. */
export function tokenize(text: string): string[] {
  const cleaned = text
    .toLowerCase()
    .replace(/(\d),(\d{3})/g, '$1$2')
    .replace(/[–—-]/g, ' ');
  return cleaned.match(/\$?\d+(?:\.\d+)?|[a-z']+|@/g) ?? [];
}

export function isNumberWord(word: string): boolean {
  return (
    word in ONES || word in TEENS || word in TENS || word === 'hundred' || word === 'thousand' || word === 'oh'
  );
}

interface Chunk {
  value: number;
  length: number;
  scaled: boolean;
  leadingOh: boolean;
}

/** Reads one cardinal number ("three hundred and twenty nine") starting at `start`. */
function readChunk(words: readonly string[], start: number): Chunk | null {
  let total = 0;
  let current = 0;
  let last: 'none' | 'ones' | 'teens' | 'tens' | 'hundred' | 'thousand' = 'none';
  let scaled = false;
  let i = start;

  const first = words[i];
  const second = words[i + 1];
  if (first === 'oh' && second !== undefined && second in ONES && ONES[second]! > 0) {
    return { value: ONES[second]!, length: 2, scaled: false, leadingOh: true };
  }

  while (i < words.length) {
    const w = words[i]!;
    const next = words[i + 1];
    if ((w === 'a' || w === 'an') && last === 'none' && (next === 'hundred' || next === 'thousand')) {
      current = 1;
      last = 'ones';
    } else if (w in ONES) {
      if (!(last === 'none' || last === 'tens' || last === 'hundred' || last === 'thousand')) break;
      current += ONES[w]!;
      last = 'ones';
    } else if (w in TEENS) {
      if (!(last === 'none' || last === 'hundred' || last === 'thousand')) break;
      current += TEENS[w]!;
      last = 'teens';
    } else if (w in TENS) {
      if (!(last === 'none' || last === 'hundred' || last === 'thousand')) break;
      current += TENS[w]!;
      last = 'tens';
    } else if (w === 'hundred') {
      if (!(last === 'ones' || last === 'teens') || current >= 100) break;
      current *= 100;
      last = 'hundred';
      scaled = true;
    } else if (w === 'thousand') {
      if (last === 'none' || last === 'thousand') break;
      total += current * 1000;
      current = 0;
      last = 'thousand';
      scaled = true;
    } else if (w === 'and') {
      const nextIsNumber = next !== undefined && (next in ONES || next in TEENS || next in TENS);
      if (!((last === 'hundred' || last === 'thousand') && nextIsNumber)) break;
    } else {
      break;
    }
    i += 1;
  }
  if (i === start) return null;
  return { value: total + current, length: i - start, scaled, leadingOh: false };
}

function digitToken(raw: string): NumberToken {
  const value = Number(raw.replace('$', ''));
  return {
    type: 'num',
    raw,
    count: value,
    priceCents: [Math.round(value * 100)],
    explicitMoney: raw.startsWith('$') || raw.includes('.'),
  };
}

/** Combines a run of chunks into number tokens, applying price shorthand to pairs. */
function chunksToTokens(chunks: Chunk[], raws: string[]): NumberToken[] {
  const out: NumberToken[] = [];
  let k = 0;
  while (k < chunks.length) {
    const a = chunks[k]!;
    const b = chunks[k + 1];
    const bIsCents = b !== undefined && !b.scaled && (b.leadingOh || (b.value >= 10 && b.value <= 99));
    const aCanLead = !a.leadingOh && (a.scaled || (a.value >= 1 && a.value <= 99));
    if (b && bIsCents && aCanLead) {
      const raw = `${raws[k]} ${raws[k + 1]}`;
      const asDollarsAndCents = a.value * 100 + b.value;
      const asHundreds = (a.value * 100 + b.value) * 100;
      let readings: Cents[];
      if (a.scaled) readings = [asDollarsAndCents];
      else if (a.value < 10) readings = [asHundreds, asDollarsAndCents];
      else readings = [asDollarsAndCents, asHundreds];
      out.push({ type: 'num', raw, count: null, priceCents: readings, explicitMoney: false });
      k += 2;
    } else {
      out.push({ type: 'num', raw: raws[k]!, count: a.value, priceCents: [a.value * 100], explicitMoney: false });
      k += 1;
    }
  }
  return out;
}

/** Turns words into a token stream where every spoken or written number is a single NumberToken. */
export function lexNumbers(words: readonly string[]): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < words.length) {
    const w = words[i]!;
    if (/^\$?\d+(\.\d+)?$/.test(w)) {
      tokens.push(digitToken(w));
      i += 1;
      continue;
    }
    const chunks: Chunk[] = [];
    const raws: string[] = [];
    let j = i;
    for (;;) {
      const chunk = readChunk(words, j);
      if (!chunk) break;
      chunks.push(chunk);
      raws.push(words.slice(j, j + chunk.length).join(' '));
      j += chunk.length;
    }
    if (chunks.length === 0) {
      tokens.push({ type: 'word', text: w });
      i += 1;
      continue;
    }
    tokens.push(...chunksToTokens(chunks, raws));
    i = j;
  }
  return applyMoneyWords(tokens);
}

const DOLLAR_WORDS = new Set(['dollar', 'dollars', 'bucks', 'buck']);
const CENT_WORDS = new Set(['cent', 'cents']);

/** Folds "forty dollars and fifty cents", "fifty cents" and "ninety bucks" into one money token. */
function applyMoneyWords(tokens: Token[]): Token[] {
  const out: Token[] = [];
  let i = 0;
  const wordAt = (k: number) => {
    const t = tokens[k];
    return t?.type === 'word' ? t.text : undefined;
  };
  while (i < tokens.length) {
    const t = tokens[i]!;
    if (t.type === 'num' && DOLLAR_WORDS.has(wordAt(i + 1) ?? '')) {
      const dollars = t.priceCents[0]!;
      let cents = 0;
      let used = 2;
      let raw = `${t.raw} ${wordAt(i + 1)}`;
      const andOffset = wordAt(i + 2) === 'and' ? 1 : 0;
      const centsToken = tokens[i + 2 + andOffset];
      if (centsToken?.type === 'num' && CENT_WORDS.has(wordAt(i + 3 + andOffset) ?? '') && centsToken.count !== null) {
        cents = centsToken.count;
        used = 4 + andOffset;
        raw = `${raw} ${andOffset ? 'and ' : ''}${centsToken.raw} cents`;
      }
      out.push({ type: 'num', raw, count: t.count, priceCents: [dollars + cents], explicitMoney: true });
      i += used;
    } else if (t.type === 'num' && t.count !== null && CENT_WORDS.has(wordAt(i + 1) ?? '')) {
      out.push({ type: 'num', raw: `${t.raw} cents`, count: null, priceCents: [t.count], explicitMoney: true });
      i += 2;
    } else {
      out.push(t);
      i += 1;
    }
  }
  return out;
}

/** Every price reading of a phrase, most likely first; empty when the phrase holds no single number. */
export function readPrice(text: string): Cents[] {
  const nums = lexNumbers(tokenize(text)).filter((t): t is NumberToken => t.type === 'num');
  return nums.length === 1 ? nums[0]!.priceCents : [];
}

/** Reads a plain cardinal ("nineteen" -> 19, "1428" -> 1428); null when the phrase is not one number. */
export function readCount(text: string): number | null {
  const tokens = lexNumbers(tokenize(text));
  const only = tokens.length === 1 ? tokens[0] : undefined;
  return only?.type === 'num' ? only.count : null;
}

const DIGIT_WORDS: Record<string, string> = {
  zero: '0', oh: '0', o: '0', one: '1', two: '2', three: '3', four: '4', five: '5',
  six: '6', seven: '7', eight: '8', nine: '9',
};

/**
 * Rewrites spoken digit strings into digits: "six one four, five five five, oh one two three"
 * becomes "6145550123". Handles "double five". Runs shorter than three digits are left as spoken.
 */
export function spokenDigitsToText(text: string): string {
  const pieces = text.split(/(\s+)/);
  const out: string[] = [];
  let digits = '';
  let original: string[] = [];
  let pendingDouble = false;
  const flush = () => {
    if (digits.length >= 3) {
      const trailing = original[original.length - 1]?.match(/[,.!?]+$/)?.[0] ?? '';
      out.push(digits + trailing);
    } else {
      out.push(original.join(''));
    }
    digits = '';
    original = [];
  };
  for (const piece of pieces) {
    if (/^\s+$/.test(piece)) {
      if (original.length > 0) original.push(piece);
      else out.push(piece);
      continue;
    }
    const w = piece.toLowerCase().replace(/[,.!?]+$/, '');
    if (w === 'double') {
      pendingDouble = true;
      original.push(piece);
      continue;
    }
    const d = DIGIT_WORDS[w] ?? (/^\d+$/.test(w) && w.length <= 4 ? w : undefined);
    if (d !== undefined) {
      digits += pendingDouble ? d + d : d;
      pendingDouble = false;
      original.push(piece);
      continue;
    }
    pendingDouble = false;
    if (original.length > 0) {
      const trailingSpace = original[original.length - 1]!;
      if (/^\s+$/.test(trailingSpace)) {
        original.pop();
        flush();
        out.push(trailingSpace);
      } else {
        flush();
      }
    }
    out.push(piece);
  }
  if (original.length > 0) flush();
  return out.join('');
}
