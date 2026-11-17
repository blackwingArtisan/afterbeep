import { z } from 'zod';
import { InvoiceProviderError } from '../../adapters/invoices/types';
import type { Db } from '../../adapters/store/types';
import { draftFromSpeech, quoteLines, type InvoiceDraft, type Quote } from '../../domain/invoice-draft';
import { buildPriceBook } from '../../domain/price-book';
import { businessTaxRateMilli } from '../../domain/tax';
import type { Customer, Invoice, InvoiceLine, Job, PastInvoice } from '../../domain/types';
import { ServiceError, type Deps } from './deps';

const cents = z.number().int().min(0).max(10_000_000);

export const InvoiceLineSchema = z.object({
  id: z.string().min(1).max(64),
  description: z.string().trim().min(1).max(120),
  kind: z.enum(['part', 'labor', 'fee']),
  quantity: z
    .number()
    .positive()
    .max(1000)
    .refine((q) => Math.abs(Math.round(q * 100) - q * 100) < 1e-6, 'At most two decimal places'),
  unit: z.enum(['each', 'hour', 'flat']),
  unitPriceCents: cents,
  taxable: z.boolean(),
  priceSource: z.enum(['spoken', 'price-book', 'owner']),
  heard: z.string().max(400),
  alternativesCents: z.array(cents).max(4),
  confirmedPriceCents: cents.nullable(),
  note: z.string().max(300).nullable(),
});

export const CustomerSchema = z.object({
  name: z.string().trim().min(1).max(80),
  phone: z.string().trim().min(7).max(32),
  email: z.string().trim().email().max(120).nullable(),
  address: z.string().trim().max(160).nullable(),
});

export const SendInvoiceSchema = z.object({
  jobId: z.string().nullable(),
  title: z.string().trim().min(1).max(120),
  customer: CustomerSchema,
  lines: z.array(InvoiceLineSchema).min(1).max(40),
  approvedTotalCents: cents,
});

export type SendInvoiceInput = z.infer<typeof SendInvoiceSchema>;

function pricingContext(db: Db) {
  return {
    book: buildPriceBook(db.pastInvoices),
    taxRateMilli: businessTaxRateMilli(db.business),
    laborTaxable: db.business.laborTaxable,
  };
}

function customerFromJob(job: Job | undefined): Customer | null {
  if (!job) return null;
  return { name: job.customerName, phone: job.phone, email: job.email, address: job.address };
}

export interface DraftResponse {
  draft: InvoiceDraft;
  customer: Customer | null;
  jobId: string | null;
}

export function draftInvoice(deps: Deps, speech: string, jobId: string | null): DraftResponse {
  const db = deps.store.read();
  const job = jobId ? db.jobs.find((j) => j.id === jobId) : undefined;
  if (jobId && !job) throw new ServiceError(404, 'not-found', 'No such job');
  const draft = draftFromSpeech(speech, { ...pricingContext(db), newId: deps.newId });
  if (!draft.title && job) draft.title = job.description.split(':')[0]!;
  return { draft, customer: customerFromJob(job), jobId: job?.id ?? null };
}

export function quoteInvoice(deps: Deps, lines: InvoiceLine[]): Quote {
  return quoteLines(lines, pricingContext(deps.store.read()));
}

function invoicePrefix(businessName: string): string {
  return (
    businessName
      .split(/\s+/)
      .filter((w) => /^[A-Za-z]/.test(w))
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join('') || 'INV'
  );
}

function addDays(date: Date, days: number): string {
  return new Date(date.getTime() + days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Sends an invoice only if nothing is on hold and the total the owner approved equals the total the
 * server computes from the same lines. Code computes every number; the client's totals are ignored.
 */
export async function sendInvoice(deps: Deps, input: SendInvoiceInput): Promise<Invoice> {
  const db = deps.store.read();
  const quote = quoteLines(input.lines, pricingContext(db));
  if (quote.blocked) {
    throw new ServiceError(422, 'needs-decision', 'Some prices still need your decision', { checks: quote.checks });
  }
  if (quote.totals.totalCents !== input.approvedTotalCents) {
    throw new ServiceError(409, 'total-mismatch', 'The total changed since you approved it. Review and approve again.', {
      totals: quote.totals,
    });
  }
  const job = input.jobId ? db.jobs.find((j) => j.id === input.jobId) : undefined;
  if (input.jobId && !job) throw new ServiceError(404, 'not-found', 'No such job');
  if (job?.invoiceId) throw new ServiceError(409, 'already-invoiced', 'This job already has an invoice');

  const now = deps.clock();
  const invoice: Invoice = {
    id: deps.newId(),
    number: `${invoicePrefix(db.business.name)}-${db.nextInvoiceNumber}`,
    jobId: job?.id ?? null,
    title: input.title,
    customer: input.customer,
    lines: quote.lines,
    totals: quote.totals,
    status: 'sent',
    createdAt: now.toISOString(),
    dueDate: addDays(now, 14),
    provider: deps.adapters.invoices.name,
    providerRef: null,
    customerUrl: '',
  };

  let sent;
  try {
    sent = await deps.adapters.invoices.send(invoice, db.business);
  } catch (error) {
    if (error instanceof InvoiceProviderError) throw new ServiceError(503, 'provider-failed', error.message);
    throw error;
  }
  const final: Invoice = { ...invoice, provider: sent.provider, providerRef: sent.providerRef, customerUrl: sent.customerUrl };

  deps.store.update((state) => {
    state.invoices.push(final);
    state.nextInvoiceNumber += 1;
    const storedJob = final.jobId ? state.jobs.find((j) => j.id === final.jobId) : undefined;
    if (storedJob) {
      storedJob.status = 'invoiced';
      storedJob.invoiceId = final.id;
    }
    const history: PastInvoice = {
      id: final.id,
      number: final.number,
      date: final.createdAt.slice(0, 10),
      customerName: final.customer.name,
      lines: final.lines.map(({ description, kind, quantity, unit, unitPriceCents, taxable }) => ({
        description,
        kind,
        quantity,
        unit,
        unitPriceCents,
        taxable,
      })),
    };
    state.pastInvoices.push(history);
  });
  return final;
}

export interface PublicInvoice {
  invoice: Invoice;
  business: { name: string; phone: string; email: string; address: Db['business']['address'] };
}

export function publicInvoice(deps: Deps, id: string): PublicInvoice {
  const db = deps.store.read();
  const invoice = db.invoices.find((i) => i.id === id);
  if (!invoice) throw new ServiceError(404, 'not-found', 'Invoice not found');
  const { name, phone, email, address } = db.business;
  return { invoice, business: { name, phone, email, address } };
}
