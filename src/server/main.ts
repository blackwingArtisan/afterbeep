import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { adaptersFromEnv, isDemoMode } from '../adapters';
import { JsonFileStore } from '../adapters/store/local';
import { createApp } from './app';
import { seedDb } from './seed-db';

const env = process.env;
const port = Number(env.PORT ?? 3111);
const publicBaseUrl = (env.AFTERBEEP_PUBLIC_URL ?? `http://localhost:${port}`).replace(/\/$/, '');
const dataDir = resolve(env.AFTERBEEP_DATA_DIR ?? 'data');
const clientDir = resolve(env.AFTERBEEP_CLIENT_DIR ?? 'dist/client');
const newId = () => randomBytes(9).toString('base64url');
const clock = () => new Date();

const seed = () => seedDb(clock(), newId, publicBaseUrl);
const store = await JsonFileStore.open(join(dataDir, 'afterbeep.json'), seed);
const adapters = await adaptersFromEnv(env, { store, clock, newId, publicBaseUrl });

const demo = isDemoMode(env);
const app = createApp(
  { store, adapters, clock, newId, publicBaseUrl },
  {
    resetDemo: demo ? async () => store.replace(await seed()) : undefined,
    simulator: demo,
    webhookSecret: env.AFTERBEEP_WEBHOOK_SECRET,
  },
);

if (existsSync(clientDir)) {
  const indexHtml = readFileSync(join(clientDir, 'index.html'), 'utf8');
  app.use('*', serveStatic({ root: clientDir }));
  app.get('*', (c) => c.html(indexHtml));
}

serve({ fetch: app.fetch, port }, () => {
  const names = Object.entries(adapters).map(([k, v]) => `${k}=${v.name}`).join(' ');
  console.log(`AfterBeep listening on http://localhost:${port} (${names}, demo ${demo ? 'on' : 'off'})`);
});
