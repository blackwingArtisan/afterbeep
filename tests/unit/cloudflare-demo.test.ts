import { describe, expect, it } from 'vitest';
import { handleDemoRequest, RESEED_AFTER_MS, ROW_ID, type D1Like, type D1Statement } from '../../infra/cloudflare/demo-api';

interface Row {
  json: string;
  version: number;
  seeded_at: string;
}

/** An in-memory stand-in for the three statements demo-api.ts sends to D1. */
class FakeD1 implements D1Like {
  rows = new Map<string, Row>();
  /** Runs once before the next save, to simulate another request saving first. */
  beforeSave: (() => void) | null = null;

  prepare(sql: string): D1Statement {
    let args: unknown[] = [];
    const statement: D1Statement = {
      bind: (...values) => {
        args = values;
        return statement;
      },
      first: async <T,>() => (this.rows.get(args[0] as string) ?? null) as T | null,
      run: async () => {
        const hook = this.beforeSave;
        this.beforeSave = null;
        hook?.();
        if (sql.startsWith('INSERT')) {
          const [id, json, seededAt] = args as [string, string, string];
          if (this.rows.has(id)) return { meta: { changes: 0 } };
          this.rows.set(id, { json, version: 1, seeded_at: seededAt });
          return { meta: { changes: 1 } };
        }
        const [json, version, seededAt, id, expected] = args as [string, number, string, string, number];
        const row = this.rows.get(id);
        if (!row || row.version !== expected) return { meta: { changes: 0 } };
        this.rows.set(id, { json, version, seeded_at: seededAt });
        return { meta: { changes: 1 } };
      },
    };
    return statement;
  }
}

const NOW = new Date('2026-11-17T15:00:00Z');
const ORIGIN = 'https://afterbeep.example.com';
const env = (db: FakeD1) => ({ DB: db, AFTERBEEP_PUBLIC_URL: ORIGIN });
const get = (path: string) => new Request(`${ORIGIN}${path}`);
const post = (path: string, body: unknown) =>
  new Request(`${ORIGIN}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

const call = { from: '+16145550109', transcript: 'Hi, this is Wendell at 12 Elm Street, my sink is leaking. Call me back.' };

describe('public demo API on Cloudflare (infra/cloudflare/demo-api.ts)', () => {
  it('seeds the demo on the first request and saves it once', async () => {
    const db = new FakeD1();
    const res = await handleDemoRequest(get('/api/messages'), env(db), () => NOW);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { messages: unknown[] };
    expect(body.messages.length).toBeGreaterThan(0);
    expect(db.rows.get(ROW_ID)?.version).toBe(1);

    await handleDemoRequest(get('/api/messages'), env(db), () => NOW);
    expect(db.rows.get(ROW_ID)?.version).toBe(1);
  });

  it('runs the demo in simulator mode with local adapters only', async () => {
    const res = await handleDemoRequest(get('/api/health'), env(new FakeD1()), () => NOW);
    expect(await res.json()).toMatchObject({ ok: true, demo: true, adapters: { sms: 'outbox', extractor: 'rules' } });
  });

  it('keeps a simulated call across requests', async () => {
    const db = new FakeD1();
    const before = (await (await handleDemoRequest(get('/api/messages'), env(db), () => NOW)).json()) as { messages: unknown[] };
    const res = await handleDemoRequest(post('/api/calls', call), env(db), () => NOW);
    expect(res.status).toBeLessThan(300);
    const after = (await (await handleDemoRequest(get('/api/messages'), env(db), () => NOW)).json()) as { messages: unknown[] };
    expect(after.messages.length).toBe(before.messages.length + 1);
  });

  it('runs a request again when another request saved first, so neither change is lost', async () => {
    const db = new FakeD1();
    await handleDemoRequest(get('/api/messages'), env(db), () => NOW);
    db.beforeSave = () => {
      const row = db.rows.get(ROW_ID)!;
      db.rows.set(ROW_ID, { ...row, version: row.version + 1 });
    };
    const res = await handleDemoRequest(post('/api/calls', call), env(db), () => NOW);
    expect(res.status).toBeLessThan(300);
    expect(db.rows.get(ROW_ID)?.version).toBe(3);
    const saved = JSON.parse(db.rows.get(ROW_ID)!.json) as { messages: Array<{ from: string }> };
    expect(saved.messages.filter((m) => m.from === call.from)).toHaveLength(1);
  });

  it('reseeds after a day so the demo always reads as today', async () => {
    const db = new FakeD1();
    await handleDemoRequest(post('/api/calls', call), env(db), () => NOW);
    const later = new Date(NOW.getTime() + RESEED_AFTER_MS + 60_000);
    await handleDemoRequest(get('/api/messages'), env(db), () => later);
    const row = db.rows.get(ROW_ID)!;
    expect(row.seeded_at).toBe(later.toISOString());
    const saved = JSON.parse(row.json) as { messages: Array<{ from: string }> };
    expect(saved.messages.some((m) => m.from === call.from)).toBe(false);
  });

  it('keeps the phone webhooks closed without a secret', async () => {
    const res = await handleDemoRequest(
      post('/api/hooks/connect-voicemail', { contactId: 'c-1', callerNumber: '+16145550109', recordingUri: 's3://b/k.wav' }),
      env(new FakeD1()),
      () => NOW,
    );
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});
