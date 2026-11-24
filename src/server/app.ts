import { createHash, timingSafeEqual } from 'node:crypto';
import { Hono } from 'hono';
import { z, ZodError } from 'zod';
import { ModelExtractionSchema } from '../adapters/extractor/schema';
import { keptThisWeek } from '../domain/kept';
import type { VoicemailExtraction } from '../domain/types';
import { publicBusiness } from '../domain/remote-code';
import { buildPriceBook } from '../domain/price-book';
import { businessTaxRateMilli } from '../domain/tax';
import { sampleInvoiceScripts, simulatorScripts } from './seed';
import { bookingView, bookSlot } from './services/booking';
import { ServiceError, type Deps } from './services/deps';
import { draftInvoice, InvoiceLineSchema, payDemoInvoice, publicInvoice, quoteInvoice, SendInvoiceSchema, sendInvoice } from './services/invoicing';
import { graveyardView, raiseTheDead } from './services/revive';
import { eraseMessage, remoteTextBack, verifyRemoteCode } from './services/remote';
import { receiveText } from './services/texting';
import { saveGreeting } from './services/greeting';
import { receiveVoicemail, retryTextBack, setMessageStatus } from './services/voicemail';

export interface AppOptions {
  /** Replaces the whole state with fresh demo data. Omit to disable the reset route. */
  resetDemo?: () => Promise<void>;
  /** Accepts simulated calls on POST /api/calls. Demo mode only: the route has no login. */
  simulator?: boolean;
  /** Shared secret for the Amazon Connect webhook. Omit to disable the webhook. */
  webhookSecret?: string;
}

const CallSchema = z.object({
  from: z.string().trim().min(7).max(32),
  transcript: z.string().trim().min(1).max(4000),
  durationSec: z.number().int().min(1).max(600).optional(),
});

const GreetingSchema = z.object({ greeting: z.string().max(2000) });

const InboundTextSchema = z.object({
  from: z.string().trim().min(7).max(20),
  body: z.string().max(1600),
});

/** An extraction made on the AWS side (the voicemail Lambda runs Bedrock), checked before it is filed. */
const HookExtractionSchema = ModelExtractionSchema.extend({
  source: z.enum(['rules', 'bedrock']),
  fallbackReason: z.string().max(200).optional(),
});

const ConnectHookSchema = z.object({
  contactId: z.string().min(1).max(128),
  callerNumber: z.string().min(7).max(32),
  recordingUri: z.string().startsWith('s3://').max(1024),
  durationSec: z.number().int().min(1).max(600).optional(),
  /** The Lambda's transcript of the recording. Without it the server's own transcriber runs. */
  transcript: z.string().trim().min(1).max(4000).optional(),
  /** The Lambda's extraction. Without it the server's own extractor runs. */
  extraction: HookExtractionSchema.optional(),
});

function hookExtraction(e: z.infer<typeof HookExtractionSchema>): VoicemailExtraction {
  const { language, fallbackReason, ...fields } = e;
  return { ...fields, ...(language === 'es' ? { language } : {}), ...(fallbackReason ? { fallbackReason } : {}) };
}

const SlotSchema = z.object({
  start: z.string().datetime(),
  end: z.string().datetime(),
  address: z.string().trim().max(160).nullable().optional(),
});

const RemoteCodeSchema = z.object({ code: z.string().regex(/^\d{3}$/) });
const StatusSchema = z.object({ status: z.enum(['new', 'heard', 'called-back']) });
const DraftSchema = z.object({ speech: z.string().trim().min(1).max(2000), jobId: z.string().nullable().optional() });
const QuoteSchema = z.object({ lines: z.array(InvoiceLineSchema).max(40) });

