import { beforeEach, describe, expect, it } from 'vitest';
import { localAdapters } from '../../src/adapters';
import { MemoryStore } from '../../src/adapters/store/local';
import type { SmsSender } from '../../src/adapters/sms/types';
import { keptThisWeek } from '../../src/domain/kept';
import { remoteQueue, type RemoteMessage } from '../../src/domain/remote-retrieval';
import type { Invoice, Job, Message, OutboxItem } from '../../src/domain/types';
import { createApp } from '../../src/server/app';
import { sampleInvoiceScripts } from '../../src/server/seed';
import { seedDb } from '../../src/server/seed-db';

// Monday 2026-11-16 at 14:30 in Columbus.
const NOW = new Date('2026-11-16T19:30:00Z');
const BASE = 'https://afterbeep.example.com';
const SECRET = 'test-secret';

async function setup(opts: { simulator?: boolean; sms?: (fallback: SmsSender) => SmsSender } = {}) {
  let n = 0;
  const newId = () => `rm${String(++n).padStart(4, '0')}`;
  let now = NOW;
  const clock = () => now;
  const store = new MemoryStore(await seedDb(NOW, newId, BASE));
  const adapters = localAdapters({ store, clock, newId, publicBaseUrl: BASE });
  if (opts.sms) adapters.sms = opts.sms(adapters.sms);
  const app = createApp({ store, adapters, clock, newId, publicBaseUrl: BASE }, { webhookSecret: SECRET, simulator: opts.simulator ?? true });
  const call = async <T = unknown>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const res = await app.request(path, {
      method,
      headers: { 'content-type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, text: await res.clone().text(), body: (await res.json()) as T };
  };
  return { store, call, later: (ms: number) => (now = new Date(now.getTime() + ms)) };
}

type CodeBody = { result: 'ok'; messages: RemoteMessage[] } | { result: 'wrong' } | { result: 'locked' };
let ctx: Awaited<ReturnType<typeof setup>>;
beforeEach(async () => {
  ctx = await setup();
});

const byName = (messages: Message[], name: string) => messages.find((m) => m.extraction.callerName === name)!;
const allMessages = () => ctx.store.read().messages;

describe('remote code route', () => {
  it('[RR 2.1, 11.1] answers ok with the queue, emergency first', async () => {
    const { status, body } = await ctx.call<CodeBody>('POST', '/api/remote/code', { code: '427' });
    expect(status).toBe(200);
    expect(body.result).toBe('ok');
    if (body.result !== 'ok') return;
    expect(body.messages.map((m) => m.callerName)).toEqual(['Priya Natarajan', 'Edith Marsh', 'Gus Lindqvist']);
    expect(body.messages.map((m) => m.urgency)).toEqual(['emergency', 'soon', 'routine']);
  });

  it('[RR 1.8, 11.1] a wrong code answers wrong and reveals no message', async () => {
    const { status, body, text } = await ctx.call<CodeBody>('POST', '/api/remote/code', { code: '000' });
    expect(status).toBe(200);
    expect(body).toEqual({ result: 'wrong' });
    expect(text).not.toContain('Priya');
  });

  it('[RR 2.4, 2.5, 11.1] five wrong codes lock the machine, and a right code is refused', async () => {
    for (let i = 0; i < 5; i++) await ctx.call('POST', '/api/remote/code', { code: '111' });
    const locked = await ctx.call<CodeBody>('POST', '/api/remote/code', { code: '427' });
    expect(locked.body).toEqual({ result: 'locked' });
    ctx.later(14 * 60_000);
    expect((await ctx.call<CodeBody>('POST', '/api/remote/code', { code: '427' })).body).toEqual({ result: 'locked' });
    ctx.later(61_000);
    expect((await ctx.call<CodeBody>('POST', '/api/remote/code', { code: '427' })).body.result).toBe('ok');
  });

  it('[RR 2.6] a right code clears the wrong-code count', async () => {
    for (let i = 0; i < 4; i++) await ctx.call('POST', '/api/remote/code', { code: '111' });
    await ctx.call('POST', '/api/remote/code', { code: '427' });
    for (let i = 0; i < 4; i++) await ctx.call('POST', '/api/remote/code', { code: '111' });
    expect((await ctx.call<CodeBody>('POST', '/api/remote/code', { code: '427' })).body.result).toBe('ok');
  });

  it.each([{}, { code: '42' }, { code: '4271' }, { code: 427 }, { code: 'abc' }])('[RR 11.5, 11.6] refuses the body %j', async (body) => {
    const res = await ctx.call<{ error: string }>('POST', '/api/remote/code', body);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid-request');
    expect(ctx.store.read().remoteFailures ?? []).toEqual([]);
  });

  it('[RR 2.7] is closed with the simulator off and no secret', async () => {
    const closed = await setup({ simulator: false });
    const res = await closed.call<{ error: string }>('POST', '/api/remote/code', { code: '427' });
    expect(res.status).toBe(401);
    expect(res.text).not.toContain('Priya');
    const wrong = await closed.call('POST', '/api/remote/code', { code: '427' }, { authorization: 'Bearer nope' });
    expect(wrong.status).toBe(401);
    expect((await closed.call('POST', '/api/remote/messages/x/erase')).status).toBe(401);
    expect((await closed.call('POST', '/api/remote/messages/x/text')).status).toBe(401);
  });

  it('[RR 2.7] is open with the simulator off when the request carries the phone secret', async () => {
    const closed = await setup({ simulator: false });
    const res = await closed.call<CodeBody>('POST', '/api/remote/code', { code: '427' }, { authorization: `Bearer ${SECRET}` });
    expect(res.status).toBe(200);
    expect(res.body.result).toBe('ok');
  });

  it('[RR 2.3] the remote code is in no API response', async () => {
    const [business, health, messages, jobs, outbox, kept, graveyard, prices, samples] = await Promise.all(
      ['/api/business', '/api/health', '/api/messages', '/api/jobs', '/api/outbox', '/api/kept', '/api/graveyard', '/api/price-book', '/api/samples'].map((p) =>
        ctx.call('GET', p),
      ),
    );
    const greeting = await ctx.call('PUT', '/api/business/greeting', {
      greeting: "You've reached Hollow Creek's answering machine. Leave your name, address and the problem, and you'll get a text with times.",
    });
    const responses = [
      business, health, messages, jobs, outbox, kept, graveyard, prices, samples, greeting,
      await ctx.call('POST', '/api/remote/code', { code: '427' }),
      await ctx.call('POST', '/api/remote/code', { code: '000' }),
    ];
    expect((business!.body as { business: object }).business).not.toHaveProperty('remoteCode');
    for (const r of responses) expect(r?.text).not.toMatch(/427|remoteCode/);
  });
});

describe('remote text back', () => {
  it('[RR 5.1, 5.2, 5.7, 11.2] texts the booking link to the message\'s own number and records the time', async () => {
    const edith = byName(allMessages(), 'Edith Marsh');
    const before = ctx.store.read().outbox.length;
    ctx.later(60 * 60_000);
    const res = await ctx.call<{ outcome: string }>('POST', `/api/remote/messages/${edith.id}/text`);
    expect(res).toMatchObject({ status: 200, body: { outcome: 'sent' } });
    const outbox = (await ctx.call<{ outbox: OutboxItem[] }>('GET', '/api/outbox')).body.outbox;
    expect(outbox).toHaveLength(before + 1);
    expect(outbox[0]).toMatchObject({ kind: 'sms', to: '+16145550121', linkPath: `/book/${edith.bookingToken}` });
    expect(outbox[0]!.body).toContain('Reply STOP to opt out.');
    expect(byName(allMessages(), 'Edith Marsh').textedAt).toBe(new Date(NOW.getTime() + 60 * 60_000).toISOString());
  });

  it('[RR 5.4, 11.2] a number texted in the last 10 minutes is not texted again', async () => {
    const edith = byName(allMessages(), 'Edith Marsh');
    ctx.later(60 * 60_000);
    await ctx.call('POST', `/api/remote/messages/${edith.id}/text`);
    const sent = ctx.store.read().outbox.length;
    ctx.later(5 * 60_000);
    const again = await ctx.call<{ outcome: string }>('POST', `/api/remote/messages/${edith.id}/text`);
    expect(again.body.outcome).toBe('texted-recently');
    expect(ctx.store.read().outbox).toHaveLength(sent);
    ctx.later(6 * 60_000);
    expect((await ctx.call<{ outcome: string }>('POST', `/api/remote/messages/${edith.id}/text`)).body.outcome).toBe('sent');
  });

  it('[RR 5.3, 11.2] a caller who replied STOP is not texted', async () => {
    const edith = byName(allMessages(), 'Edith Marsh');
    await ctx.call('POST', '/api/hooks/inbound-text', { from: '+16145550121', body: 'STOP' }, { authorization: `Bearer ${SECRET}` });
    const sent = ctx.store.read().outbox.length;
    const res = await ctx.call<{ outcome: string }>('POST', `/api/remote/messages/${edith.id}/text`);
    expect(res.body.outcome).toBe('opted-out');
    expect(ctx.store.read().outbox).toHaveLength(sent);
  });

  it('[RR 5.5, 11.2] a message with no number to text sends nothing', async () => {
    const edith = byName(allMessages(), 'Edith Marsh');
    ctx.store.update((db) => {
      db.messages.find((m) => m.id === edith.id)!.from = '';
      db.messages.find((m) => m.id === edith.id)!.extraction.callbackNumber = null;
    });
    const sent = ctx.store.read().outbox.length;
    const res = await ctx.call<{ outcome: string }>('POST', `/api/remote/messages/${edith.id}/text`);
    expect(res.body.outcome).toBe('no-number');
    expect(ctx.store.read().outbox).toHaveLength(sent);
  });

  it('[RR 5.6, 11.2] a refused text keeps the message and files the reason', async () => {
    const refusing = await setup({
      sms: () => ({
        name: 'flaky',
        send: async () => {
          throw new Error('carrier said no');
        },
      }),
    });
    const edith = byName(refusing.store.read().messages, 'Edith Marsh');
    refusing.later(60 * 60_000);
    const res = await refusing.call<{ outcome: string }>('POST', `/api/remote/messages/${edith.id}/text`);
    expect(res.body.outcome).toBe('refused');
    const stored = byName(refusing.store.read().messages, 'Edith Marsh');
    expect(stored).toMatchObject({ textFailed: true });
    expect(stored.noTextReason).toContain('carrier said no');
    expect(refusing.store.read().messages.some((m) => m.id === edith.id)).toBe(true);
  });

  it('[RR 11.7] an unknown or erased message is a 404', async () => {
    expect((await ctx.call('POST', '/api/remote/messages/nope/text')).status).toBe(404);
    const edith = byName(allMessages(), 'Edith Marsh');
    await ctx.call('POST', `/api/remote/messages/${edith.id}/erase`);
    expect((await ctx.call('POST', `/api/remote/messages/${edith.id}/text`)).status).toBe(404);
  });
});

describe('erase', () => {
  it('[RR 6.4, 11.3] erase hides the message from the inbox, the count and later remote calls', async () => {
    const edith = byName(allMessages(), 'Edith Marsh');
    const res = await ctx.call<{ erased: boolean }>('POST', `/api/remote/messages/${edith.id}/erase`);
    expect(res).toMatchObject({ status: 200, body: { erased: true } });
    const list = (await ctx.call<{ messages: Message[]; newCount: number }>('GET', '/api/messages')).body;
    expect(list.messages.some((m) => m.id === edith.id)).toBe(false);
    expect(list.newCount).toBe(2);
    expect(byName(allMessages(), 'Edith Marsh').erasedAt).toBe(NOW.toISOString());
    const code = (await ctx.call<CodeBody>('POST', '/api/remote/code', { code: '427' })).body;
    expect(code.result === 'ok' && code.messages.map((m) => m.callerName)).toEqual(['Priya Natarajan', 'Gus Lindqvist']);
  });

  it('[RR 6.6, 11.7] a second erase and an unknown id give 404 and change nothing', async () => {
    const edith = byName(allMessages(), 'Edith Marsh');
    await ctx.call('POST', `/api/remote/messages/${edith.id}/erase`);
    const snapshot = JSON.stringify(ctx.store.read());
    const again = await ctx.call<{ error: string }>('POST', `/api/remote/messages/${edith.id}/erase`);
    expect(again).toMatchObject({ status: 404, body: { error: 'not-found' } });
    expect((await ctx.call('POST', '/api/remote/messages/nope/erase')).status).toBe(404);
    expect(JSON.stringify(ctx.store.read())).toBe(snapshot);
  });

  it('[RR 6.4] an erased message leaves the new-message count and the remote queue', () => {
    const messages = allMessages();
    const edith = byName(messages, 'Edith Marsh');
    const erased = messages.map((m) => (m.id === edith.id ? { ...m, erasedAt: NOW.toISOString() } : m));
    expect(remoteQueue(messages)).toHaveLength(3);
    expect(remoteQueue(erased).map((m) => m.id)).not.toContain(edith.id);
    expect(remoteQueue(erased)).toHaveLength(2);
  });

  it('[RR 6.5] erasing a booked message keeps its job and the Kept this week figures', async () => {
    const priya = byName(allMessages(), 'Priya Natarajan');
    const before = keptThisWeek(ctx.store.read(), NOW);
    const jobsBefore = (await ctx.call<{ jobs: Job[] }>('GET', '/api/jobs')).body.jobs;
    await ctx.call('POST', `/api/remote/messages/${priya.id}/erase`);
    expect(keptThisWeek(ctx.store.read(), NOW)).toEqual(before);
    expect(before).toMatchObject({ booked: 1, bookedValueCents: 37_700 });
    const jobsAfter = (await ctx.call<{ jobs: Job[] }>('GET', '/api/jobs')).body.jobs;
    expect(jobsAfter).toEqual(jobsBefore);
    expect(jobsAfter.find((j) => j.id === priya.jobId)).toBeTruthy();
  });
});

describe('the rest of a remote call uses existing routes', () => {
  it('[RR 4.1, 4.3, 11.4] marks heard through the status route, and a called-back message is never queued to be demoted', async () => {
    const edith = byName(allMessages(), 'Edith Marsh');
    const gus = byName(allMessages(), 'Gus Lindqvist');
    await ctx.call('POST', `/api/messages/${gus.id}/status`, { status: 'called-back' });
    const code = (await ctx.call<CodeBody>('POST', '/api/remote/code', { code: '427' })).body;
    const ids = code.result === 'ok' ? code.messages.map((m) => m.id) : [];
    // The queue holds only new messages, so the script never emits mark-heard for a called-back one.
    expect(ids).toContain(edith.id);
    expect(ids).not.toContain(gus.id);
    const heard = await ctx.call<{ message: Message }>('POST', `/api/messages/${edith.id}/status`, { status: 'heard' });
    expect(heard.body.message.status).toBe('heard');
    expect(byName(allMessages(), 'Gus Lindqvist').status).toBe('called-back');
  });

  it('[RR 8.2, 8.3, 11.4] drafts the spoken invoice through the existing draft route and sends nothing', async () => {
    const slip = sampleInvoiceScripts.find((s) => s.id === 'slip')!;
    const outboxBefore = ctx.store.read().outbox.length;
    const res = await ctx.call<{ lines: unknown[] }>('POST', '/api/invoices/draft', { speech: slip.speech });
    expect(res.status).toBe(200);
    expect(res.text).toContain('Dryer belt');
    expect(ctx.store.read().invoices).toEqual([] as Invoice[]);
    expect(ctx.store.read().outbox).toHaveLength(outboxBefore);
    // No remote route exists for either step.
    expect((await ctx.call('POST', '/api/remote/invoices/draft', { speech: slip.speech })).status).toBe(404);
    expect((await ctx.call('POST', '/api/remote/messages/x/status', { status: 'heard' })).status).toBe(404);
  });
});
