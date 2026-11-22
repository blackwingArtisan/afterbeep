/**
 * The public demo's API on Cloudflare Pages Functions. The same Hono app as the Node server runs
 * here with the local adapters (rules extractor, outbox texts, local invoices), so the live demo
 * sends no real texts and calls no paid service.
 *
 * State is one JSON document in a D1 row. Each request loads it into a MemoryStore, runs the app,
 * and saves the document back only if it changed, guarded by a version number. If another request
 * saved first, the request runs again on the newer state, so two visitors never overwrite each other.
 * The demo reseeds itself once a day, so "Morgan's Tuesday" always reads as today.
 */
import { localAdapters } from '../../src/adapters';
import { MemoryStore } from '../../src/adapters/store/local';
import type { Db } from '../../src/adapters/store/types';
import { createApp } from '../../src/server/app';
import { seedDb } from '../../src/server/seed-db';

/** The slice of the D1 binding this module uses, so it can be faked in tests. */
export interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  first<T>(): Promise<T | null>;
  run(): Promise<{ meta: { changes: number } }>;
}
export interface D1Like {
  prepare(sql: string): D1Statement;
}

export interface DemoEnv {
  DB: D1Like;
  /** Origin used in texted links, e.g. https://afterbeep.pages.dev. Defaults to the request origin. */
  AFTERBEEP_PUBLIC_URL?: string;
  /** Shared secret for the phone webhooks. Unset keeps them closed. */
  AFTERBEEP_WEBHOOK_SECRET?: string;
}

interface StateRow {
  json: string;
  version: number;
  seeded_at: string;
}

export const ROW_ID = 'demo';
export const RESEED_AFTER_MS = 24 * 60 * 60 * 1000;
const MAX_ATTEMPTS = 4;

export function newId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(9));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function handleDemoRequest(request: Request, env: DemoEnv, clock: () => Date = () => new Date()): Promise<Response> {
  const publicBaseUrl = (env.AFTERBEEP_PUBLIC_URL || new URL(request.url).origin).replace(/\/$/, '');

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const row = await env.DB.prepare('SELECT json, version, seeded_at FROM state WHERE id = ?').bind(ROW_ID).first<StateRow>();
    const stale = !row || clock().getTime() - Date.parse(row.seeded_at) > RESEED_AFTER_MS;

    let db: Db;
    let seededAt: string;
    if (stale) {
      db = await seedDb(clock(), newId, publicBaseUrl);
      seededAt = clock().toISOString();
    } else {
      db = JSON.parse(row.json) as Db;
      seededAt = row.seeded_at;
    }
    const before = stale ? '' : row.json;

    const store = new MemoryStore(db);
    const app = createApp(
      { store, adapters: localAdapters({ store, clock, newId, publicBaseUrl }), clock, newId, publicBaseUrl },
      {
        simulator: true,
        resetDemo: async () => {
          store.replace(await seedDb(clock(), newId, publicBaseUrl));
          seededAt = clock().toISOString();
        },
        webhookSecret: env.AFTERBEEP_WEBHOOK_SECRET || undefined,
      },
    );

    const response = await app.fetch(request.clone());
    const after = JSON.stringify(store.read());
    if (after === before) return response;

    const saved = row
      ? await env.DB.prepare('UPDATE state SET json = ?, version = ?, seeded_at = ? WHERE id = ? AND version = ?')
          .bind(after, row.version + 1, seededAt, ROW_ID, row.version)
          .run()
      : await env.DB.prepare('INSERT OR IGNORE INTO state (id, json, version, seeded_at) VALUES (?, ?, 1, ?)')
          .bind(ROW_ID, after, seededAt)
          .run();
    if (saved.meta.changes === 1) return response;
  }

  return Response.json({ error: 'busy', message: 'The demo is busy. Try again in a moment.', details: null }, { status: 503 });
}
