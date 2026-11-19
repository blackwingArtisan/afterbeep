import type { Cents } from './types';

/**
 * The landing page payback estimate. Every input is either cited (job value, the voicemail
 * leave-a-message rate) or a labelled assumption the visitor can move. Money stays in integer cents.
 */
export interface PaybackInput {
  /** Calls the owner cannot pick up in a week (assumption, default 5). */
  missedPerWeek: number;
  /** Share of callers who leave a message when the greeting promises a text, 0 to 1 (assumption, default 0.5). */
  leaveRate: number;
  /** Share of texted callers who book a visit, 0 to 1 (assumption, default 1 in 3). */
  bookRate: number;
  /** Value of one booked job (Thumbtack's typical minor appliance repair, $206). */
  jobCents: Cents;
  /** AfterBeep's monthly price. */
  priceCents: Cents;
}

export interface PaybackResult {
  missedPerMonth: number;
  messagesPerMonth: number;
  bookedPerMonth: number;
  /** Booked work a month, rounded to the nearest $10. */
  bookedCentsPerMonth: Cents;
  /** How many times over the booked work pays the monthly price, rounded down. */
  timesPrice: number;
}

/** Plain voicemail keeps 31% of callers: 69% hang up without a message (Moneypenny, 2016). */
export const PLAIN_VOICEMAIL_LEAVE_RATE = 0.31;
export const WEEKS_PER_MONTH = 52 / 12;

export const PAYBACK_DEFAULTS: PaybackInput = {
  missedPerWeek: 5,
  leaveRate: 0.5,
  bookRate: 1 / 3,
  jobCents: 20_600,
  priceCents: 3_900,
};

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

export function payback(input: PaybackInput): PaybackResult {
  const missedPerMonth = Math.max(0, input.missedPerWeek) * WEEKS_PER_MONTH;
  const messagesPerMonth = missedPerMonth * clamp01(input.leaveRate);
  const bookedPerMonth = messagesPerMonth * clamp01(input.bookRate);
  const bookedCentsPerMonth = Math.round((bookedPerMonth * input.jobCents) / 1_000) * 1_000;
  const timesPrice = input.priceCents > 0 ? Math.floor(bookedCentsPerMonth / input.priceCents) : 0;
  return { missedPerMonth, messagesPerMonth, bookedPerMonth, bookedCentsPerMonth, timesPrice };
}
