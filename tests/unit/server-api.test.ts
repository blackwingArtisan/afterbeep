import { beforeEach, describe, expect, it } from 'vitest';
import { localAdapters } from '../../src/adapters';
import { MemoryStore } from '../../src/adapters/store/local';
import type { Invoice, InvoiceLine, Job, Message, OutboxItem } from '../../src/domain/types';
import { createApp } from '../../src/server/app';
import { sampleInvoiceScripts, simulatorScripts } from '../../src/server/seed';
import { seedDb } from '../../src/server/seed-db';

// Monday 2026-11-16 at 14:30 in Columbus.
const NOW = new Date('2026-11-16T19:30:00Z');
const BASE = 'https://afterbeep.example.com';

async function setup() {
  let n = 0;
  const newId = () => `id${String(++n).padStart(4, '0')}`;
  const clock = () => NOW;
  const store = new MemoryStore(await seedDb(NOW, newId, BASE));
  const app = createApp(
    { store, adapters: localAdapters({ store, clock, newId, publicBaseUrl: BASE }), clock, newId, publicBaseUrl: BASE },
    { webhookSecret: 'test-secret' },
  );
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

let ctx: Awaited<ReturnType<typeof setup>>;
beforeEach(async () => {
  ctx = await setup();
});

describe('seeded machine', () => {
  it('starts with three new messages, each already texted back', async () => {
    const { body } = await ctx.call<{ messages: Message[]; newCount: number }>('GET', '/api/messages');
    expect(body.newCount).toBe(3);
    expect(body.messages.map((m) => m.extraction.callerName)).toEqual(['Gus Lindqvist', 'Edith Marsh', 'Priya Natarajan']);
    expect(body.messages.every((m) => m.textedAt)).toBe(true);
    const outbox = (await ctx.call<{ outbox: OutboxItem[] }>('GET', '/api/outbox')).body.outbox;
    expect(outbox).toHaveLength(3);
    expect(outbox.find((o) => o.to === '+16145550179')?.body).toContain(`${BASE}/book/`);
  });

  it('reports local adapters', async () => {
    const { body } = await ctx.call<{ adapters: Record<string, string> }>('GET', '/api/health');
    expect(body.adapters).toEqual({ transcriber: 'local', extractor: 'rules', sms: 'outbox', invoices: 'local' });
  });
});

describe('missed call to booked job', () => {
  it('runs the whole pipeline', async () => {
    const sample = simulatorScripts.find((s) => s.id === 'no-heat')!;
    const created = await ctx.call<{ message: Message }>('POST', '/api/calls', { from: '614-555-0163', transcript: sample.transcript });
    expect(created.status).toBe(201);
    const message = created.body.message;
    expect(message.extraction).toMatchObject({ callerName: 'Hector Alvarez', urgency: 'emergency', address: '41 Lantern Hill Drive' });

    const text = (await ctx.call<{ outbox: OutboxItem[] }>('GET', '/api/outbox')).body.outbox[0]!;
    expect(text).toMatchObject({ kind: 'sms', to: '+16145550163', linkPath: `/book/${message.bookingToken}` });
    expect(text.body).toMatch(/^Hi Hector, it's Morgan at Hollow Creek/);

    const view = await ctx.call<{ slots: { start: string; end: string }[]; booked: unknown }>('GET', text.linkPath!.replace('/book', '/api/book'));
    expect(view.status).toBe(200);
    expect(view.body.booked).toBeNull();
    const slot = view.body.slots[0]!;
    expect(slot.start).toBe('2026-11-17T13:00:00.000Z');

    const booked = await ctx.call<{ job: Job }>('POST', `/api/book/${message.bookingToken}`, slot);
    expect(booked.status).toBe(201);
    expect(booked.body.job).toMatchObject({ customerName: 'Hector Alvarez', start: slot.start, status: 'scheduled' });

    const again = await ctx.call<{ error: string }>('POST', `/api/book/${message.bookingToken}`, slot);
    expect(again).toMatchObject({ status: 409, body: { error: 'already-booked' } });

    const messages = (await ctx.call<{ messages: Message[] }>('GET', '/api/messages')).body.messages;
    expect(messages.find((m) => m.id === message.id)).toMatchObject({ status: 'new', jobId: booked.body.job.id });
    const confirm = (await ctx.call<{ outbox: OutboxItem[] }>('GET', '/api/outbox')).body.outbox[0]!;
    expect(confirm.body).toContain("You're booked, Hector: Tue, Nov 17, 8:00 AM-10:00 AM");
  });

  it('refuses a slot someone else just took', async () => {
    const msgs = (await ctx.call<{ messages: Message[] }>('GET', '/api/messages')).body.messages;
    const [a, b] = msgs;
    const slots = (await ctx.call<{ slots: { start: string; end: string }[] }>('GET', `/api/book/${a!.bookingToken}`)).body.slots;
    expect((await ctx.call('POST', `/api/book/${a!.bookingToken}`, slots[0])).status).toBe(201);
    const taken = await ctx.call<{ error: string }>('POST', `/api/book/${b!.bookingToken}`, slots[0]);
    expect(taken).toMatchObject({ status: 409, body: { error: 'slot-taken' } });
  });

  it('rejects unknown tokens, bad caller IDs and empty bodies', async () => {
    expect((await ctx.call('GET', '/api/book/nope')).status).toBe(404);
    expect((await ctx.call('POST', '/api/calls', { from: '12', transcript: 'hi' })).status).toBe(400);
    expect((await ctx.call('POST', '/api/calls', { from: 'not a phone', transcript: 'hi there' })).status).toBe(400);
  });

  it('marks a message heard', async () => {
    const [m] = (await ctx.call<{ messages: Message[] }>('GET', '/api/messages')).body.messages;
    const res = await ctx.call<{ message: Message }>('POST', `/api/messages/${m!.id}/status`, { status: 'heard' });
    expect(res.body.message.status).toBe('heard');
  });
});

describe('phone webhook (real path entry point)', () => {
  const hook = { contactId: 'c-1', callerNumber: '+16145550150', recordingUri: 's3://bucket/recording.wav' };
  it('requires the shared secret', async () => {
    expect((await ctx.call('POST', '/api/hooks/connect-voicemail', hook)).status).toBe(401);
  });
  it('reports that the local transcriber cannot read audio', async () => {
    const res = await ctx.call<{ error: string }>('POST', '/api/hooks/connect-voicemail', hook, { authorization: 'Bearer test-secret' });
    expect(res).toMatchObject({ status: 422, body: { error: 'transcription-failed' } });
  });
});

describe('spoken invoice to approved bill', () => {
  type Draft = { draft: { title: string; lines: InvoiceLine[]; blocked: boolean; totals: { totalCents: number }; checks: { status: string }[] }; customer: { name: string } | null; jobId: string | null };

  async function finishedJob() {
    const { jobs } = (await ctx.call<{ jobs: Job[] }>('GET', '/api/jobs')).body;
    return jobs.find((j) => j.status === 'done')!;
  }

  it('drafts, holds a bad price, and sends only the approved exact total', async () => {
    const job = await finishedJob();
    const speech = sampleInvoiceScripts.find((s) => s.id === 'slip')!.speech;
    const { body } = await ctx.call<Draft>('POST', '/api/invoices/draft', { speech, jobId: job.id });
    expect(body.customer?.name).toBe('Wendell Ashgrove');
    expect(body.draft.title).toBe('Dryer');
    expect(body.draft.blocked).toBe(true);

    const base = { jobId: job.id, title: 'Dryer repair', customer: { ...body.customer!, email: 'wendell.ashgrove@example.com' } };
    const held = await ctx.call<{ error: string }>('POST', '/api/invoices/send', { ...base, lines: body.draft.lines, approvedTotalCents: body.draft.totals.totalCents });
    expect(held).toMatchObject({ status: 422, body: { error: 'needs-decision' } });

    const fixed = body.draft.lines.map((l, i) => (i === 0 ? { ...l, unitPriceCents: 5000, priceSource: 'owner' } : l));
    const quote = (await ctx.call<{ quote: { blocked: boolean; totals: { totalCents: number } } }>('POST', '/api/invoices/quote', { lines: fixed })).body.quote;
    expect(quote).toMatchObject({ blocked: false, totals: { totalCents: 18288 } });

    const mismatch = await ctx.call<{ error: string }>('POST', '/api/invoices/send', { ...base, lines: fixed, approvedTotalCents: 18287 });
    expect(mismatch).toMatchObject({ status: 409, body: { error: 'total-mismatch' } });

    const sent = await ctx.call<{ invoice: Invoice }>('POST', '/api/invoices/send', { ...base, lines: fixed, approvedTotalCents: 18288 });
    expect(sent.status).toBe(201);
    expect(sent.body.invoice).toMatchObject({ number: 'HC-1016', customerUrl: `/i/${sent.body.invoice.id}`, totals: { totalCents: 18288, taxCents: 288 } });

    const page = await ctx.call<{ invoice: Invoice; business: { name: string } }>('GET', `/api/invoices/${sent.body.invoice.id}`);
    expect(page.body.business.name).toBe('Hollow Creek Plumbing & Appliance');
    const outbox = (await ctx.call<{ outbox: OutboxItem[] }>('GET', '/api/outbox')).body.outbox[0]!;
    expect(outbox).toMatchObject({ kind: 'invoice', to: 'wendell.ashgrove@example.com' });
    expect(outbox.body).toContain('$182.88');

    const jobAfter = (await ctx.call<{ jobs: Job[] }>('GET', '/api/jobs')).body.jobs.find((j) => j.id === job.id);
    expect(jobAfter).toMatchObject({ status: 'invoiced', invoiceId: sent.body.invoice.id });
    const twice = await ctx.call<{ error: string }>('POST', '/api/invoices/send', { ...base, lines: fixed, approvedTotalCents: 18288 });
    expect(twice).toMatchObject({ status: 409, body: { error: 'already-invoiced' } });
  });

  it('ignores totals the client tries to inject and recomputes from lines', async () => {
    const speech = sampleInvoiceScripts.find((s) => s.id === 'clean')!.speech;
    const { body } = await ctx.call<Draft>('POST', '/api/invoices/draft', { speech });
    const tampered = { lines: body.draft.lines, totals: { totalCents: 1 } };
    const quote = (await ctx.call<{ quote: { totals: { totalCents: number } } }>('POST', '/api/invoices/quote', tampered)).body.quote;
    expect(quote.totals.totalCents).toBe(56292);
  });

  it('grows the price book with every sent invoice', async () => {
    const before = (await ctx.call<{ entries: { key: string; count: number }[] }>('GET', '/api/price-book')).body.entries;
    const speech = sampleInvoiceScripts.find((s) => s.id === 'clean')!.speech;
    const { body } = await ctx.call<Draft>('POST', '/api/invoices/draft', { speech });
    await ctx.call('POST', '/api/invoices/send', {
      jobId: null,
      title: 'Dryer repair',
      customer: { name: 'Pat Doe', phone: '(614) 555-0110', email: null, address: null },
      lines: body.draft.lines,
      approvedTotalCents: body.draft.totals.totalCents,
    });
    const after = (await ctx.call<{ entries: { key: string; count: number }[] }>('GET', '/api/price-book')).body.entries;
    const count = (entries: typeof before) => entries.find((e) => e.key === 'drum motor')!.count;
    expect(count(after)).toBe(count(before) + 1);
  });

  it('rejects malformed lines', async () => {
    const res = await ctx.call<{ error: string }>('POST', '/api/invoices/quote', { lines: [{ id: 'x', quantity: 1.234 }] });
    expect(res).toMatchObject({ status: 400, body: { error: 'invalid-request' } });
  });
});
