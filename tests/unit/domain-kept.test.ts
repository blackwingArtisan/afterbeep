import { describe, expect, it } from 'vitest';
import { caughtOnLine, keptThisWeek, typicalJobCents } from '../../src/domain/kept';
import type { Invoice, InvoiceLine, Job, Message } from '../../src/domain/types';
import { pastInvoices } from '../../src/server/seed';

const NOW = new Date('2026-11-16T19:30:00Z');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

function message(id: string, receivedAt: string, extra: Partial<Message> = {}): Message {
  return {
    id,
    receivedAt,
    from: '+16145550100',
    durationSec: 12,
    transcript: 'test',
    extraction: { callerName: null, callbackNumber: null, address: null, job: 'Leak', jobCategory: 'leak', urgency: 'routine', summary: '', source: 'rules' },
    status: 'new',
    bookingToken: `t-${id}`,
    textedAt: receivedAt,
    noTextReason: null,
    jobId: null,
    ...extra,
  };
}

function line(heard: string, quantity: number, unitPriceCents: number): InvoiceLine {
  return {
    id: heard,
    description: heard,
    kind: 'part',
    quantity,
    unit: 'each',
    unitPriceCents,
    taxable: true,
    priceSource: 'owner',
    heard,
    alternativesCents: [],
    confirmedPriceCents: null,
    confirmedQuantity: null,
    unplacedNumbers: [],
    note: null,
  };
}

describe('kept this week', () => {
  it('[MC 6.6] uses the median past invoice before tax as the value of a booked, unbilled job', () => {
    expect(typicalJobCents(pastInvoices)).toBe(33050);
  });

  it('[MC 6.6] counts a price the owner corrected from what was first heard', () => {
    expect(caughtOnLine(line('Dryer belt fifteen, taxed', 1, 5000))).toBe(3500);
    expect(caughtOnLine(line('forty water heater elements at eighty nine', 1, 8900))).toBe(39 * 8900);
    expect(caughtOnLine(line('One hour labor at eighty-five', 1, 8500))).toBe(0);
    expect(caughtOnLine(line('Trip charge', 1, 4500))).toBe(0);
  });

  it('[MC 6.6] adds up calls, text-backs, bookings and corrections from the last seven days only', () => {
    const job: Job = {
      id: 'j1', messageId: 'm2', customerName: 'Ivy Sloane', phone: '(614) 555-0101', email: null, address: null,
      description: 'Leak', urgency: 'routine', start: hoursAgo(-20), end: hoursAgo(-22), status: 'scheduled', invoiceId: null,
    };
    const invoice = { id: 'i1', createdAt: hoursAgo(1), lines: [line('Dryer belt fifteen, taxed', 1, 5000)], totals: { subtotalCents: 18000 } } as unknown as Invoice;
    const stats = keptThisWeek(
      {
        messages: [
          message('m1', hoursAgo(2)),
          message('m2', hoursAgo(3), { jobId: 'j1' }),
          message('m3', hoursAgo(4), { textedAt: null, noTextReason: 'hang-up' }),
          message('old', hoursAgo(24 * 9), { jobId: 'j1' }),
        ],
        jobs: [job],
        invoices: [invoice],
        pastInvoices,
      },
      NOW,
    );
    expect(stats).toEqual({ calls: 3, textedBack: 2, booked: 1, bookedValueCents: 33050, caughtCents: 3500 });
  });
});
