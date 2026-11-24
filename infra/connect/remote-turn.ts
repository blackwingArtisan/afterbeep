/**
 * The turn Lambda for the remote retrieval flow. Tested with a fake fetch and deployed on the
 * demo line by scripts/deploy-phone.ts.
 *
 * Amazon Connect calls it once per key press, silence or keyed code. It runs the shared call
 * script (`step`, `startState`) and answers three flat strings: `prompt`, `next` and `state`.
 * It holds no copy of the script. Caller ID is never read: it only routes the call (RR 15.5).
 * A call that has run past MAX_CALL_SECONDS (from the call gate's start stamp) is ended.
 */
import { z } from 'zod';
import {
  startState,
  step,
  toRemoteMessage,
  type Key,
  type Phase,
  type RemoteEffect,
  type RemoteEvent,
  type RemoteMessage,
  type RemoteState,
  type TextOutcome,
} from '../../src/domain/remote-retrieval';

// ---------------------------------------------------------------- limits and wording

export const MAX_STATE_CHARS = 16_000;
export const MAX_PROMPT_CHARS = 2_500;
export const MAX_STEPS = 6;
export const TURN_BUDGET_MS = 5_000;

export const FAILURE_PROMPT = 'Something went wrong. Goodbye.';
export const TIME_UP_PROMPT = 'This call has reached its time limit. Goodbye.';
/** Longest remote call, counted from the call gate's start stamp. MAX_CALL_SECONDS overrides it. */
export const DEFAULT_MAX_CALL_SECONDS = 240;
export const NO_PHONE_INVOICE = 'Invoices by phone are not ready. Use the app.';
const FALLBACK_PROMPTS = {
  code: 'Enter your three-digit remote code.',
  menu: 'Press 1 to play, 2 to text back, 9 to erase, pound for next.',
  goodbye: 'Goodbye.',
} as const;

// ---------------------------------------------------------------- schemas

const KEYS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '#'] as const;

export const ConnectEventSchema = z.object({
  Details: z.object({
    ContactData: z.object({
      ContactId: z.string().max(256),
      Attributes: z.record(z.string(), z.string()).optional(),
    }),
    Parameters: z.object({
      step: z.enum(['code', 'key', 'silence', 'invoice']),
      key: z.enum([...KEYS, 'other']).optional(),
      digits: z.string().max(64).optional(),
      caller: z.string().max(64).optional(),
      contactId: z.string().max(256).optional(),
    }),
  }),
});
export type ConnectEvent = z.infer<typeof ConnectEventSchema>;

export const AnswerSchema = z.object({
  prompt: z.string(),
  next: z.enum(['code', 'menu', 'invoice', 'goodbye']),
  state: z.string(),
});
export type Answer = z.infer<typeof AnswerSchema>;

const EnvSchema = z.object({
  AFTERBEEP_URL: z.string().url(),
  AFTERBEEP_WEBHOOK_SECRET: z.string().min(1),
});

const RemoteMessageSchema = z.object({
  id: z.string().min(1).max(128),
  urgency: z.enum(['emergency', 'soon', 'routine']),
  callerName: z.string().nullable(),
  job: z.string(),
  transcript: z.string(),
  canText: z.boolean(),
});

const CodeResponseSchema = z.discriminatedUnion('result', [
  z.object({ result: z.literal('ok'), messages: z.array(RemoteMessageSchema).max(500) }),
  z.object({ result: z.literal('wrong') }),
  z.object({ result: z.literal('locked') }),
]);

const TextResponseSchema = z.object({
  outcome: z.enum(['sent', 'opted-out', 'texted-recently', 'no-number', 'refused']),
});
const EraseResponseSchema = z.object({ erased: z.literal(true) });
const StatusResponseSchema = z.object({ message: z.object({ id: z.string() }) });

