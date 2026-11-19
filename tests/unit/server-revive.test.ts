import { describe, expect, it } from 'vitest';
import { localAdapters } from '../../src/adapters';
import { MemoryStore } from '../../src/adapters/store/local';
import type { SmsSender } from '../../src/adapters/sms/types';
import { keptThisWeek } from '../../src/domain/kept';
import type { Message } from '../../src/domain/types';
import { createApp } from '../../src/server/app';
import { seedDb } from '../../src/server/seed-db';
import { graveyard, type GraveyardView, type RaiseResult } from '../../src/domain/graveyard';

// Monday 2026-11-16 at 14:30 in Columbus.
const NOW = new Date('2026-11-16T19:30:00Z');
const BASE = 'https://afterbeep.example.com';
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

async function setup(sms?: (fallback: SmsSender) => SmsSender) {
  let n = 0;
  const newId = () => `rv${String(++n).padStart(4, '0')}`;
  let now = NOW;
  const clock = () => now;
  const store = new MemoryStore(await seedDb(NOW, newId, BASE));
  const adapters = localAdapters({ store, clock, newId, publicBaseUrl: BASE });
  if (sms) adapters.sms = sms(adapters.sms);
  const app = createApp({ store, adapters, clock, newId, publicBaseUrl: BASE }, { simulator: true });
  const call = async <T,>(method: string, path: string, body?: unknown) => {
    const res = await app.request(path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: (await res.json()) as T };
  };
  return { store, call, later: (ms: number) => (now = new Date(now.getTime() + ms)) };
}

function hangUp(id: string, from: string, receivedAt: string, extra: Partial<Message> = {}): Message {
  return {
    id, from, receivedAt, durationSec: 4, transcript: 'Hello?', status: 'heard', bookingToken: `t-${id}`, textedAt: null, jobId: null, hangUp: true,
    noTextReason: 'No text sent: the message had no name, address or job in it.',
    extraction: { callerName: null, callbackNumber: null, address: null, job: 'General repair', jobCategory: 'general', urgency: 'routine', summary: 'Hang-up', source: 'rules' },
    ...extra,
  };
}

describe('the graveyard', () => {
  it('[MC 8.1] keeps unreturned hang-ups between a day and 30 days old, one per number', () => {
    const messages: Message[] = [
      hangUp('fresh', '+16145550001', daysAgo(0.5)),
      hangUp('dead', '+16145550002', daysAgo(3)),
      hangUp('dead-again', '+16145550002', daysAgo(2)),
      hangUp('too-old', '+16145550003', daysAgo(31)),
      hangUp('called-back', '+16145550004', daysAgo(4), { status: 'called-back' }),
      hangUp('raised', '+16145550005', daysAgo(5), { raisedAt: daysAgo(1) }),
      hangUp('reached-later', '+16145550006', daysAgo(6)),
      { ...hangUp('voicemail', '+16145550006', daysAgo(1)), hangUp: false, textedAt: daysAgo(1) },
      { ...hangUp('real-message', '+16145550007', daysAgo(6)), hangUp: false },
    ];
    expect(graveyard({ messages }, NOW).map((g) => g.id)).toEqual(['dead-again']);
  });

  it('[MC 8.5] shows the seeded hang-ups and what they might win back at the typical job', async () => {
    const { call } = await setup();
    const { graveyard: view } = (await call<{ graveyard: GraveyardView }>('GET', '/api/graveyard')).body;
    expect(view.ghosts).toHaveLength(5);
    expect(view.ghosts.map((g) => g.from)).toContain('+16145550146');
    expect(view.raised).toEqual([]);
    expect(view.mightWinBackCents).toBe(view.typicalJobCents * 5);
    expect(view.typicalJobCents).toBeGreaterThan(0);
  });

  it('[MC 8.2, 8.3] texts each ghost one booking link on the owner\'s press, and never twice', async () => {
    const { call, store } = await setup();
    const before = store.read().outbox.length;
    expect(store.read().messages.filter((m) => m.raisedAt)).toHaveLength(0);

    const first = (await call<RaiseResult>('POST', '/api/graveyard/raise')).body;
    expect(first.raised).toBe(5);
    expect(first.failed).toEqual([]);
    expect(first.graveyard.ghosts).toEqual([]);
    expect(first.graveyard.raised).toHaveLength(5);
    const texts = store.read().outbox.slice(before);
    expect(texts).toHaveLength(5);
    const toGhost = texts.find((t) => t.to === '+16145550146')!;
    expect(toGhost.body).toMatch(/^Hi, it's Morgan at Hollow Creek Plumbing & Appliance\. Sorry I missed your call on \w+day\. /);
    expect(toGhost.linkPath).toMatch(/^\/book\//);

    const second = (await call<RaiseResult>('POST', '/api/graveyard/raise')).body;
    expect(second.raised).toBe(0);
    expect(store.read().outbox.length).toBe(before + 5);
  });

  it('[MC 8.4] leaves a ghost in the graveyard with the reason when its text is refused', async () => {
    const { call, store } = await setup((outbox) => ({
      name: 'flaky',
      send: async (m) => {
        if (m.to === '+16145550127') throw new Error('The carrier rejected the number');
        return outbox.send(m);
      },
    }));
    const result = (await call<RaiseResult>('POST', '/api/graveyard/raise')).body;
    expect(result.raised).toBe(4);
    expect(result.failed).toEqual([
      expect.objectContaining({ from: '+16145550127', reason: 'Text not sent: The carrier rejected the number. Call them back, or retry the text.' }),
    ]);
    expect(result.graveyard.ghosts.map((g) => g.from)).toEqual(['+16145550127']);
    expect(store.read().messages.find((m) => m.from === '+16145550127')!.raisedAt).toBeFalsy();
  });

  it('[MC 8.6] counts a raised caller who books in "Kept this week"', async () => {
    const { call, store, later } = await setup();
    const before = keptThisWeek(store.read(), NOW);
    await call('POST', '/api/graveyard/raise');
    const ghost = store.read().messages.find((m) => m.from === '+16145550146')!;
    later(60_000);
    const view = (await call<{ slots: Array<{ start: string; end: string }> }>('GET', `/api/book/${ghost.bookingToken}`)).body;
    const booked = await call('POST', `/api/book/${ghost.bookingToken}`, { ...view.slots[0], address: '14 Gravel Pit Road' });
    expect(booked.status).toBe(201);
    const after = keptThisWeek(store.read(), new Date(NOW.getTime() + 60_000));
    expect(after.booked).toBe(before.booked + 1);
    expect(after.calls).toBe(before.calls);
  });
});
