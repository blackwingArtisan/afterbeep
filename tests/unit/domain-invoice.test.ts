import { describe, expect, it } from 'vitest';
import { draftFromSpeech, quoteLines } from '../../src/domain/invoice-draft';
import { parseInvoiceSpeech, splitSegments } from '../../src/domain/invoice-parser';
import { lineAmountCents, roundDiv } from '../../src/domain/money';
import { buildPriceBook, checkLine, findEntry, itemKey } from '../../src/domain/price-book';
import { computeTotals, stateBaseRateMilli } from '../../src/domain/tax';
import { pastInvoices, sampleInvoiceScripts } from '../../src/server/seed';

const counter = () => {
  let n = 0;
  return () => `line_${++n}`;
};
const book = buildPriceBook(pastInvoices);
const ctx = () => ({ book, laborTaxable: false, taxRateMilli: 5750, newId: counter() });
const script = (id: string) => sampleInvoiceScripts.find((s) => s.id === id)!.speech;

describe('money', () => {
  it('rounds half away from zero with integers only', () => {
    expect(roundDiv(5, 2)).toBe(3);
    expect(roundDiv(4, 3)).toBe(1);
    expect(roundDiv(-5, 2)).toBe(-3);
    expect(() => roundDiv(1.5, 1)).toThrow();
  });
  it('computes line amounts from quantity in hundredths', () => {
    expect(lineAmountCents(1.5, 8500)).toBe(12750);
    expect(lineAmountCents(3, 1999)).toBe(5997);
    expect(lineAmountCents(0.33, 1001)).toBe(330);
    expect(() => lineAmountCents(1.333, 100)).toThrow();
  });
});

describe('tax', () => {
  it('uses state base rates', () => {
    expect(stateBaseRateMilli('oh')).toBe(5750);
    expect(stateBaseRateMilli('MN')).toBe(6875);
    expect(() => stateBaseRateMilli('ZZ')).toThrow();
  });
  it('taxes only taxable lines and rounds once', () => {
    const totals = computeTotals(
      [
        { quantity: 1, unitPriceCents: 32900, taxable: true },
        { quantity: 2, unitPriceCents: 8500, taxable: false },
      ],
      5750,
    );
    expect(totals).toEqual({ subtotalCents: 49900, taxableCents: 32900, taxRateMilli: 5750, taxCents: 1892, totalCents: 51792 });
  });
});

describe('splitSegments', () => {
  it('keeps "taxed" with its line', () => {
    expect(splitSegments('Dryer belt fifteen, taxed. One hour labor at eighty-five.')).toEqual([
      'Dryer belt fifteen, taxed',
      'One hour labor at eighty-five',
    ]);
  });
  it('does not split decimals', () => {
    expect(splitSegments('anode rod 62.50, labor')).toEqual(['anode rod 62.50', 'labor']);
  });
});

describe('parseInvoiceSpeech', () => {
  it('reads the classic dryer job', () => {
    const parsed = parseInvoiceSpeech(script('clean'), { laborTaxable: false, newId: counter() });
    expect(parsed.title).toBe('Dryer repair');
    expect(parsed.lines.map((l) => [l.description, l.kind, l.quantity, l.unit, l.unitPriceCents, l.taxable])).toEqual([
      ['Drum motor', 'part', 1, 'each', 32900, true],
      ['Labor', 'labor', 2, 'hour', 8500, false],
      ['Trip charge', 'fee', 1, 'flat', 4500, false],
    ]);
  });

  it.each([
    ['an hour and a half labor at eighty-five', 1.5, 8500],
    ['two and a half hours labor at ninety', 2.5, 9000],
    ['ninety minutes labor at eighty', 1.5, 8000],
    ['labor eighty-five an hour, three hours', 1, 8500],
  ])('reads labor "%s"', (speech, quantity, rate) => {
    const [line] = parseInvoiceSpeech(speech, { laborTaxable: false, newId: counter() }).lines;
    expect(line?.kind).toBe('labor');
    expect(line?.quantity).toBe(quantity);
    expect(line?.unitPriceCents).toBe(rate);
  });

  it('reads quantities before parts', () => {
    const [line] = parseInvoiceSpeech('two supply lines at sixteen each', { laborTaxable: false, newId: counter() }).lines;
    expect(line).toMatchObject({ description: 'Supply lines', quantity: 2, unitPriceCents: 1600, taxable: true });
  });

  it('respects explicit no-tax', () => {
    const [line] = parseInvoiceSpeech('filter twenty dollars no tax', { laborTaxable: false, newId: counter() }).lines;
    expect(line).toMatchObject({ description: 'Filter', unitPriceCents: 2000, taxable: false });
  });
});

