import { describe, expect, it } from 'vitest';
import { localAdapters } from '../../src/adapters';
import { InvoiceProviderError, type InvoiceProvider } from '../../src/adapters/invoices/types';
import { MemoryStore } from '../../src/adapters/store/local';
import type { Transcriber } from '../../src/adapters/transcriber/types';
import type { Invoice, InvoiceLine, Job, Message, OutboxItem } from '../../src/domain/types';
import { bearerMatches, createApp } from '../../src/server/app';
import { addDays, localDate } from '../../src/server/services/invoicing';
import { sampleInvoiceScripts } from '../../src/server/seed';
import { seedDb } from '../../src/server/seed-db';

const BASE = 'https://afterbeep.example.com';
const SECRET = 'test-secret';

/** A transcriber that "reads" a recording slowly, like Amazon Transcribe does. */
const slowTranscriber: Transcriber = {
  name: 'fake-audio',
  transcribe: async () => {
    await new Promise((r) => setTimeout(r, 20));
    return { text: 'Hi, this is Dana Whitlock, my kitchen faucet is dripping, please call me back.', provider: 'fake-audio' };
  },
};

async function setup(now: Date, invoices?: (local: InvoiceProvider) => InvoiceProvider) {
  let n = 0;
  const newId = () => `id${String(++n).padStart(4, '0')}`;
  const clock = () => now;
  const store = new MemoryStore(await seedDb(now, newId, BASE));
  const local = localAdapters({ store, clock, newId, publicBaseUrl: BASE });
  const adapters = { ...local, transcriber: slowTranscriber, invoices: invoices ? invoices(local.invoices) : local.invoices };
  const app = createApp({ store, adapters, clock, newId, publicBaseUrl: BASE }, { webhookSecret: SECRET, simulator: true });
  const call = async <T = unknown>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const res = await app.request(path, {
      method,
      headers: { 'content-type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as T };
  };
  return { store, call };
}

type Ctx = Awaited<ReturnType<typeof setup>>;

describe('phone webhook hardening', () => {
  const NOW = new Date('2026-11-16T19:30:00Z');
  const hook = { contactId: 'contact-7f3a', callerNumber: '+16145550150', recordingUri: 's3://bucket/recording.wav' };
  const auth = { authorization: `Bearer ${SECRET}` };

  it('[MC 1.2, 1.6] matches the secret in constant time and refuses near misses', () => {
    expect(bearerMatches(`Bearer ${SECRET}`, SECRET)).toBe(true);
    for (const wrong of [undefined, '', SECRET, `Bearer ${SECRET}x`, `Bearer ${SECRET.slice(0, -1)}`, `bearer ${SECRET}`]) {
      expect(bearerMatches(wrong, SECRET)).toBe(false);
    }
  });

  it('[MC 1.5] files and texts a retried contact only once', async () => {
    const ctx = await setup(NOW);
    const outboxBefore = (await ctx.call<{ outbox: OutboxItem[] }>('GET', '/api/outbox')).body.outbox.length;
    const first = await ctx.call<{ messageId: string }>('POST', '/api/hooks/connect-voicemail', hook, auth);
    expect(first.status).toBe(201);
    const retry = await ctx.call<{ messageId: string; duplicate: boolean }>('POST', '/api/hooks/connect-voicemail', hook, auth);
    expect(retry).toMatchObject({ status: 200, body: { messageId: first.body.messageId, duplicate: true } });
    const messages = (await ctx.call<{ messages: Message[] }>('GET', '/api/messages')).body.messages;
    expect(messages.filter((m) => m.contactId === hook.contactId)).toHaveLength(1);
    expect((await ctx.call<{ outbox: OutboxItem[] }>('GET', '/api/outbox')).body.outbox).toHaveLength(outboxBefore + 1);
  });

  it('[MC 1.5] files one message when two reports of the same contact arrive at once', async () => {
    const ctx = await setup(NOW);
    const [a, b] = await Promise.all([
      ctx.call<{ messageId: string }>('POST', '/api/hooks/connect-voicemail', hook, auth),
      ctx.call<{ messageId: string }>('POST', '/api/hooks/connect-voicemail', hook, auth),
    ]);
    expect(a.body.messageId).toBe(b.body.messageId);
    const messages = (await ctx.call<{ messages: Message[] }>('GET', '/api/messages')).body.messages;
    expect(messages.filter((m) => m.contactId === hook.contactId)).toHaveLength(1);
  });
});

describe('sending an invoice safely', () => {
  type Draft = { draft: { lines: InvoiceLine[]; totals: { totalCents: number } }; customer: { name: string; phone: string; email: string | null; address: string | null } | null };

  async function readyInvoice(ctx: Ctx) {
    const job = (await ctx.call<{ jobs: Job[] }>('GET', '/api/jobs')).body.jobs.find((j) => j.status === 'done')!;
    const speech = sampleInvoiceScripts.find((s) => s.id === 'slip')!.speech;
    const { draft, customer } = (await ctx.call<Draft>('POST', '/api/invoices/draft', { speech, jobId: job.id })).body;
    const lines = draft.lines.map((l, i) => (i === 0 ? { ...l, unitPriceCents: 5000, priceSource: 'owner' } : l));
    return { job, input: { jobId: job.id, title: 'Dryer repair', customer: customer!, lines, approvedTotalCents: 18_288 } };
  }

  const slow = (local: InvoiceProvider): InvoiceProvider => ({
    name: local.name,
    send: async (invoice, business) => {
      await new Promise((r) => setTimeout(r, 20));
      return local.send(invoice, business);
    },
  });

  it('[VI 4.10] lets only one of two simultaneous sends invoice the same job', async () => {
    const ctx = await setup(new Date('2026-11-16T19:30:00Z'), slow);
    const { input } = await readyInvoice(ctx);
    const results = await Promise.all([
      ctx.call<{ invoice?: Invoice; error?: string }>('POST', '/api/invoices/send', input),
      ctx.call<{ invoice?: Invoice; error?: string }>('POST', '/api/invoices/send', input),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(results.find((r) => r.status === 409)?.body.error).toBe('already-invoiced');
    expect(ctx.store.read().invoices.filter((i) => i.jobId === input.jobId)).toHaveLength(1);
  });

  it('[VI 4.10] never gives two invoices sent at once the same number', async () => {
    const ctx = await setup(new Date('2026-11-16T19:30:00Z'), slow);
    const { input } = await readyInvoice(ctx);
    const loose = { ...input, jobId: null };
    const [a, b] = await Promise.all([
      ctx.call<{ invoice: Invoice }>('POST', '/api/invoices/send', loose),
      ctx.call<{ invoice: Invoice }>('POST', '/api/invoices/send', loose),
    ]);
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(new Set([a.body.invoice.number, b.body.invoice.number]).size).toBe(2);
  });

  it('[VI 4.10] releases the job and the number when the provider fails, so a retry succeeds', async () => {
    let fail = true;
    const flaky = (local: InvoiceProvider): InvoiceProvider => ({
      name: local.name,
      send: async (invoice, business) => {
        if (fail) throw new InvoiceProviderError('The invoice service is not answering');
        return local.send(invoice, business);
      },
    });
    const ctx = await setup(new Date('2026-11-16T19:30:00Z'), flaky);
    const { job, input } = await readyInvoice(ctx);
    const numberBefore = ctx.store.read().nextInvoiceNumber;
    const failed = await ctx.call<{ error: string }>('POST', '/api/invoices/send', input);
    expect(failed).toMatchObject({ status: 503, body: { error: 'provider-failed' } });
    expect(ctx.store.read().jobs.find((j) => j.id === job.id)).toMatchObject({ status: 'done', invoiceId: null });
    expect(ctx.store.read().nextInvoiceNumber).toBe(numberBefore);

    fail = false;
    const sent = await ctx.call<{ invoice: Invoice }>('POST', '/api/invoices/send', input);
    expect(sent.status).toBe(201);
    expect(sent.body.invoice.number).toBe(`HC-${numberBefore}`);
  });

  it('[VI 5.6] dates an evening invoice by the local day, not the UTC day', async () => {
    // 8:30 PM on Monday November 16 in Columbus is already Tuesday in UTC.
    const evening = new Date('2026-11-17T01:30:00Z');
    expect(localDate(evening, 'America/New_York')).toBe('2026-11-16');
    const ctx = await setup(evening);
    const { input } = await readyInvoice(ctx);
    const sent = await ctx.call<{ invoice: Invoice }>('POST', '/api/invoices/send', input);
    expect(sent.status).toBe(201);
    expect(sent.body.invoice).toMatchObject({ issueDate: '2026-11-16', dueDate: '2026-11-30' });
    expect(ctx.store.read().pastInvoices.at(-1)?.date).toBe('2026-11-16');
  });

  it('[VI 5.6] adds calendar days across a month and a daylight-saving change', () => {
    expect(addDays('2026-10-25', 14)).toBe('2026-11-08');
    expect(addDays('2026-12-25', 14)).toBe('2027-01-08');
  });
});
