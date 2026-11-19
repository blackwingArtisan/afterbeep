import { describe, expect, it } from 'vitest';
import { PAYBACK_DEFAULTS, PLAIN_VOICEMAIL_LEAVE_RATE, payback } from '../../src/domain/payback';

describe('payback estimate', () => {
  it('turns the labelled defaults into about $740 of booked work a month', () => {
    const r = payback(PAYBACK_DEFAULTS);
    expect(r.missedPerMonth).toBeCloseTo(21.67, 2);
    expect(r.messagesPerMonth).toBeCloseTo(10.83, 2);
    expect(r.bookedPerMonth).toBeCloseTo(3.61, 2);
    expect(r.bookedCentsPerMonth).toBe(74_000);
    expect(r.timesPrice).toBe(18);
  });

  it('keeps money in whole dollars rounded to the nearest $10', () => {
    const r = payback({ ...PAYBACK_DEFAULTS, missedPerWeek: 3 });
    expect(Number.isInteger(r.bookedCentsPerMonth)).toBe(true);
    expect(r.bookedCentsPerMonth % 1_000).toBe(0);
  });

  it('shows less booked work at the plain voicemail rate than with a greeting that promises a text', () => {
    const plain = payback({ ...PAYBACK_DEFAULTS, leaveRate: PLAIN_VOICEMAIL_LEAVE_RATE });
    const promised = payback(PAYBACK_DEFAULTS);
    expect(plain.bookedCentsPerMonth).toBeLessThan(promised.bookedCentsPerMonth);
    expect(plain.bookedCentsPerMonth).toBe(46_000);
  });

  it('clamps rates and never returns a negative month', () => {
    expect(payback({ ...PAYBACK_DEFAULTS, missedPerWeek: -2 }).bookedCentsPerMonth).toBe(0);
    expect(payback({ ...PAYBACK_DEFAULTS, leaveRate: 2 }).messagesPerMonth).toBeCloseTo(21.67, 2);
    expect(payback({ ...PAYBACK_DEFAULTS, priceCents: 0 }).timesPrice).toBe(0);
  });
});
