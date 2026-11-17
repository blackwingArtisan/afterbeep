import type { InvoiceDraft, Quote } from '../domain/invoice-draft';
import type { PriceBookEntry } from '../domain/price-book';
import type { Slot } from '../domain/slots';
import type { Business, Customer, Invoice, InvoiceLine, Job, Message, OutboxItem, Urgency } from '../domain/types';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: unknown,
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new ApiError(res.status, String(data.error ?? 'error'), String(data.message ?? res.statusText), data.details);
  }
  return data as T;
}

export interface Sample {
  id: string;
  label: string;
  from: string;
  durationSec: number;
  transcript: string;
}
export interface InvoiceScript {
  id: string;
  label: string;
  speech: string;
}
export interface BookingView {
  business: { name: string; ownerName: string; phone: string; timezone: string };
  caller: { name: string | null; job: string; address: string | null; urgency: Urgency };
  slots: Slot[];
  booked: Slot | null;
}
export interface PublicInvoice {
  invoice: Invoice;
  business: { name: string; phone: string; email: string; address: Business['address'] };
}

export const api = {
  business: () => request<{ business: Business; taxRateMilli: number }>('GET', '/business'),
  messages: () => request<{ messages: Message[]; newCount: number }>('GET', '/messages'),
  setStatus: (id: string, status: 'new' | 'heard' | 'called-back') =>
    request<{ message: Message }>('POST', `/messages/${id}/status`, { status }),
  call: (from: string, transcript: string, durationSec?: number) =>
    request<{ message: Message }>('POST', '/calls', { from, transcript, durationSec }),
  samples: () => request<{ voicemails: Sample[]; invoiceScripts: InvoiceScript[] }>('GET', '/samples'),
  booking: (token: string) => request<BookingView>('GET', `/book/${token}`),
  book: (token: string, slot: Slot, address: string | null) =>
    request<{ job: Job }>('POST', `/book/${token}`, { ...slot, address }),
  jobs: () => request<{ jobs: Job[] }>('GET', '/jobs'),
  outbox: () => request<{ outbox: OutboxItem[] }>('GET', '/outbox'),
  priceBook: () => request<{ entries: PriceBookEntry[] }>('GET', '/price-book'),
  draft: (speech: string, jobId: string | null) =>
    request<{ draft: InvoiceDraft; customer: Customer | null; jobId: string | null }>('POST', '/invoices/draft', { speech, jobId }),
  quote: (lines: InvoiceLine[]) => request<{ quote: Quote }>('POST', '/invoices/quote', { lines }),
  send: (input: { jobId: string | null; title: string; customer: Customer; lines: InvoiceLine[]; approvedTotalCents: number }) =>
    request<{ invoice: Invoice }>('POST', '/invoices/send', input),
  invoices: () => request<{ invoices: Invoice[] }>('GET', '/invoices'),
  invoice: (id: string) => request<PublicInvoice>('GET', `/invoices/${id}`),
  reset: () => request<{ ok: true }>('POST', '/demo/reset'),
};
