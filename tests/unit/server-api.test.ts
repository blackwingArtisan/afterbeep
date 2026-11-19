import { beforeEach, describe, expect, it } from 'vitest';
import { localAdapters } from '../../src/adapters';
import { MemoryStore } from '../../src/adapters/store/local';
import { lineAmountCents } from '../../src/domain/money';
import type { Invoice, InvoiceLine, Job, Message, OutboxItem } from '../../src/domain/types';
import { createApp } from '../../src/server/app';
import { payDemoInvoice } from '../../src/server/services/invoicing';
import { sampleInvoiceScripts, simulatorScripts } from '../../src/server/seed';
import { seedDb } from '../../src/server/seed-db';

// Monday 2026-11-16 at 14:30 in Columbus.
const NOW = new Date('2026-11-16T19:30:00Z');
const BASE = 'https://afterbeep.example.com';

async function setup(simulator = true) {
  let n = 0;
  const newId = () => `id${String(++n).padStart(4, '0')}`;
  const clock = () => NOW;
  const store = new MemoryStore(await seedDb(NOW, newId, BASE));
  const app = createApp(
    { store, adapters: localAdapters({ store, clock, newId, publicBaseUrl: BASE }), clock, newId, publicBaseUrl: BASE },
    { webhookSecret: 'test-secret', simulator },
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
  it('[MC 4.1, 4.5, 6.1] starts with three new messages, each already texted back', async () => {
    const { body } = await ctx.call<{ messages: Message[]; newCount: number }>('GET', '/api/messages');
    expect(body.newCount).toBe(3);
    expect(body.messages.map((m) => m.extraction.callerName)).toEqual(['Gus Lindqvist', 'Edith Marsh', 'Priya Natarajan']);
    expect(body.messages.every((m) => m.textedAt)).toBe(true);
    const outbox = (await ctx.call<{ outbox: OutboxItem[] }>('GET', '/api/outbox')).body.outbox;
    // Three text-backs, plus the confirmation Priya got when she booked from hers.
    expect(outbox).toHaveLength(4);
    expect(outbox.filter((o) => o.body.includes(`${BASE}/book/`))).toHaveLength(3);
    expect(outbox.find((o) => o.to === '+16145550179')?.body).toContain(`${BASE}/book/`);
  });

  it('[MC 6.6] opens on Morgan\'s Tuesday: the emergency already booked at a $377 quote', async () => {
    const { messages } = (await ctx.call<{ messages: Message[] }>('GET', '/api/messages')).body;
    const priya = messages.find((m) => m.extraction.callerName === 'Priya Natarajan')!;
    expect(priya.jobId).not.toBeNull();
    const { jobs } = (await ctx.call<{ jobs: Job[] }>('GET', '/api/jobs')).body;
    expect(jobs.find((j) => j.id === priya.jobId)).toMatchObject({ urgency: 'emergency', quotedCents: 37_700 });
    const { kept } = (await ctx.call<{ kept: { calls: number; textedBack: number; booked: number; bookedValueCents: number; caughtCents: number } }>('GET', '/api/kept')).body;
    expect(kept).toEqual({ calls: 3, textedBack: 3, booked: 1, bookedValueCents: 37_700, caughtCents: 0 });
  });

  it('[MC 7.4] reports local adapters', async () => {
    const { body } = await ctx.call<{ adapters: Record<string, string> }>('GET', '/api/health');
    expect(body.adapters).toEqual({ transcriber: 'local', extractor: 'rules', sms: 'outbox', invoices: 'local' });
  });
});