/** Compares a request's Authorization header with the shared secret in constant time. */
export function bearerMatches(header: string | undefined, secret: string): boolean {
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(header ?? ''), digest(`Bearer ${secret}`));
}

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

  api.get('/health', (c) =>
    c.json({
      ok: true,
      demo: Boolean(options.simulator),
      adapters: Object.fromEntries(Object.entries(deps.adapters).map(([k, v]) => [k, v.name])),
    }),
  );

  api.put('/business/greeting', async (c) => {
    const { greeting } = GreetingSchema.parse(await c.req.json());
    return c.json({ business: publicBusiness(saveGreeting(deps, greeting)) });
  });

  api.get('/business', (c) => {
    const { business } = deps.store.read();
    return c.json({ business: publicBusiness(business), taxRateMilli: businessTaxRateMilli(business) });
  });

  api.get('/messages', (c) => {
    const messages = deps.store.read().messages.filter((m) => !m.erasedAt);
    const sorted = [...messages].reverse().sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
    return c.json({ messages: sorted, newCount: messages.filter((m) => m.status === 'new').length });
  });

  api.post('/messages/:id/status', async (c) => {
    const { status } = StatusSchema.parse(await c.req.json());
    return c.json({ message: setMessageStatus(deps, c.req.param('id'), status) });
  });

  api.post('/messages/:id/text', async (c) => c.json({ message: await retryTextBack(deps, c.req.param('id')) }));

  // Remote retrieval. Open only while the simulator is on or the request carries the phone secret (RR 2.7).
  api.use('/remote/*', async (c, next) => {
    if (!options.simulator) {
      if (!options.webhookSecret) throw new ServiceError(404, 'not-found', 'Remote retrieval is turned off');
      if (!bearerMatches(c.req.header('authorization'), options.webhookSecret)) {
        return c.json({ error: 'unauthorized', message: 'Bad webhook credentials', details: null }, 401);
      }
    }
    await next();
  });

  api.post('/remote/code', async (c) => {
    const { code } = RemoteCodeSchema.parse(await c.req.json());
    return c.json(verifyRemoteCode(deps, code));
  });

  api.post('/remote/messages/:id/text', async (c) => c.json(await remoteTextBack(deps, c.req.param('id'))));

  api.post('/remote/messages/:id/erase', (c) => c.json(eraseMessage(deps, c.req.param('id'))));

  api.post('/calls', async (c) => {
    if (!options.simulator) throw new ServiceError(404, 'not-found', 'The call simulator is turned off');
    const call = CallSchema.parse(await c.req.json());
    return c.json({ message: await receiveVoicemail(deps, call) }, 201);
  });

  api.post('/hooks/connect-voicemail', async (c) => {
    if (!options.webhookSecret) throw new ServiceError(503, 'webhook-disabled', 'The phone webhook is not configured');
    if (!bearerMatches(c.req.header('authorization'), options.webhookSecret)) {
      return c.json({ error: 'unauthorized', message: 'Bad webhook credentials', details: null }, 401);
    }
    const hook = ConnectHookSchema.parse(await c.req.json());
    // Connect and the hand-off Lambda can retry; a contact already filed is never filed or texted twice.
    const known = deps.store.read().messages.find((m) => m.contactId === hook.contactId);
    if (known) return c.json({ messageId: known.id, duplicate: true }, 200);
    const message = await receiveVoicemail(deps, {
      contactId: hook.contactId,
      from: hook.callerNumber,
      audioUri: hook.recordingUri,
      durationSec: hook.durationSec,
      ...(hook.transcript ? { transcript: hook.transcript } : {}),
      ...(hook.extraction ? { extraction: hookExtraction(hook.extraction) } : {}),
    });
    return c.json({ messageId: message.id }, 201);
  });

  // Replies to the machine's texts. In production AWS End User Messaging publishes each inbound
  // text to an SNS topic, and a small Lambda posts it here with the same shared secret.
  api.post('/hooks/inbound-text', async (c) => {
    if (!options.webhookSecret) throw new ServiceError(503, 'webhook-disabled', 'The phone webhook is not configured');
    if (!bearerMatches(c.req.header('authorization'), options.webhookSecret)) {
      return c.json({ error: 'unauthorized', message: 'Bad webhook credentials', details: null }, 401);
    }
    const text = InboundTextSchema.parse(await c.req.json());
    return c.json(await receiveText(deps, text), 200);
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

  api.get('/kept', (c) => c.json({ kept: keptThisWeek(deps.store.read(), deps.clock()) }));

  api.get('/graveyard', (c) => c.json({ graveyard: graveyardView(deps) }));
  // Only ever on the owner's press: nothing calls this on a schedule.
  api.post('/graveyard/raise', async (c) => c.json(await raiseTheDead(deps)));

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

  api.get('/invoices/:id', (c) =>
    c.json({ ...publicInvoice(deps, c.req.param('id')), demoPay: Boolean(options.simulator) && deps.adapters.invoices.name === 'local' }),
  );

  api.post('/invoices/:id/demo-pay', (c) => {
    if (!options.simulator) throw new ServiceError(404, 'not-found', 'Demo payment is turned off');
    return c.json({ invoice: payDemoInvoice(deps, c.req.param('id')) });
  });

  api.post('/demo/reset', async (c) => {
    if (!options.resetDemo) throw new ServiceError(404, 'not-found', 'Demo reset is disabled');
    await options.resetDemo();
    return c.json({ ok: true });
  });

  api.all('*', (c) => c.json({ error: 'not-found', message: 'No such API route', details: null }, 404));

  app.route('/api', api);
  return app;
}
