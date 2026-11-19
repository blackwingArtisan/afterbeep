import { describe, expect, it } from 'vitest';
import { draftFromSpeech, quoteLines } from '../../src/domain/invoice-draft';
import { parseInvoiceSpeech, splitSegments } from '../../src/domain/invoice-parser';
import { lineAmountCents, roundDiv } from '../../src/domain/money';
import {
  buildPriceBook,
  checkLine,
  differenceFromUsual,
  findEntry,
  isOutlier,
  itemKey,
  quantityLimit,
} from '../../src/domain/price-book';
import { computeTotals, stateBaseRateMilli } from '../../src/domain/tax';
import type { InvoiceLine } from '../../src/domain/types';
import { pastInvoices, sampleInvoiceScripts } from '../../src/server/seed';

const counter = () => {
  let n = 0;
  return () => `line_${++n}`;
};
const book = buildPriceBook(pastInvoices);
const ctx = () => ({ book, laborTaxable: false, taxRateMilli: 5750, newId: counter() });
const script = (id: string) => sampleInvoiceScripts.find((s) => s.id === id)!.speech;

describe('money', () => {
  it('[VI 2.1, 2.2] rounds half away from zero with integers only', () => {
    expect(roundDiv(5, 2)).toBe(3);
    expect(roundDiv(4, 3)).toBe(1);
    expect(roundDiv(-5, 2)).toBe(-3);
    expect(() => roundDiv(1.5, 1)).toThrow();
  });
  it('[VI 2.1, 2.2] computes line amounts from quantity in hundredths', () => {
    expect(lineAmountCents(1.5, 8500)).toBe(12750);
    expect(lineAmountCents(3, 1999)).toBe(5997);
    expect(lineAmountCents(0.33, 1001)).toBe(330);
    expect(() => lineAmountCents(1.333, 100)).toThrow();
  });
});