describe('price book', () => {
  it('normalises item names', () => {
    expect(itemKey('Replaced the Dryer Belts')).toBe('dryer belt');
    expect(itemKey('Service call fee')).toBe('trip charge charge');
  });
  it('builds medians from history', () => {
    const belt = findEntry(book, 'dryer belt', 'part');
    expect(belt).toMatchObject({ count: 4, medianCents: 5000, minCents: 4950, maxCents: 5200 });
    expect(findEntry(book, 'Labor', 'labor')).toMatchObject({ medianCents: 8500, unit: 'hour' });
    expect(findEntry(book, 'flux capacitor', 'part')).toBeNull();
  });
});

describe('drafts', () => {
  it('passes a normal job with no holds', () => {
    const draft = draftFromSpeech(script('clean'), ctx());
    expect(draft.blocked).toBe(false);
    expect(draft.checks.map((c) => c.status)).toEqual(['ok', 'ok', 'ok']);
    // 329 + 170 + 45 = 544.00; tax 5.75% of 329.00 = 18.9175 -> 18.92
    expect(draft.totals).toMatchObject({ subtotalCents: 54400, taxCents: 1892, totalCents: 56292 });
  });

  it('holds a price far from history and offers both prices', () => {
    const draft = draftFromSpeech(script('slip'), ctx());
    expect(draft.blocked).toBe(true);
    const belt = draft.checks[0]!;
    expect(belt.status).toBe('outlier');
    expect(belt.options.map((o) => o.cents)).toEqual([1500, 5000]);
    expect(draft.checks[2]!.status).toBe('filled');
    expect(draft.lines[2]!.unitPriceCents).toBe(4500);
  });

  it('releases the hold once the owner confirms or picks a price', () => {
    const draft = draftFromSpeech(script('slip'), ctx());
    const confirmed = draft.lines.map((l, i) => (i === 0 ? { ...l, confirmedPriceCents: l.unitPriceCents } : l));
    expect(quoteLines(confirmed, { book, taxRateMilli: 5750 }).blocked).toBe(false);
    const picked = draft.lines.map((l, i) => (i === 0 ? { ...l, unitPriceCents: 5000, priceSource: 'owner' as const } : l));
    const quote = quoteLines(picked, { book, taxRateMilli: 5750 });
    expect(quote.blocked).toBe(false);
    // 50 + 85 + 45 = 180.00; tax 5.75% of 50.00 = 2.875 -> 2.88
    expect(quote.totals.totalCents).toBe(18288);
  });

  it('uses history to read "twelve fifty" as $1,250 for a water heater', () => {
    const draft = draftFromSpeech(script('ambiguous'), ctx());
    const heater = draft.lines[0]!;
    expect(heater.unitPriceCents).toBe(125000);
    expect(heater.note).toContain('$1,250.00');
    expect(draft.lines[1]!.unitPriceCents).toBe(6250);
    expect(draft.blocked).toBe(false);
  });

  it('blocks an empty invoice and a line with no price and no history', () => {
    expect(quoteLines([], { book, taxRateMilli: 5750 }).blocked).toBe(true);
    const draft = draftFromSpeech('one hour labor at eighty-five, mystery gadget', ctx());
    expect(draft.checks[1]!.status).toBe('missing-price');
    expect(draft.blocked).toBe(true);
  });

  it('marks brand-new items without blocking', () => {
    const [line] = draftFromSpeech('flux capacitor ninety', ctx()).lines;
    expect(checkLine(line!, book).status).toBe('new-item');
  });
});
