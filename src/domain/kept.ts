import { parseInvoiceSpeech } from './invoice-parser';
import { formatCents, lineAmountCents } from './money';
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
  /** Booked jobs at their invoiced subtotal, else the owner's quote, else the owner's median past invoice. */
  bookedValueCents: Cents;
  /** Money the owner corrected on sent invoices before the customer saw them (misheard prices and quantities). */
  caughtCents: Cents;
}

export const KEPT_WINDOW_DAYS = 7;

/** How many times over the booked work pays one month of AfterBeep, rounded down. */
export function timesPrice(bookedValueCents: Cents, priceCents: Cents = 3_900): number {
  return priceCents > 0 ? Math.floor(bookedValueCents / priceCents) : 0;
}

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
  const heard = heardAmountCents(line);
  return heard === null ? 0 : Math.abs(heard - lineAmountCents(line.quantity, line.unitPriceCents));
}

/** The line amount as first heard, or null when no price was spoken. */
export function heardAmountCents(line: Invoice['lines'][number]): Cents | null {
  const [first] = parseInvoiceSpeech(line.heard, { laborTaxable: false, newId: () => 'heard' }).lines;
  if (!first || first.unitPriceCents === 0) return null;
  return lineAmountCents(first.quantity, first.unitPriceCents);
}

/** The stamp a line gets on the printed office copy: what the price check did with it. */
export interface CarbonStamp {
  tone: 'caught' | 'ok' | 'info';
  label: string;
  detail: string | null;
}

export function carbonStamp(line: Invoice['lines'][number]): CarbonStamp {
  const heard = heardAmountCents(line);
  const sent = lineAmountCents(line.quantity, line.unitPriceCents);
  if (heard !== null && heard !== sent) {
    return { tone: 'caught', label: 'Caught', detail: `heard ${formatCents(heard)}, billed ${formatCents(sent)}` };
  }
  if (line.priceSource === 'price-book') return { tone: 'info', label: 'From your copies', detail: null };
  if (line.confirmedPriceCents !== null) return { tone: 'ok', label: 'Owner confirmed', detail: null };
  return { tone: 'ok', label: 'Price checked', detail: null };
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
  // A call raised from the graveyard this week and booked counts as a booking this week.
  const bookable = db.messages.filter((m) => Date.parse(m.receivedAt) >= since || (m.raisedAt && Date.parse(m.raisedAt) >= since));
  for (const m of bookable) {
    const job = m.jobId ? db.jobs.find((j) => j.id === m.jobId) : undefined;
    if (!job) continue;
    booked++;
    const invoice = job.invoiceId ? db.invoices.find((i) => i.id === job.invoiceId) : undefined;
    bookedValueCents += invoice ? invoice.totals.subtotalCents : (job.quotedCents ?? typical);
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