describe('tax', () => {
  it('[VI 2.3] uses state base rates', () => {
    expect(stateBaseRateMilli('oh')).toBe(5750);
    expect(stateBaseRateMilli('MN')).toBe(6875);
    expect(() => stateBaseRateMilli('ZZ')).toThrow();
  });
  it('[VI 1.6, 2.3, 2.4] taxes only taxable lines and rounds once', () => {
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
  it('[VI 1.1, 1.6] keeps "taxed" with its line', () => {
    expect(splitSegments('Dryer belt fifteen, taxed. One hour labor at eighty-five.')).toEqual([
      'Dryer belt fifteen, taxed',
      'One hour labor at eighty-five',
    ]);
  });
  it('[VI 1.1] does not split decimals', () => {
    expect(splitSegments('anode rod 62.50, labor')).toEqual(['anode rod 62.50', 'labor']);
  });
  it('[VI 1.8] splits at an "and" that starts a new priced item', () => {
    expect(splitSegments('water heater element ninety nine dollars and a thermostat for forty')).toEqual([
      'water heater element ninety nine dollars',
      'a thermostat for forty',
    ]);
    expect(splitSegments('one hour labor at eighty five and two dryer belts at fifty')).toEqual([
      'one hour labor at eighty five',
      'two dryer belts at fifty',
    ]);
    expect(splitSegments('two and a half hours labor at ninety and a trip charge')).toEqual([
      'two and a half hours labor at ninety',
      'a trip charge',
    ]);
    expect(splitSegments('drum motor three hundred and twenty nine and two hours labor at eighty five')).toEqual([
      'drum motor three hundred and twenty nine',
      'two hours labor at eighty five',
    ]);
  });
  it.each([
    'drum motor three hundred and twenty nine',
    'filter ninety dollars and fifty cents',
    'two and a half hours labor at ninety',
    'one hour and fifteen minutes labor at eighty',
    'dryer belt and pulley for forty',
  ])('keeps "%s" as one item', (phrase) => {
    expect(splitSegments(phrase)).toEqual([phrase]);
  });
});

describe('parseInvoiceSpeech', () => {
  it('[VI 1.1, 1.2, 1.4, 1.5] reads the classic dryer job', () => {
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

  it('[VI 1.2] reads quantities before parts', () => {
    const [line] = parseInvoiceSpeech('two supply lines at sixteen each', { laborTaxable: false, newId: counter() }).lines;
    expect(line).toMatchObject({ description: 'Supply lines', quantity: 2, unitPriceCents: 1600, taxable: true });
  });

  it('[VI 1.2] adds hours and minutes', () => {
    const [line] = parseInvoiceSpeech('one hour and fifteen minutes labor at eighty', { laborTaxable: false, newId: counter() }).lines;
    expect(line).toMatchObject({ kind: 'labor', quantity: 1.25, unit: 'hour', unitPriceCents: 8000 });
  });

  it('[VI 1.9] never reads a number said like a price as a quantity', () => {
    const [line] = parseInvoiceSpeech('water heater element ninety nine dollars thermostat for forty', {
      laborTaxable: false,
      newId: counter(),
    }).lines;
    expect(line).toMatchObject({ quantity: 1, unitPriceCents: 9900, unplacedNumbers: ['forty'] });
  });

  it('[VI 1.6] respects explicit no-tax', () => {
    const [line] = parseInvoiceSpeech('filter twenty dollars no tax', { laborTaxable: false, newId: counter() }).lines;
    expect(line).toMatchObject({ description: 'Filter', unitPriceCents: 2000, taxable: false });
  });
});

describe('price book', () => {
  it('[VI 3.1] normalises item names', () => {
    expect(itemKey('Replaced the Dryer Belts')).toBe('dryer belt');
    expect(itemKey('Service call fee')).toBe('trip charge charge');
  });
  it('[VI 3.1] builds medians from history', () => {
    const belt = findEntry(book, 'dryer belt', 'part');
    expect(belt).toMatchObject({ count: 4, medianCents: 5000, minCents: 4950, maxCents: 5200 });
    expect(findEntry(book, 'Labor', 'labor')).toMatchObject({ medianCents: 8500, unit: 'hour' });
    expect(findEntry(book, 'flux capacitor', 'part')).toBeNull();
  });
});

describe('drafts', () => {
  it('[VI 3.2] passes a normal job with no holds', () => {
    const draft = draftFromSpeech(script('clean'), ctx());
    expect(draft.blocked).toBe(false);
    expect(draft.checks.map((c) => c.status)).toEqual(['ok', 'ok', 'ok']);
    // 329 + 170 + 45 = 544.00; tax 5.75% of 329.00 = 18.9175 -> 18.92
    expect(draft.totals).toMatchObject({ subtotalCents: 54400, taxCents: 1892, totalCents: 56292 });
  });

  it('[VI 3.4] holds a price far from history and offers both prices', () => {
    const draft = draftFromSpeech(script('slip'), ctx());
    expect(draft.blocked).toBe(true);
    const belt = draft.checks[0]!;
    expect(belt.status).toBe('outlier');
    expect(belt.options.map((o) => o.patch)).toEqual([
      { confirmedPriceCents: 1500 },
      { unitPriceCents: 5000, priceSource: 'owner', confirmedPriceCents: null, note: null },
    ]);
    expect(draft.checks[2]!.status).toBe('filled');
    expect(draft.lines[2]!.unitPriceCents).toBe(4500);
  });

  it('[VI 3.4, 4.1] releases the hold once the owner confirms or picks a price', () => {
    const draft = draftFromSpeech(script('slip'), ctx());
    const confirmed = draft.lines.map((l, i) => (i === 0 ? { ...l, confirmedPriceCents: l.unitPriceCents } : l));
    expect(quoteLines(confirmed, { book, taxRateMilli: 5750 }).blocked).toBe(false);
    const picked = draft.lines.map((l, i) => (i === 0 ? { ...l, unitPriceCents: 5000, priceSource: 'owner' as const } : l));
    const quote = quoteLines(picked, { book, taxRateMilli: 5750 });
    expect(quote.blocked).toBe(false);
    // 50 + 85 + 45 = 180.00; tax 5.75% of 50.00 = 2.875 -> 2.88
    expect(quote.totals.totalCents).toBe(18288);
  });

  it('[VI 1.3, 3.3] uses history to read "twelve fifty" as $1,250 for a water heater', () => {
    const draft = draftFromSpeech(script('ambiguous'), ctx());
    const heater = draft.lines[0]!;
    expect(heater.unitPriceCents).toBe(125000);
    expect(heater.note).toContain('$1,250.00');
    expect(draft.lines[1]!.unitPriceCents).toBe(6250);
    expect(draft.blocked).toBe(false);
  });

  it('[VI 3.5] blocks an empty invoice and a line with no price and no history', () => {
    expect(quoteLines([], { book, taxRateMilli: 5750 }).blocked).toBe(true);
    const draft = draftFromSpeech('one hour labor at eighty-five, mystery gadget', ctx());
    expect(draft.checks[1]!.status).toBe('missing-price');
    expect(draft.blocked).toBe(true);
  });

  it('[VI 3.6] marks brand-new items without blocking', () => {
    const [line] = draftFromSpeech('flux capacitor ninety', ctx()).lines;
    expect(checkLine(line!, book).status).toBe('new-item');
  });
});

describe('holds that catch misheard numbers', () => {
  const settle = (lines: InvoiceLine[], index: number, option: number) =>
    lines.map((l, i) => (i === index ? { ...l, ...checkLine(l, book).options[option]!.patch } : l));

  it('[VI 1.8] reads two items joined by "and" as two lines with correct quantities', () => {
    const draft = draftFromSpeech('water heater element ninety nine dollars and a thermostat for forty, one hour labor at eighty five', ctx());
    expect(draft.lines.map((l) => [l.description, l.quantity, l.unitPriceCents])).toEqual([
      ['Water heater element', 1, 9900],
      ['Thermostat', 1, 4000],
      ['Labor', 1, 8500],
    ]);
    // 99 + 40 + 85 = 224.00; tax 5.75% of 139.00 = 7.9925 -> 7.99
    expect(draft.totals).toMatchObject({ subtotalCents: 22400, taxCents: 799, totalCents: 23199 });
    expect(draft.blocked).toBe(false);
  });

  it('[VI 1.10, 3.9] holds a line with a number it could not place, until the owner says to ignore it', () => {
    const draft = draftFromSpeech('water heater element ninety nine dollars thermostat for forty', ctx());
    const check = draft.checks[0]!;
    expect(check).toMatchObject({ status: 'unplaced', blocking: true });
    expect(check.message).toContain('"forty"');
    expect(quoteLines(settle(draft.lines, 0, 0), { book, taxRateMilli: 5750 }).blocked).toBe(false);
  });

  it('[VI 3.10] holds a quantity far above anything in history', () => {
    const draft = draftFromSpeech('forty water heater elements at eighty nine', ctx());
    const check = draft.checks[0]!;
    expect(check).toMatchObject({ status: 'quantity', blocking: true });
    expect(check.message).toBe('That is a quantity of 40 at $89.00. Your most on one invoice is 2.');
    expect(check.options.map((o) => o.label)).toEqual(['Keep 40', 'Make it 1']);
    const one = quoteLines(settle(draft.lines, 0, 1), { book, taxRateMilli: 5750 });
    expect(one.blocked).toBe(false);
    expect(one.lines[0]!.quantity).toBe(1);
    const kept = quoteLines(settle(draft.lines, 0, 0), { book, taxRateMilli: 5750 });
    expect(kept.blocked).toBe(false);
    expect(kept.totals.subtotalCents).toBe(356000);
  });

  it('[VI 3.10] holds labor hours far above a normal day, and large quantities of new items', () => {
    expect(draftFromSpeech('twenty hours labor at eighty five', ctx()).checks[0]!.status).toBe('quantity');
    expect(draftFromSpeech('eight hours labor at eighty five', ctx()).checks[0]!.status).toBe('ok');
    expect(draftFromSpeech('twelve widgets at five each', ctx()).checks[0]!.status).toBe('quantity');
    expect(draftFromSpeech('three widgets at five each', ctx()).checks[0]!.status).toBe('new-item');
  });

  it('[VI 3.1, 3.10] records the largest past quantity in the price book', () => {
    expect(findEntry(book, 'Water heater element', 'part')?.maxQuantity).toBe(2);
    expect(quantityLimit({ kind: 'part' }, findEntry(book, 'Water heater element', 'part'))).toBe(4);
    expect(quantityLimit({ kind: 'labor' }, findEntry(book, 'Labor', 'labor'))).toBe(12);
    expect(quantityLimit({ kind: 'part' }, null)).toBe(10);
  });

  it('[VI 3.11] holds an ambiguous price with no history and offers each reading', () => {
    const draft = draftFromSpeech('dryer repair, part three twenty-nine taxed, two hours labor at eighty-five', ctx());
    const part = draft.checks[0]!;
    expect(part).toMatchObject({ status: 'ambiguous', blocking: true });
    expect(part.options.map((o) => o.label)).toEqual(["It's $329.00", "It's $3.29"]);
    expect(draft.blocked).toBe(true);
    const picked = quoteLines(settle(draft.lines, 0, 1), { book, taxRateMilli: 5750 });
    expect(picked.blocked).toBe(false);
    expect(picked.lines[0]!.unitPriceCents).toBe(329);
    expect(picked.checks[0]!.status).toBe('new-item');
  });

  it('[VI 3.3] still lets history settle an ambiguous price without a hold', () => {
    const draft = draftFromSpeech(script('ambiguous'), ctx());
    expect(draft.checks.map((c) => c.status)).toEqual(['ok', 'ok', 'ok', 'ok']);
  });
});

describe('prices against the usual rate', () => {
  const laborCheck = (speech: string) => draftFromSpeech(speech, ctx()).checks[0]!;

  it('[VI 3.4, 3.7] holds a labor rate well below the usual rate', () => {
    const check = laborCheck('two hours labor at sixty');
    expect(check).toMatchObject({ status: 'outlier', blocking: true, usualCents: 8500 });
    expect(check.message).toBe('You said $60.00/hr, but you usually charge $85.00/hr (15 past invoices).');
    expect(check.message).not.toContain('Matches');
    expect(check.options.map((o) => o.label)).toEqual(['Keep $60.00/hr', 'Use usual $85.00/hr']);
  });

  it('[VI 3.4] holds a rate more than 15% below or 25% above the usual one', () => {
    expect(laborCheck('one hour labor at seventy').status).toBe('outlier'); // 17.6% below
    expect(laborCheck('one hour labor at seventy five').status).toBe('ok'); // 11.8% below
    expect(laborCheck('one hour labor at one hundred five').status).toBe('ok'); // 23.5% above
    expect(laborCheck('one hour labor at one hundred ten').status).toBe('outlier'); // 29.4% above
    expect(isOutlier(8500 - 1275, 8500)).toBe(false); // exactly 15% below
    expect(isOutlier(8500 - 1276, 8500)).toBe(true);
    expect(isOutlier(10000 + 2500, 10000)).toBe(false); // exactly 25% above
    expect(isOutlier(10000 + 2501, 10000)).toBe(true);
  });

  it('[VI 3.4] says "matches" only for the usual price, and gives the difference otherwise', () => {
    expect(laborCheck('one hour labor at eighty-five').message).toBe('Matches your usual $85.00/hr (15 past invoices).');
    expect(laborCheck('one hour labor at eighty').message).toBe('$80.00/hr is 6% below your usual $85.00/hr (15 past invoices).');
    expect(laborCheck('one hour labor at ninety').message).toBe('$90.00/hr is 6% above your usual $85.00/hr (15 past invoices).');
    expect(differenceFromUsual(10010, 10000)).toBe('less than 1% above');
  });

  it('[VI 3.4] releases a low rate once the owner keeps it', () => {
    const draft = draftFromSpeech('two hours labor at sixty', ctx());
    const kept = draft.lines.map((l) => ({ ...l, ...checkLine(l, book).options[0]!.patch }));
    const quote = quoteLines(kept, { book, taxRateMilli: 5750 });
    expect(quote.blocked).toBe(false);
    expect(quote.checks[0]).toMatchObject({ status: 'confirmed', message: 'You confirmed $60.00/hr (usually $85.00/hr).' });
    expect(quote.totals.totalCents).toBe(12000);
  });
});

describe('sizes said before a part name', () => {
  const parse = (speech: string) => parseInvoiceSpeech(speech, { laborTaxable: false, newId: counter() }).lines;

  it('[VI 1.11] reads "forty gallon" as part of the name, not a quantity of forty', () => {
    const [heater, labor] = parse('Forty gallon water heater twelve fifty, taxed. Three hours labor at eighty five.');
    expect(heater).toMatchObject({ description: '40 gallon water heater', quantity: 1, unitPriceCents: 1250, unplacedNumbers: [] });
    expect(labor).toMatchObject({ kind: 'labor', quantity: 3, unitPriceCents: 8500 });
  });

  it('[VI 1.11] reads amps and inches as sizes and still finds the quantity', () => {
    expect(parse('Fifty amp breaker forty dollars')[0]).toMatchObject({ description: '50 amp breaker', quantity: 1, unitPriceCents: 4000 });
    expect(parse('Two six inch flex lines at nineteen')[0]).toMatchObject({ description: '6 inch flex lines', quantity: 2, unitPriceCents: 1900 });
  });
});
