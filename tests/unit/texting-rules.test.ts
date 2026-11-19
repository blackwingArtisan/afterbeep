import { beforeEach, describe, expect, it } from 'vitest';
import { localAdapters } from '../../src/adapters';
import { MemoryStore } from '../../src/adapters/store/local';
import { graveyard } from '../../src/domain/graveyard';
import { isOptedOut, textKeyword } from '../../src/domain/texting';
import type { Message, OutboxItem } from '../../src/domain/types';
import { createApp } from '../../src/server/app';
import { GRAVEYARD_SEED, seedDb } from '../../src/server/seed-db';

const BASE = 'https://afterbeep.example.com';
const SECRET = 'test-secret';
const NOW = new Date('2026-11-17T15:00:00Z');
const CALLER = '+16145550177';

describe('reply keywords', () => {
  it('[MC 9.2, 9.4, 9.5] reads a keyword only when it is the whole reply', () => {
    for (const stop of ['STOP', 'stop', ' Stop. ', 'UNSUBSCRIBE', 'cancel', 'Quit!', 'opt-out', 'parar']) expect(textKeyword(stop), stop).toBe('stop');
    for (const help of ['HELP', 'help?', 'Info', 'ayuda']) expect(textKeyword(help), help).toBe('help');
    for (const start of ['START', 'unstop']) expect(textKeyword(start), start).toBe('start');
  });

  it('[MC 9.6] treats an ordinary reply as no keyword', () => {
    for (const reply of ["please don't stop by before 5", 'Thanks!', 'yes', 'Can you come at 3? Stop at the side door', '']) {
      expect(textKeyword(reply), reply).toBeNull();
    }
  });

  it('[MC 9.3] matches an opted-out number in any format', () => {
    expect(isOptedOut({ optOuts: ['+16145550134'] }, '(614) 555-0134')).toBe(true);
    expect(isOptedOut({ optOuts: ['+16145550134'] }, '+16145550135')).toBe(false);
    expect(isOptedOut({}, '+16145550134')).toBe(false);
  });
});

