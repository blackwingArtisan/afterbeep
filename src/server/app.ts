import { Hono } from 'hono';
import { z, ZodError } from 'zod';
import { buildPriceBook } from '../domain/price-book';
import { businessTaxRateMilli } from '../domain/tax';
import { sampleInvoiceScripts, simulatorScripts } from './seed';
import { bookingView, bookSlot } from './services/booking';
import { ServiceError, type Deps } from './services/deps';
import { draftInvoice, InvoiceLineSchema, publicInvoice, quoteInvoice, SendInvoiceSchema, sendInvoice } from './services/invoicing';
import { receiveVoicemail, setMessageStatus } from './services/voicemail';

export interface AppOptions {
  /** Replaces the whole state with fresh demo data. Omit to disable the reset route. */
  resetDemo?: () => Promise<void>;
  /** Shared secret for the Amazon Connect webhook. Omit to disable the webhook. */
  webhookSecret?: string;
}

const CallSchema = z.object({
  from: z.string().trim().min(7).max(32),
  transcript: z.string().trim().min(1).max(4000),
  durationSec: z.number().int().min(1).max(600).optional(),
});

const ConnectHookSchema = z.object({
  contactId: z.string().min(1).max(128),
  callerNumber: z.string().min(7).max(32),
  recordingUri: z.string().startsWith('s3://').max(1024),
  durationSec: z.number().int().min(1).max(600).optional(),
});

const SlotSchema = z.object({
  start: z.string().datetime(),
  end: z.string().datetime(),
  address: z.string().trim().max(160).nullable().optional(),
});

const StatusSchema = z.object({ status: z.enum(['new', 'heard', 'called-back']) });
const DraftSchema = z.object({ speech: z.string().trim().min(1).max(2000), jobId: z.string().nullable().optional() });
const QuoteSchema = z.object({ lines: z.array(InvoiceLineSchema).max(40) });

export function createApp(deps: Deps, options: AppOptions = {}) {
  const app = new Hono();

  app.onError((error, c) => {
    if (error instanceof ServiceError) {
      return c.json({ error: error.code, message: error.message, details: error.details ?? null }, error.status);
    }
    if (error instanceof ZodError) {
      return c.json({ error: 'invalid-request', message: 'Some fields are missing or invalid', details: error.issues }, 400);
    }
    if (error instanceof SyntaxError) {
      return c.json({ error: 'invalid-json', message: 'Request body must be JSON', details: null }, 400);
    }
    console.error(error);
    return c.json({ error: 'server-error', message: 'Something went wrong', details: null }, 500);
  });

  const api = new Hono();

  api.get('/health', (c) => c.json({ ok: true, adapters: Object.fromEntries(Object.entries(deps.adapters).map(([k, v]) => [k, v.name])) }));

  api.get('/business', (c) => {
    const { business } = deps.store.read();
    return c.json({ business, taxRateMilli: businessTaxRateMilli(business) });
  });

  api.get('/messages', (c) => {
    const { messages } = deps.store.read();
    const sorted = [...messages].reverse().sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
    return c.json({ messages: sorted, newCount: messages.filter((m) => m.status === 'new').length });
  });

  api.post('/messages/:id/status', async (c) => {
    const { status } = StatusSchema.parse(await c.req.json());
    return c.json({ message: setMessageStatus(deps, c.req.param('id'), status) });
  });

  api.post('/calls', async (c) => {
    const call = CallSchema.parse(await c.req.json());
    return c.json({ message: await receiveVoicemail(deps, call) }, 201);
  });

  api.post('/hooks/connect-voicemail', async (c) => {
    if (!options.webhookSecret) throw new ServiceError(503, 'webhook-disabled', 'The phone webhook is not configured');
    if (c.req.header('authorization') !== `Bearer ${options.webhookSecret}`) {
      return c.json({ error: 'unauthorized', message: 'Bad webhook credentials', details: null }, 401);
    }
    const hook = ConnectHookSchema.parse(await c.req.json());
    const message = await receiveVoicemail(deps, {
      from: hook.callerNumber,
      audioUri: hook.recordingUri,
      durationSec: hook.durationSec,
    });
    return c.json({ messageId: message.id }, 201);
  });

  api.get('/samples', (c) => c.json({ voicemails: simulatorScripts, invoiceScripts: sampleInvoiceScripts }));

  api.get('/book/:token', (c) => c.json(bookingView(deps, c.req.param('token'))));

  api.post('/book/:token', async (c) => {
    const { start, end, address } = SlotSchema.parse(await c.req.json());
    const job = await bookSlot(deps, c.req.param('token'), { start, end }, address ?? null);
    return c.json({ job }, 201);
  });

  api.get('/jobs', (c) => {
    const { jobs } = deps.store.read();
    return c.json({ jobs: [...jobs].sort((a, b) => a.start.localeCompare(b.start)) });
  });

  api.get('/outbox', (c) => {
    const { outbox } = deps.store.read();
    return c.json({ outbox: [...outbox].reverse().sort((a, b) => b.createdAt.localeCompare(a.createdAt)) });
  });

  api.get('/price-book', (c) => c.json({ entries: buildPriceBook(deps.store.read().pastInvoices) }));

  api.post('/invoices/draft', async (c) => {
    const { speech, jobId } = DraftSchema.parse(await c.req.json());
    return c.json(draftInvoice(deps, speech, jobId ?? null));
  });

  api.post('/invoices/quote', async (c) => {
    const { lines } = QuoteSchema.parse(await c.req.json());
    return c.json({ quote: quoteInvoice(deps, lines) });
  });

  api.post('/invoices/send', async (c) => {
    const input = SendInvoiceSchema.parse(await c.req.json());
    return c.json({ invoice: await sendInvoice(deps, input) }, 201);
  });

  api.get('/invoices', (c) => {
    const { invoices } = deps.store.read();
    return c.json({ invoices: [...invoices].reverse().sort((a, b) => b.createdAt.localeCompare(a.createdAt)) });
  });

  api.get('/invoices/:id', (c) => c.json(publicInvoice(deps, c.req.param('id'))));

  api.post('/demo/reset', async (c) => {
    if (!options.resetDemo) throw new ServiceError(404, 'not-found', 'Demo reset is disabled');
    await options.resetDemo();
    return c.json({ ok: true });
  });

  api.all('*', (c) => c.json({ error: 'not-found', message: 'No such API route', details: null }, 404));

  app.route('/api', api);
  return app;
}
