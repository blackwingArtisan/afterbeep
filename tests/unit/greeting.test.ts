import { beforeEach, describe, expect, it } from 'vitest';
import { localAdapters } from '../../src/adapters';
import { MemoryStore } from '../../src/adapters/store/local';
import { greetingChecks, greetingProblem, spokenSeconds } from '../../src/domain/greeting';
import type { Business } from '../../src/domain/types';
import { createApp } from '../../src/server/app';
import { demoBusiness } from '../../src/server/seed';
import { seedDb } from '../../src/server/seed-db';

const passed = (greeting: string) => Object.fromEntries(greetingChecks(greeting).map((c) => [c.id, c.pass]));

describe('greeting checks', () => {
  it('[MC 10.3] passes the demo greeting on every check', () => {
    expect(passed(demoBusiness.greeting)).toEqual({ machine: true, text: true, details: true, short: true });
  });

  it('[MC 10.3] flags a plain voicemail greeting', () => {
    expect(passed("Hi, you've reached Morgan. Leave a message.")).toEqual({ machine: false, text: false, details: false, short: true });
  });

  it('[MC 10.3] estimates spoken length and flags a greeting over 25 seconds', () => {
    const long = Array.from({ length: 70 }, () => 'word').join(' ');
    expect(spokenSeconds(long)).toBe(28);
    expect(passed(long).short).toBe(false);
    expect(spokenSeconds('')).toBe(0);
  });

  it('[MC 10.4] refuses a greeting that claims a person is on the line', () => {
    for (const g of [
      "Hi, this is the receptionist at Hollow Creek. Leave a message.",
      "I'm your assistant for Hollow Creek. Leave your name after the beep.",
      "You're speaking to a real person, leave a message please.",
      'This is not a recording. Leave your name and number.',
    ]) {
      expect(greetingProblem(g), g).toMatch(/honest machine/);
    }
    expect(greetingProblem(demoBusiness.greeting)).toBeNull();
  });

  it('[MC 10.5] refuses a greeting that is too short or too long', () => {
    expect(greetingProblem('Hi.')).toMatch(/too short/);
    expect(greetingProblem('a'.repeat(401))).toMatch(/under 400 characters/);
  });
});

describe('saving the greeting', () => {
  let call: <T = unknown>(method: string, path: string, body?: unknown) => Promise<{ status: number; body: T }>;
  let store: MemoryStore;
  const BASE = 'https://afterbeep.example.com';
  const now = new Date('2026-11-17T15:00:00Z');

  beforeEach(async () => {
    let n = 0;
    const newId = () => `id${String(++n).padStart(4, '0')}`;
    const clock = () => now;
    store = new MemoryStore(await seedDb(now, newId, BASE));
    const app = createApp({ store, adapters: localAdapters({ store, clock, newId, publicBaseUrl: BASE }), clock, newId, publicBaseUrl: BASE }, { simulator: true });
    call = async (method, path, body) => {
      const res = await app.request(path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: res.status, body: (await res.json()) as never };
    };
  });

  it('[MC 10.1, 10.2] saves the greeting, tidied, and the business returns it to the next call', async () => {
    const greeting = "  You've reached Hollow Creek's answering machine.\n Leave your name, address and what's going on, and you'll get a text.  ";
    const res = await call<{ business: Business }>('PUT', '/api/business/greeting', { greeting });
    expect(res.status).toBe(200);
    expect(res.body.business.greeting).toBe("You've reached Hollow Creek's answering machine. Leave your name, address and what's going on, and you'll get a text.");
    const read = await call<{ business: Business }>('GET', '/api/business');
    expect(read.body.business.greeting).toBe(res.body.business.greeting);
  });

  it('[MC 10.4, 10.5] refuses a dishonest or empty greeting and keeps the old one', async () => {
    const before = store.read().business.greeting;
    const fake = await call<{ error: string; message: string }>('PUT', '/api/business/greeting', { greeting: 'Hi, this is the receptionist. Leave a message.' });
    expect(fake).toMatchObject({ status: 422, body: { error: 'bad-greeting' } });
    expect(fake.body.message).toMatch(/honest machine/);
    expect((await call('PUT', '/api/business/greeting', { greeting: '' })).status).toBe(422);
    expect((await call('PUT', '/api/business/greeting', {})).status).toBe(400);
    expect(store.read().business.greeting).toBe(before);
  });
});