describe('missed call to booked job', () => {
  it('[MC 2.2, 4.1, 4.2, 4.3, 5.1, 5.4, 5.6, 5.7] runs the whole pipeline', async () => {
    const sample = simulatorScripts.find((s) => s.id === 'no-heat')!;
    const created = await ctx.call<{ message: Message }>('POST', '/api/calls', { from: '614-555-0163', transcript: sample.transcript });
    expect(created.status).toBe(201);
    const message = created.body.message;
    expect(message.extraction).toMatchObject({ callerName: 'Hector Alvarez', urgency: 'emergency', address: '41 Lantern Hill Drive' });

    const text = (await ctx.call<{ outbox: OutboxItem[] }>('GET', '/api/outbox')).body.outbox[0]!;
    expect(text).toMatchObject({ kind: 'sms', to: '+16145550163', linkPath: `/book/${message.bookingToken}` });
    expect(text.body).toMatch(/^Hi Hector, it's Morgan at Hollow Creek/);
    // An emergency text promises a call back and still carries the booking link.
    expect(text.body).toContain("I'll call you back the minute I'm off this job");
    expect(text.body).toContain(`${BASE}/book/${message.bookingToken}`);

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

  it('[MC 5.10] offers no times and gives the business phone when the calendar is full', async () => {
    const db = ctx.store.read();
    ctx.store.replace({ ...db, business: { ...db.business, hours: [null, null, null, null, null, null, null] } });
    const message = db.messages.find((m) => m.textedAt && !m.jobId)!;
    const view = await ctx.call<{ slots: unknown[]; business: { phone: string } }>('GET', `/api/book/${message.bookingToken}`);
    expect(view.status).toBe(200);
    expect(view.body.slots).toEqual([]);
    expect(view.body.business.phone).toBe(db.business.phone);
  });

  it('[MC 5.5] refuses a slot someone else just took', async () => {
    const msgs = (await ctx.call<{ messages: Message[] }>('GET', '/api/messages')).body.messages;
    const [a, b] = msgs;
    const slots = (await ctx.call<{ slots: { start: string; end: string }[] }>('GET', `/api/book/${a!.bookingToken}`)).body.slots;
    expect((await ctx.call('POST', `/api/book/${a!.bookingToken}`, slots[0])).status).toBe(201);
    const taken = await ctx.call<{ error: string }>('POST', `/api/book/${b!.bookingToken}`, slots[0]);
    expect(taken).toMatchObject({ status: 409, body: { error: 'slot-taken' } });
  });

  it('[MC 1.4, 5.8] rejects unknown tokens, bad caller IDs and empty bodies', async () => {
    const bad = await ctx.call<{ details: { business: { name: string; phone: string } } }>('GET', '/api/book/nope');
    expect(bad.status).toBe(404);
    expect(bad.body.details.business).toEqual({ name: 'Hollow Creek Plumbing & Appliance', phone: '(614) 555-0142' });
    expect((await ctx.call('POST', '/api/calls', { from: '12', transcript: 'hi' })).status).toBe(400);
    expect((await ctx.call('POST', '/api/calls', { from: 'not a phone', transcript: 'hi there' })).status).toBe(400);
  });

  it('[VI 5.8] answers an unknown invoice link with the business card, not a blank page', async () => {
    const bad = await ctx.call<{ error: string; details: { business: { name: string; phone: string } } }>('GET', '/api/invoices/nope');
    expect(bad.status).toBe(404);
    expect(bad.body.error).toBe('not-found');
    expect(bad.body.details.business).toEqual({ name: 'Hollow Creek Plumbing & Appliance', phone: '(614) 555-0142' });
  });

  it('[MC 6.3] marks a message heard', async () => {
    const [m] = (await ctx.call<{ messages: Message[] }>('GET', '/api/messages')).body.messages;
    const res = await ctx.call<{ message: Message }>('POST', `/api/messages/${m!.id}/status`, { status: 'heard' });
    expect(res.body.message.status).toBe('heard');
  });
});

describe('text-back guards', () => {
  const outboxCount = async () => (await ctx.call<{ outbox: OutboxItem[] }>('GET', '/api/outbox')).body.outbox.length;

  it('[MC 4.6] files a hang-up without texting anyone', async () => {
    const before = await outboxCount();
    const res = await ctx.call<{ message: Message }>('POST', '/api/calls', { from: '614-555-0190', transcript: 'uh hello? hello? nobody there' });
    expect(res.status).toBe(201);
    expect(res.body.message).toMatchObject({ textedAt: null, noTextReason: expect.stringMatching(/^No text sent/) });
    expect(res.body.message.extraction.summary).toBe('Hang-up or empty message. Nothing to book.');
    expect(await outboxCount()).toBe(before);
  });

  it('[MC 4.7] texts a repeat caller only once per cooldown', async () => {
    const sample = simulatorScripts.find((s) => s.id === 'no-heat')!;
    const first = await ctx.call<{ message: Message }>('POST', '/api/calls', { from: sample.from, transcript: sample.transcript });
    const second = await ctx.call<{ message: Message }>('POST', '/api/calls', { from: sample.from, transcript: sample.transcript });
    expect(first.body.message.textedAt).not.toBeNull();
    expect(second.body.message).toMatchObject({ textedAt: null, noTextReason: expect.stringContaining('already texted') });
    const { messages } = (await ctx.call<{ messages: Message[] }>('GET', '/api/messages')).body;
    expect(messages.filter((m) => m.from === first.body.message.from)).toHaveLength(2);
  });

  it('[MC 7.5] turns off the simulator and reset outside demo mode', async () => {
    const live = await setup(false);
    const call = await live.call<{ error: string }>('POST', '/api/calls', { from: '614-555-0163', transcript: 'My furnace is out.' });
    expect(call).toMatchObject({ status: 404, body: { error: 'not-found' } });
    expect((await live.call('POST', '/api/demo/reset')).status).toBe(404);
    expect((await live.call<{ demo: boolean }>('GET', '/api/health')).body.demo).toBe(false);
  });
});

describe('phone webhook (real path entry point)', () => {
  const hook = { contactId: 'c-1', callerNumber: '+16145550150', recordingUri: 's3://bucket/recording.wav' };
  it('[MC 1.2] requires the shared secret', async () => {
    expect((await ctx.call('POST', '/api/hooks/connect-voicemail', hook)).status).toBe(401);
  });
  it('[MC 1.3] refuses every webhook call while no secret is configured', async () => {
    const store = new MemoryStore(await seedDb(NOW, () => 'x', BASE));
    const app = createApp({ store, adapters: localAdapters({ store, clock: () => NOW, newId: () => 'x', publicBaseUrl: BASE }), clock: () => NOW, newId: () => 'x', publicBaseUrl: BASE }, {});
    const res = await app.request('/api/hooks/connect-voicemail', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer anything' },
      body: JSON.stringify(hook),
    });
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: 'webhook-disabled' });
  });
  it('[MC 2.3] reports that the local transcriber cannot read audio', async () => {
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

  it('[VI 4.4, 4.6, 4.7, 4.8, 4.9, 5.1, 5.6] drafts, holds a bad price, and sends only the approved exact total', async () => {
    const job = await finishedJob();
    const speech = sampleInvoiceScripts.find((s) => s.id === 'slip')!.speech;
    const { body } = await ctx.call<Draft>('POST', '/api/invoices/draft', { speech, jobId: job.id });
    expect(body.customer?.name).toBe('Wendell Ashgrove');
    // The spoken invoice has no title, so the job's description is used.
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
    expect(sent.body.invoice.dueDate).toBe('2026-11-30');

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

  it('[VI 5.7] takes a demo payment on a local invoice and refuses it outside demo mode', async () => {
    async function sendOne(on: typeof ctx) {
      const speech = sampleInvoiceScripts.find((s) => s.id === 'clean')!.speech;
      const { body } = await on.call<Draft>('POST', '/api/invoices/draft', { speech });
      const customer = { name: 'Ada Pemberton', phone: '(614) 555-0177', email: null, address: null };
      const input = { jobId: null, title: 'Repair', customer, lines: body.draft.lines, approvedTotalCents: body.draft.totals.totalCents };
      return (await on.call<{ invoice: Invoice }>('POST', '/api/invoices/send', input)).body.invoice;
    }
    const sent = await sendOne(ctx);
    expect((await ctx.call<{ demoPay: boolean }>('GET', `/api/invoices/${sent.id}`)).body.demoPay).toBe(true);
    const paid = await ctx.call<{ invoice: Invoice }>('POST', `/api/invoices/${sent.id}/demo-pay`);
    expect(paid).toMatchObject({ status: 200, body: { invoice: { status: 'paid' } } });
    expect((await ctx.call<{ invoice: Invoice }>('GET', `/api/invoices/${sent.id}`)).body.invoice.status).toBe('paid');
    expect((await ctx.call('POST', '/api/invoices/nope/demo-pay')).status).toBe(404);

    const live = await setup(false);
    const liveSent = await sendOne(live);
    expect((await live.call<{ demoPay: boolean }>('GET', `/api/invoices/${liveSent.id}`)).body.demoPay).toBe(false);
    expect((await live.call('POST', `/api/invoices/${liveSent.id}/demo-pay`)).status).toBe(404);
    expect((await live.call<{ invoice: Invoice }>('GET', `/api/invoices/${liveSent.id}`)).body.invoice.status).toBe('sent');
  });

  it('[VI 5.7] never marks an invoice paid through a real payment provider', async () => {
    const store = ctx.store;
    const adapters = localAdapters({ store, clock: () => NOW, newId: () => 'x', publicBaseUrl: BASE });
    const stripeLike = { ...adapters, invoices: { ...adapters.invoices, name: 'stripe' } };
    expect(() => payDemoInvoice({ store, adapters: stripeLike, clock: () => NOW, newId: () => 'x', publicBaseUrl: BASE }, 'any')).toThrow(
      /payment provider/,
    );
  });

  it('[VI 1.7, 4.5] ignores totals the client tries to inject and recomputes from lines', async () => {
    const speech = sampleInvoiceScripts.find((s) => s.id === 'clean')!.speech;
    const { body } = await ctx.call<Draft>('POST', '/api/invoices/draft', { speech });
    const tampered = { lines: body.draft.lines, totals: { totalCents: 1 } };
    const quote = (await ctx.call<{ quote: { totals: { totalCents: number } } }>('POST', '/api/invoices/quote', tampered)).body.quote;
    expect(quote.totals.totalCents).toBe(56292);
  });

  it('[VI 3.8] grows the price book with every sent invoice', async () => {
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

  it('[VI 1.9, 3.10] holds the misheard "for forty" quantity case and sends the corrected invoice', async () => {
    const speech = 'water heater element ninety nine dollars and a thermostat for forty, one hour labor at eighty five';
    const { body } = await ctx.call<Draft>('POST', '/api/invoices/draft', { speech });
    expect(body.draft.lines.map((l) => l.quantity)).toEqual([1, 1, 1]);
    expect(body.draft.totals.totalCents).toBe(23199);

    const forced = body.draft.lines.map((l, i) => (i === 0 ? { ...l, quantity: 40 } : l));
    const send = (lines: InvoiceLine[], approvedTotalCents: number) =>
      ctx.call<{ error: string; invoice: Invoice }>('POST', '/api/invoices/send', {
        jobId: null,
        title: 'Water heater',
        customer: { name: 'Pat Doe', phone: '(614) 555-0110', email: null, address: null },
        lines,
        approvedTotalCents,
      });
    const quote = (await ctx.call<{ quote: { blocked: boolean; totals: { totalCents: number } } }>('POST', '/api/invoices/quote', { lines: forced })).body.quote;
    expect(quote.blocked).toBe(true);
    expect(await send(forced, quote.totals.totalCents)).toMatchObject({ status: 422, body: { error: 'needs-decision' } });
    expect((await send(body.draft.lines, 23199)).status).toBe(201);
  });

  it('[VI 4.2] recomputes totals when the owner edits or removes a line', async () => {
    const speech = sampleInvoiceScripts.find((s) => s.id === 'clean')!.speech;
    const { body } = await ctx.call<Draft>('POST', '/api/invoices/draft', { speech });
    const quote = async (lines: InvoiceLine[]) =>
      (await ctx.call<{ quote: { totals: { subtotalCents: number; totalCents: number } } }>('POST', '/api/invoices/quote', { lines })).body.quote.totals;
    const start = await quote(body.draft.lines);
    expect(start.totalCents).toBe(56292);

    const [first, ...rest] = body.draft.lines;
    const doubled = await quote([{ ...first!, quantity: first!.quantity * 2 }, ...rest]);
    expect(doubled.subtotalCents).toBe(start.subtotalCents + lineAmountCents(first!.quantity, first!.unitPriceCents!));

    const removed = await quote(rest);
    expect(removed.subtotalCents).toBe(start.subtotalCents - lineAmountCents(first!.quantity, first!.unitPriceCents!));
  });

  it('[VI 4.4] rejects malformed lines', async () => {
    const res = await ctx.call<{ error: string }>('POST', '/api/invoices/quote', { lines: [{ id: 'x', quantity: 1.234 }] });
    expect(res).toMatchObject({ status: 400, body: { error: 'invalid-request' } });
  });
});

describe('text-back failures', () => {
  it('[MC 4.8] files the message with a reason when the provider refuses the text, then retries it', async () => {
    let n = 0;
    const newId = () => `fx${String(++n).padStart(4, '0')}`;
    const clock = () => NOW;
    const store = new MemoryStore(await seedDb(NOW, newId, BASE));
    const adapters = localAdapters({ store, clock, newId, publicBaseUrl: BASE });
    const outbox = adapters.sms;
    let carrierDown = true;
    adapters.sms = {
      name: 'flaky',
      send: async (message) => {
        if (carrierDown) throw new Error('The carrier rejected the number');
        return outbox.send(message);
      },
    };
    const app = createApp({ store, adapters, clock, newId, publicBaseUrl: BASE }, { simulator: true });
    const post = async (path: string, body?: unknown) => {
      const res = await app.request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });
      return { status: res.status, body: (await res.json()) as { message: Message } };
    };

    const created = await post('/api/calls', { from: '+16145550101', transcript: 'This is Ivy Sloane, the heat went out at 12 Oak Street. Call 614-555-0101.' });
    expect(created.status).toBe(201);
    expect(created.body.message).toMatchObject({ textedAt: null, textFailed: true });
    expect(created.body.message.noTextReason).toBe('Text not sent: The carrier rejected the number. Call them back, or retry the text.');

    carrierDown = false;
    const retried = await post(`/api/messages/${created.body.message.id}/text`);
    expect(retried.status).toBe(200);
    expect(retried.body.message).toMatchObject({ textFailed: false, noTextReason: null });
    expect(retried.body.message.textedAt).not.toBeNull();
    expect(store.read().outbox.at(-1)?.body).toContain('Got your message about your heat.');

    expect((await post(`/api/messages/${created.body.message.id}/text`)).status).toBe(409);
  });
});
