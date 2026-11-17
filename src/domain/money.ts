import type { Cents } from './types';

/**
 * Integer division rounded half away from zero: roundDiv(5, 2) = 3, roundDiv(-5, 2) = -3.
 * Both arguments must be integers; the result is exact for |numerator| < 2^53.
 */
export function roundDiv(numerator: number, denominator: number): number {
  if (!Number.isInteger(numerator) || !Number.isInteger(denominator)) {
    throw new Error(`roundDiv needs integers, got ${numerator} / ${denominator}`);
  }
  if (denominator === 0) throw new Error('roundDiv by zero');
  const sign = Math.sign(numerator) * Math.sign(denominator);
  const n = Math.abs(numerator);
  const d = Math.abs(denominator);
  return sign * Math.floor((2 * n + d) / (2 * d));
}

/** Converts a dollar amount (possibly fractional, from parsing) to integer cents. */
export function dollarsToCents(dollars: number): Cents {
  return Math.round(dollars * 100);
}

/** Quantity in hundredths, so 1.5 hours = 150. Rejects more than two decimal places. */
export function quantityToHundredths(quantity: number): number {
  const hundredths = Math.round(quantity * 100);
  if (Math.abs(hundredths - quantity * 100) > 1e-6) {
    throw new Error(`Quantity ${quantity} has more than two decimal places`);
  }
  return hundredths;
}

/** Line amount = quantity x unit price, rounded half-up to the cent. */
export function lineAmountCents(quantity: number, unitPriceCents: Cents): Cents {
  if (!Number.isInteger(unitPriceCents)) throw new Error('Unit price must be integer cents');
  return roundDiv(quantityToHundredths(quantity) * unitPriceCents, 100);
}

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

export function formatCents(cents: Cents): string {
  return usd.format(cents / 100);
}

/** Formats a tax rate stored as thousandths of a percent: 5750 -> "5.75%". */
export function formatRateMilli(rateMilli: number): string {
  const percent = rateMilli / 1000;
  return `${percent.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')}%`;
}

export function formatQuantity(quantity: number): string {
  return Number.isInteger(quantity) ? String(quantity) : quantity.toFixed(2).replace(/0$/, '');
}