const StoredMessageSchema = z.object({
  id: z.string().min(1).max(128),
  from: z.string(),
  transcript: z.string(),
  status: z.enum(['new', 'heard', 'called-back']),
  erasedAt: z.string().nullable().optional(),
  extraction: z.object({
    urgency: z.enum(['emergency', 'soon', 'routine']),
    callerName: z.string().nullable().optional(),
    callbackNumber: z.string().nullable().optional(),
    job: z.string(),
  }),
});
const MessagesResponseSchema = z.object({ messages: z.array(StoredMessageSchema) });

// ---------------------------------------------------------------- failures and logging

export type FailureKind =
  | 'bad-event'
  | 'bad-state'
  | 'state-too-large'
  | 'config'
  | 'server'
  | 'schema'
  | 'timeout'
  | 'message-gone'
  | 'too-many-steps'
  | 'internal';

class TurnFailure extends Error {
  constructor(readonly kind: FailureKind) {
    super(kind);
  }
}

/** A log line names the turn, the phase and the kind of failure, and nothing else (RR 14.23). */
function logFailure(turn: string, phase: string, kind: FailureKind): void {
  console.error(`remote-turn failed turn=${turn} phase=${phase} kind=${kind}`);
}

// ---------------------------------------------------------------- state encoding (RR 14.7 to 14.9)

const PERSISTED_PHASES = ['ask-code', 'message', 'confirm-erase', 'ask-invoice', 'ended'] as const;
const URGENCY_CODE = { emergency: 'e', soon: 's', routine: 'r' } as const;
const URGENCY_FROM_CODE = { e: 'emergency', s: 'soon', r: 'routine' } as const;

const SavedStateSchema = z
  .object({
    v: z.literal(1),
    p: z.enum(PERSISTED_PHASES),
    w: z.number().int().min(0).max(3),
    s: z.number().int().min(0).max(2),
    i: z.number().int().min(0).max(1000),
    k: z.literal('text').nullable(),
    q: z.array(z.tuple([z.string().min(1).max(128), z.enum(['e', 's', 'r']), z.union([z.literal(0), z.literal(1)])])).max(1000),
  })
  .refine((s) => s.i <= s.q.length, 'index past the queue')
  .refine((s) => !(s.p === 'message' || s.p === 'confirm-erase') || s.i < s.q.length, 'no current message');

/** Compact JSON in base64url without padding. Holds ids, urgency and a can-text flag, no message words. */
export function encodeState(state: RemoteState): string {
  const saved = {
    v: 1,
    p: state.phase,
    w: state.wrongCodes,
    s: state.silences,
    i: state.index,
    k: state.pending,
    q: state.queue.map((m) => [m.id, URGENCY_CODE[m.urgency], m.canText ? 1 : 0]),
  };
  const encoded = Buffer.from(JSON.stringify(saved), 'utf8').toString('base64url');
  if (encoded.length > MAX_STATE_CHARS) throw new TurnFailure('state-too-large');
  return encoded;
}

export function decodeState(encoded: string): RemoteState {
  if (encoded.length > MAX_STATE_CHARS || !/^[A-Za-z0-9_-]+$/.test(encoded)) throw new TurnFailure('bad-state');
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    throw new TurnFailure('bad-state');
  }
  const parsed = SavedStateSchema.safeParse(raw);
  if (!parsed.success) throw new TurnFailure('bad-state');
  const s = parsed.data;
  return {
    phase: s.p,
    businessName: '',
    digits: '',
    wrongCodes: s.w,
    silences: s.s,
    queue: s.q.map(([id, u, t]) => ({
      id,
      urgency: URGENCY_FROM_CODE[u],
      callerName: null,
      job: '',
      transcript: '',
      canText: t === 1,
    })),
    index: s.i,
    pending: s.k,
  };
}

// ---------------------------------------------------------------- the answer (RR 14.18, 14.19)

