import { lineAmountCents, roundDiv } from './money';
import type { Business, Cents, InvoiceTotals } from './types';

/**
 * Statewide base sales tax rates in thousandths of a percent (6.25% = 6250).
 * Local and county add-ons are not included; owners in a higher-rate area set an override.
 */
export const STATE_BASE_RATES_MILLI: Readonly<Record<string, number>> = {
  AL: 4000, AK: 0, AZ: 5600, AR: 6500, CA: 7250, CO: 2900, CT: 6350, DE: 0, FL: 6000, GA: 4000,
  HI: 4000, ID: 6000, IL: 6250, IN: 7000, IA: 6000, KS: 6500, KY: 6000, LA: 5000, ME: 5500, MD: 6000,
  MA: 6250, MI: 6000, MN: 6875, MS: 7000, MO: 4225, MT: 0, NE: 5500, NV: 6850, NH: 0, NJ: 6625,
  NM: 4875, NY: 4000, NC: 4750, ND: 5000, OH: 5750, OK: 4500, OR: 0, PA: 6000, RI: 7000, SC: 6000,
  SD: 4200, TN: 7000, TX: 6250, UT: 4850, VT: 6000, VA: 5300, WA: 6500, WV: 6000, WI: 5000, WY: 4000,
};

export function stateBaseRateMilli(state: string): number {
  const rate = STATE_BASE_RATES_MILLI[state.trim().toUpperCase()];
  if (rate === undefined) throw new Error(`Unknown US state code "${state}"`);
  return rate;
}

export function businessTaxRateMilli(business: Pick<Business, 'taxRateOverrideMilli' | 'address'>): number {
  return business.taxRateOverrideMilli ?? stateBaseRateMilli(business.address.state);
}

export interface TotalsLine {
  quantity: number;
  unitPriceCents: Cents;
  taxable: boolean;
}

/** Subtotal and taxable subtotal are exact sums of line amounts; tax is rounded once, half-up. */
export function computeTotals(lines: readonly TotalsLine[], taxRateMilli: number): InvoiceTotals {
  if (!Number.isInteger(taxRateMilli) || taxRateMilli < 0) throw new Error('Tax rate must be a non-negative integer');
  let subtotalCents = 0;
  let taxableCents = 0;
  for (const line of lines) {
    const amount = lineAmountCents(line.quantity, line.unitPriceCents);
    subtotalCents += amount;
    if (line.taxable) taxableCents += amount;
  }
  const taxCents = roundDiv(taxableCents * taxRateMilli, 100_000);
  return { subtotalCents, taxableCents, taxRateMilli, taxCents, totalCents: subtotalCents + taxCents };
}
