import { parseInvoiceSpeech } from './invoice-parser';
import { lineAmountCents } from './money';
import type { Cents, Invoice, Job, Message, PastInvoice } from './types';

/**
 * "Kept this week": what the machine saved the owner over the last seven days. Pure and
 * deterministic; every dollar figure is computed in integer cents from stored records.
 */
export interface KeptStats {
  /** Messages received in the window. */
  calls: number;
  /** Of those, callers who were texted a booking link. */
  textedBack: number;
  /** Of those, callers who booked a visit from the text. */
  booked: number;
  /** Booked jobs at their invoiced total, or at the owner's median past invoice while not yet billed. */
  bookedValueCents: Cents;
  /** Money the owner corrected on sent invoices before the customer saw them (misheard prices and quantities). */
  caughtCents: Cents;
}

export const KEPT_WINDOW_DAYS = 7;

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}

/** The owner's median invoice before tax, from past invoices. */
export function typicalJobCents(pastInvoices: readonly PastInvoice[]): Cents {
  return median(pastInvoices.map((p) => p.lines.reduce((sum, l) => sum + lineAmountCents(l.quantity, l.unitPriceCents), 0)));
}

/**
 * How much the owner changed on one sent line compared with what was first heard. Each line keeps
 * the words it was built from, so the first reading is re-parsed here rather than trusted from the client.
 */
export function caughtOnLine(line: Invoice['lines'][number]): Cents {
  const [first] = parseInvoiceSpeech(line.heard, { laborTaxable: false, newId: () => 'heard' }).lines;
  if (!first || first.unitPriceCents === 0) return 0;
  const heard = lineAmountCents(first.quantity, first.unitPriceCents);
  const sent = lineAmountCents(line.quantity, line.unitPriceCents);
  return Math.abs(heard - sent);
}

export function keptThisWeek(
  db: { messages: readonly Message[]; jobs: readonly Job[]; invoices: readonly Invoice[]; pastInvoices: readonly PastInvoice[] },
  now: Date,
): KeptStats {
  const since = now.getTime() - KEPT_WINDOW_DAYS * 86_400_000;
  const recent = db.messages.filter((m) => Date.parse(m.receivedAt) >= since);
  const typical = typicalJobCents(db.pastInvoices);
  let bookedValueCents = 0;
  let booked = 0;
  for (const m of recent) {
    const job = m.jobId ? db.jobs.find((j) => j.id === m.jobId) : undefined;
    if (!job) continue;
    booked++;
    const invoice = job.invoiceId ? db.invoices.find((i) => i.id === job.invoiceId) : undefined;
    bookedValueCents += invoice ? invoice.totals.subtotalCents : typical;
  }
  const caughtCents = db.invoices
    .filter((i) => Date.parse(i.createdAt) >= since)
    .flatMap((i) => i.lines)
    .reduce((sum, line) => sum + caughtOnLine(line), 0);
  return {
    calls: recent.length,
    textedBack: recent.filter((m) => m.textedAt !== null).length,
    booked,
    bookedValueCents,
    caughtCents,
  };
}