/** Keeps letters, digits, spaces and `. , ? ! ' -`, and cuts at a word boundary under the limit. */
export function speakable(texts: readonly string[]): string {
  const joined = texts
    .join(' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/[^\p{L}\p{N} .,?!'-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (joined.length <= MAX_PROMPT_CHARS) return joined;
  const cut = joined.slice(0, MAX_PROMPT_CHARS);
  if (joined[MAX_PROMPT_CHARS] === ' ') return cut.trim();
  const space = cut.lastIndexOf(' ');
  return (space > 0 ? cut.slice(0, space) : cut).trim();
}

export function nextFor(state: RemoteState): Answer['next'] {
  switch (state.phase) {
    case 'ask-code':
      return 'code';
    case 'message':
    case 'confirm-erase':
      return 'menu';
    case 'ended':
    case 'ask-invoice':
      return 'goodbye';
    default:
      throw new TurnFailure('internal');
  }
}

function answerFor(state: RemoteState, texts: readonly string[]): Answer {
  const next = nextFor(state);
  const prompt = speakable(texts) || FALLBACK_PROMPTS[next === 'invoice' ? 'goodbye' : next];
  return AnswerSchema.parse({ prompt, next, state: encodeState(state) });
}

function failureAnswer(): Answer {
  const ended: RemoteState = { ...startState(''), phase: 'ended' };
  return { prompt: FAILURE_PROMPT, next: 'goodbye', state: encodeState(ended) };
}

// ---------------------------------------------------------------- the server client (RR 14.12, 14.21)

export interface HandlerDeps {
  fetch: typeof fetch;
  env: Record<string, string | undefined>;
  /** Defaults to the system clock. */
  clock?: () => Date;
}

/** True when the call gate stamped this call's start and the call has run past the limit. */
export function overTime(attributes: Record<string, string> | undefined, deps: HandlerDeps): boolean {
  const started = Number(attributes?.afterbeepStart);
  if (!Number.isFinite(started) || started <= 0) return false;
  const limit = Number(deps.env.MAX_CALL_SECONDS) > 0 ? Number(deps.env.MAX_CALL_SECONDS) : DEFAULT_MAX_CALL_SECONDS;
  const now = (deps.clock ?? (() => new Date()))().getTime() / 1000;
  return now - started > limit;
}

interface ApiResult {
  status: number;
  body: unknown;
}

interface Api {
  call(method: 'GET' | 'POST', path: string, body?: unknown): Promise<ApiResult>;
}

function makeApi(deps: HandlerDeps, signal: AbortSignal): Api {
  const env = EnvSchema.safeParse(deps.env);
  if (!env.success) throw new TurnFailure('config');
  const base = env.data.AFTERBEEP_URL.replace(/\/+$/, '');
  const secret = env.data.AFTERBEEP_WEBHOOK_SECRET;
  return {
    async call(method, path, body) {
      if (signal.aborted) throw new TurnFailure('timeout');
      const headers: Record<string, string> = { Authorization: `Bearer ${secret}` };
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      const init: RequestInit = { method, headers, signal };
      if (body !== undefined) init.body = JSON.stringify(body);
      const res = await deps.fetch(`${base}${path}`, init);
      let json: unknown;
      try {
        json = await res.json();
      } catch {
        json = undefined;
      }
      return { status: res.status, body: json };
    },
  };
}

function parseBody<T>(schema: z.ZodType<T>, result: ApiResult): T {
  const parsed = schema.safeParse(result.body);
  if (!parsed.success) throw new TurnFailure('schema');
  return parsed.data;
}

const isOk = (r: ApiResult): boolean => r.status >= 200 && r.status < 300;

// ---------------------------------------------------------------- one turn

type StoredMessage = z.infer<typeof StoredMessageSchema>;

/** Rebuilds the queue from the server, drops erased ids and keeps the index on the same message (RR 14.10, 14.11). */
function rebuildQueue(state: RemoteState, stored: readonly StoredMessage[]): RemoteState {
  const byId = new Map(stored.filter((m) => !m.erasedAt).map((m) => [m.id, m]));
  const queue: RemoteMessage[] = [];
  let index = 0;
  state.queue.forEach((saved, i) => {
    const m = byId.get(saved.id);
    if (!m) return;
    queue.push(
      toRemoteMessage({
        id: m.id,
        from: m.from,
        transcript: m.transcript,
        extraction: {
          urgency: m.extraction.urgency,
          callerName: m.extraction.callerName ?? null,
          callbackNumber: m.extraction.callbackNumber ?? null,
          job: m.extraction.job,
        },
      }),
    );
    if (i < state.index) index += 1;
  });
  if (state.phase === 'message' || state.phase === 'confirm-erase') {
    const current = state.queue[state.index];
    if (!current || !byId.has(current.id)) throw new TurnFailure('message-gone');
  }
  return { ...state, queue, index };
}

interface EffectOutcome {
  event?: RemoteEvent;
  /** Words spoken before the step's prompts. */
  lead?: string;
}

async function runEffect(
  effect: RemoteEffect,
  api: Api,
  statuses: ReadonlyMap<string, string>,
): Promise<EffectOutcome> {
  const failed = (): EffectOutcome => ({ event: { type: 'effect-failed', effect: effect.type } });
  const id = (messageId: string) => encodeURIComponent(messageId);

  switch (effect.type) {
    case 'verify-code': {
      let res: ApiResult;
      try {
        res = await api.call('POST', '/api/remote/code', { code: effect.code });
      } catch (error) {
        if (error instanceof TurnFailure) throw error;
        return failed();
      }
      if (!isOk(res)) return failed();
      const body = parseBody(CodeResponseSchema, res);
      if (body.result === 'ok') return { event: { type: 'code-checked', result: 'ok', messages: body.messages } };
      return { event: { type: 'code-checked', result: body.result } };
    }
    case 'play-message':
      return { lead: effect.transcript };
    case 'mark-heard': {
      if (statuses.get(effect.messageId) !== 'new') return {};
      try {
        const res = await api.call('POST', `/api/messages/${id(effect.messageId)}/status`, { status: 'heard' });
        if (isOk(res)) StatusResponseSchema.safeParse(res.body);
      } catch (error) {
        if (error instanceof TurnFailure) throw error;
      }
      return {};
    }
    case 'text-booking-link': {
      let res: ApiResult;
      try {
        res = await api.call('POST', `/api/remote/messages/${id(effect.messageId)}/text`);
      } catch (error) {
        if (error instanceof TurnFailure) throw error;
        return failed();
      }
      if (!isOk(res)) return failed();
      const outcome: TextOutcome = parseBody(TextResponseSchema, res).outcome;
      return { event: { type: 'text-result', outcome } };
    }
    case 'erase-message': {
      let res: ApiResult;
      try {
        res = await api.call('POST', `/api/remote/messages/${id(effect.messageId)}/erase`);
      } catch (error) {
        if (error instanceof TurnFailure) throw error;
        return failed();
      }
      if (res.status === 404) return {};
      if (!isOk(res)) return failed();
      parseBody(EraseResponseSchema, res);
      return {};
    }
    // Not carried out on a phone: no invoice is recorded or drafted (RR 14.20); the flow hangs up.
    case 'start-invoice':
    case 'draft-invoice':
    case 'hang-up':
      return {};
  }
}

function eventsFor(parameters: ConnectEvent['Details']['Parameters'], state: RemoteState): RemoteEvent[] {
  switch (parameters.step) {
    case 'code':
      if (parameters.digits !== undefined && /^[0-9]{3}$/.test(parameters.digits)) {
        return [...parameters.digits].map((d) => ({ type: 'key', key: d as Key }));
      }
      return [{ type: 'silence' }];
    case 'key': {
      if (!parameters.key) throw new TurnFailure('bad-event');
      const key: Key = parameters.key === 'other' ? (state.phase === 'ask-code' ? '#' : '0') : parameters.key;
      return [{ type: 'key', key }];
    }
    case 'silence':
      return [{ type: 'silence' }];
    case 'invoice':
      return [{ type: 'invoice-heard', speech: '' }];
  }
}

async function runTurn(
  event: ConnectEvent,
  api: Api,
  onPhase: (phase: Phase) => void,
): Promise<Answer> {
  const parameters = event.Details.Parameters;
  const savedAttr = event.Details.ContactData.Attributes?.remoteState;
  let steps = 0;
  const run = (state: RemoteState, e: RemoteEvent) => {
    steps += 1;
    if (steps > MAX_STEPS) throw new TurnFailure('too-many-steps');
    return step(state, e);
  };

  let state: RemoteState;
  if (!savedAttr) {
    if (parameters.step !== 'code') throw new TurnFailure('bad-state');
    state = run(startState(''), { type: 'call-answered' }).state; // prompts dropped: the flow spoke the opening (RR 14.3)
  } else {
    state = decodeState(savedAttr);
    if (parameters.step === 'code' && state.phase !== 'ask-code') throw new TurnFailure('bad-state');
  }
  onPhase(state.phase);

  const statuses = new Map<string, string>();
  if (state.phase === 'message' || state.phase === 'confirm-erase' || state.phase === 'ask-invoice') {
    let res: ApiResult;
    try {
      res = await api.call('GET', '/api/messages');
    } catch (error) {
      throw error instanceof TurnFailure ? error : new TurnFailure('server');
    }
    if (!isOk(res)) throw new TurnFailure('server');
    const list = parseBody(MessagesResponseSchema, res).messages;
    for (const m of list) statuses.set(m.id, m.status);
    state = rebuildQueue(state, list);
  }

  const pendingEvents = eventsFor(parameters, state);
  const lead: string[] = [];
  const texts: string[] = [];
  const ran = new Set<string>();

  while (pendingEvents.length > 0) {
    const e = pendingEvents.shift() as RemoteEvent;
    const result = run(state, e);
    state = result.state;
    let prompts = result.prompts;
    let effects = result.effects;

    if (e.type === 'invoice-heard') {
      prompts = prompts.filter((p) => p.id !== 'no-invoice' && p.id !== 'goodbye');
    }
    texts.push(...prompts.filter((p) => p.id !== 'ask-invoice').map((p) => p.text));
    if (state.phase === 'ask-invoice') {
      // Nothing on a phone can take the spoken invoice yet (RR 14.20).
      effects = effects.filter((f) => f.type !== 'start-invoice');
      texts.push(NO_PHONE_INVOICE);
      pendingEvents.unshift({ type: 'invoice-heard', speech: '' });
    }

    const results: RemoteEvent[] = [];
    for (const effect of effects) {
      const key = JSON.stringify(effect);
      if (ran.has(key)) continue;
      ran.add(key);
      const outcome = await runEffect(effect, api, statuses);
      if (outcome.lead !== undefined) lead.push(outcome.lead);
      if (outcome.event) results.push(outcome.event);
    }
    pendingEvents.unshift(...results);
  }

  return answerFor(state, [...lead, ...texts]);
}

// ---------------------------------------------------------------- the handler

export function createHandler(deps: HandlerDeps): (event: unknown) => Promise<Answer> {
  return async (rawEvent: unknown): Promise<Answer> => {
    let turn = 'unknown';
    let phase = 'unknown';
    try {
      const parsed = ConnectEventSchema.safeParse(rawEvent);
      if (!parsed.success) throw new TurnFailure('bad-event');
      const event = parsed.data;
      turn = event.Details.Parameters.step;
      if (overTime(event.Details.ContactData.Attributes, deps)) {
        console.log(`remote-turn time-up turn=${turn}`);
        return { prompt: TIME_UP_PROMPT, next: 'goodbye', state: encodeState({ ...startState(''), phase: 'ended' }) };
      }

      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const deadline = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new TurnFailure('timeout'));
        }, TURN_BUDGET_MS);
      });
      try {
        const api = makeApi(deps, controller.signal);
        return await Promise.race([runTurn(event, api, (p) => (phase = p)), deadline]);
      } finally {
        clearTimeout(timer);
      }
    } catch (error) {
      const kind: FailureKind = error instanceof TurnFailure ? error.kind : 'internal';
      logFailure(turn, phase, kind === 'internal' && error instanceof Error && error.name === 'AbortError' ? 'timeout' : kind);
      return failureAnswer();
    }
  };
}

export const handler = createHandler({
  fetch: (input, init) => globalThis.fetch(input, init),
  env: process.env,
});