describe('texting rules over the API', () => {
  let store: MemoryStore;
  let call: <T = unknown>(method: string, path: string, body?: unknown, auth?: string | null) => Promise<{ status: number; body: T }>;

  beforeEach(async () => {
    let n = 0;
    const newId = () => `id${String(++n).padStart(4, '0')}`;
    const clock = () => NOW;
    store = new MemoryStore(await seedDb(NOW, newId, BASE));
    const adapters = localAdapters({ store, clock, newId, publicBaseUrl: BASE });
    const app = createApp({ store, adapters, clock, newId, publicBaseUrl: BASE }, { webhookSecret: SECRET, simulator: true });
    call = async (method, path, body, auth = `Bearer ${SECRET}`) => {
      const headers: Record<string, string> = { 'content-type': 'application/json' };
      if (auth) headers.authorization = auth;
      const res = await app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: res.status, body: (await res.json()) as never };
    };
  });

  const outboxTo = (to: string) => store.read().outbox.filter((o: OutboxItem) => o.to === to);
  const reply = (from: string, body: string, auth?: string | null) => call<{ keyword: string | null; replied: boolean }>('POST', '/api/hooks/inbound-text', { from, body }, auth);

  it('[MC 9.1] ends the text-back with how to opt out', async () => {
    await call('POST', '/api/calls', { from: CALLER, transcript: 'Hi, this is Ada Finch at 9 Elm Street. My kitchen faucet drips. No rush.' });
    const [text] = outboxTo(CALLER);
    expect(text!.body).toMatch(/Reply STOP to opt out\.$/);
  });

  it('[MC 9.1] ends the raise text with how to opt out', async () => {
    await call('POST', '/api/graveyard/raise');
    const ghost = GRAVEYARD_SEED[0].from;
    expect(outboxTo(ghost).at(-1)!.body).toMatch(/Reply STOP to opt out\.$/);
  });

  it('[MC 9.2, 9.3] opts a caller out with one confirmation, then texts them nothing', async () => {
    const res = await reply('(614) 555-0177', 'STOP');
    expect(res).toMatchObject({ status: 200, body: { keyword: 'stop', replied: true } });
    expect(store.read().optOuts).toEqual([CALLER]);
    const confirmations = outboxTo(CALLER);
    expect(confirmations).toHaveLength(1);
    expect(confirmations[0]!.body).toBe("Hollow Creek Plumbing & Appliance: you're opted out and won't get more texts from us. Reply START to opt back in.");

    const { body } = await call<{ message: Message }>('POST', '/api/calls', { from: CALLER, transcript: 'Hi, this is Ada Finch at 9 Elm Street. My kitchen faucet drips. No rush.' });
    expect(body.message.textedAt).toBeNull();
    expect(body.message.noTextReason).toBe('Not texted: this number replied STOP. Call them back instead.');
    expect(body.message.textFailed).toBe(false);
    expect(outboxTo(CALLER)).toHaveLength(1);
    expect((await call('POST', `/api/messages/${body.message.id}/text`)).status).toBe(409);

    // The caller can still book on the page; the page confirms it and no text goes out.
    const view = await call<{ slots: Array<{ start: string; end: string }> }>('GET', `/api/book/${body.message.bookingToken}`);
    expect((await call('POST', `/api/book/${body.message.bookingToken}`, view.body.slots[0])).status).toBe(201);
    expect(outboxTo(CALLER)).toHaveLength(1);
  });

  it('[MC 9.3] leaves an opted-out number out of the graveyard and the raise', async () => {
    const ghost = GRAVEYARD_SEED[0].from;
    expect(graveyard(store.read(), NOW).map((g) => g.from)).toContain(ghost);
    await reply(ghost, 'stop');
    expect(graveyard(store.read(), NOW).map((g) => g.from)).not.toContain(ghost);
    const raised = await call<{ raised: number }>('POST', '/api/graveyard/raise');
    expect(raised.body.raised).toBe(GRAVEYARD_SEED.length - 1);
    expect(outboxTo(ghost).map((o) => o.body)).toEqual([expect.stringContaining("you're opted out")]);
  });

  it('[MC 9.4] answers HELP with the business name, phone and how to opt out', async () => {
    const res = await reply(CALLER, 'help');
    expect(res.body).toEqual({ keyword: 'help', replied: true });
    expect(outboxTo(CALLER)[0]!.body).toBe('Hollow Creek Plumbing & Appliance: texts about your service call. Call (614) 555-0142 for help. Reply STOP to opt out.');
    expect(store.read().optOuts).toEqual([]);
  });

  it('[MC 9.5] opts a caller back in on START', async () => {
    await reply(CALLER, 'STOP');
    await reply(CALLER, 'Start');
    expect(store.read().optOuts).toEqual([]);
    expect(outboxTo(CALLER).at(-1)!.body).toBe("Hollow Creek Plumbing & Appliance: you're opted back in. Reply STOP to opt out.");
    const { body } = await call<{ message: Message }>('POST', '/api/calls', { from: CALLER, transcript: 'Hi, this is Ada Finch at 9 Elm Street. My kitchen faucet drips. No rush.' });
    expect(body.message.textedAt).not.toBeNull();
  });

  it('[MC 9.6] sends nothing back for an ordinary reply', async () => {
    const res = await reply(CALLER, "Thanks, please don't stop by before 5");
    expect(res.body).toEqual({ keyword: null, replied: false });
    expect(outboxTo(CALLER)).toHaveLength(0);
    expect(store.read().optOuts).toEqual([]);
  });

  it('[MC 9.7] refuses a reply without the shared secret', async () => {
    expect((await reply(CALLER, 'STOP', null)).status).toBe(401);
    expect((await reply(CALLER, 'STOP', `Bearer ${SECRET}x`)).status).toBe(401);
    expect(store.read().optOuts).toEqual([]);
    expect(outboxTo(CALLER)).toHaveLength(0);
  });
});
