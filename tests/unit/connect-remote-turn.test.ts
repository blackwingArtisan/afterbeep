import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AnswerSchema,
  ConnectEventSchema,
  createHandler,
  decodeState,
  encodeState,
  FAILURE_PROMPT,
  NO_PHONE_INVOICE,
  nextFor,
  speakable,
  type Answer,
} from '../../infra/connect/remote-turn';
import {
  remoteQueue,
  startState,
  step,
  type Key,
  type RemoteEvent,
  type RemoteMessage,
  type RemoteSource,
  type RemoteState,
} from '../../src/domain/remote-retrieval';
import type { Urgency } from '../../src/domain/types';

// Count every call of the script so a test can see how many steps a turn ran (RR 14.24).
vi.mock('../../src/domain/remote-retrieval', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/domain/remote-retrieval')>();
  return { ...actual, step: vi.fn(actual.step) };
});

const URL_BASE = 'https://afterbeep.example.com';
const SECRET = 'test-secret-value-0123';
const ENV = { AFTERBEEP_URL: URL_BASE, AFTERBEEP_WEBHOOK_SECRET: SECRET };
const OWNER = '+15555550100';
const STRANGER = '+15555550177';

// ---------------------------------------------------------------- sample events

interface EventOptions {
  key?: string;
  digits?: string;
  state?: string;
  caller?: string;
}

function ev(turn: string, o: EventOptions = {}): unknown {
  return {
    Name: 'ContactFlowEvent',
    Details: {
      ContactData: {
        ContactId: 'contact-0001',
        Attributes: o.state ? { remoteState: o.state } : {},
        CustomerEndpoint: { Address: o.caller ?? OWNER, Type: 'TELEPHONE_NUMBER' },
      },
      Parameters: {
        step: turn,
        ...(o.key !== undefined ? { key: o.key } : {}),
        ...(o.digits !== undefined ? { digits: o.digits } : {}),
        caller: o.caller ?? OWNER,
      },
    },
  };
}

// ---------------------------------------------------------------- a fake AfterBeep server

function stored(
  id: string,
  urgency: Urgency,
  receivedAt: string,
  callerName: string | null,
  job: string,
  extra: Partial<RemoteSource> = {},
): RemoteSource {
  return {
    id,
    receivedAt,
    from: '+15555550101',
    durationSec: 20,
    transcript: `Hi this is ${callerName ?? 'someone'} about the ${job}.`,
    extraction: {
      callerName,
      callbackNumber: '+15555550101',
      address: null,
      job,
      jobCategory: 'general',
      urgency,
      summary: 'summary',
      source: 'rules',
    },
    status: 'new',
    bookingToken: `tok-${id}`,
    textedAt: null,
    noTextReason: null,
    jobId: null,
    ...extra,
  };
}

const sampleMessages = (): RemoteSource[] => [
  stored('m-routine', 'routine', '2026-11-10T09:00:00Z', 'Sam Ortega', 'garbage disposal'),
  stored('m-emergency', 'emergency', '2026-11-10T10:00:00Z', 'Priya Shah', 'burst water heater'),
  stored('m-soon', 'soon', '2026-11-10T11:00:00Z', 'June Calloway', 'dryer belt'),
];

interface Req {
  method: string;
  path: string;
  auth: string | null;
  body: unknown;
}
type Reply = { status: number; body?: unknown };

class FakeServer {
  messages: RemoteSource[];
  requests: Req[] = [];
  texted = new Set<string>();
  overrides = new Map<string, (req: Req) => Reply>();

  constructor(messages: RemoteSource[] = sampleMessages()) {
    this.messages = messages;
  }

  fetch: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const req: Req = {
      method: init?.method ?? 'GET',
      path: url.pathname,
      auth: new Headers(init?.headers).get('authorization'),
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    };
    this.requests.push(req);
    const reply = this.route(req);
    return new Response(JSON.stringify(reply.body ?? {}), {
      status: reply.status,
      headers: { 'content-type': 'application/json' },
    });
  };

  private route(req: Req): Reply {
    const key = `${req.method} ${req.path}`;
    for (const [pattern, handler] of this.overrides) {
      if (key === pattern || key.replace(/\/messages\/[^/]+\//, '/messages/:id/') === pattern) return handler(req);
    }
    const found = (id: string) => this.messages.find((m) => m.id === id);
    if (key === 'POST /api/remote/code') {
      const code = (req.body as { code?: string }).code;
      if (code !== '427') return { status: 200, body: { result: 'wrong' } };
      return { status: 200, body: { result: 'ok', messages: remoteQueue(this.messages) } };
    }
    if (key === 'GET /api/messages') {
      return { status: 200, body: { messages: this.messages.filter((m) => !m.erasedAt), newCount: 0 } };
    }
    let match = req.path.match(/^\/api\/messages\/([^/]+)\/status$/);
    if (req.method === 'POST' && match) {
      const m = found(decodeURIComponent(match[1] as string));
      if (!m) return { status: 404, body: { error: 'not-found' } };
      m.status = (req.body as { status: 'heard' }).status;
      return { status: 200, body: { message: { id: m.id } } };
    }
    match = req.path.match(/^\/api\/remote\/messages\/([^/]+)\/(text|erase)$/);
    if (req.method === 'POST' && match) {
      const id = decodeURIComponent(match[1] as string);
      const m = found(id);
      if (!m || m.erasedAt) return { status: 404, body: { error: 'not-found' } };
      if (match[2] === 'erase') {
        m.erasedAt = '2026-11-11T00:00:00Z';
        return { status: 200, body: { erased: true } };
      }
      if (this.texted.has(id)) return { status: 200, body: { outcome: 'texted-recently' } };
      this.texted.add(id);
      return { status: 200, body: { outcome: 'sent' } };
    }
    return { status: 404, body: { error: 'not-found' } };
  }

  paths(): string[] {
    return this.requests.map((r) => `${r.method} ${r.path}`);
  }
}

function setup(messages?: RemoteSource[]) {
  const server = new FakeServer(messages);
  const handler = createHandler({ fetch: server.fetch, env: ENV });
  const turn = async (name: string, o: EventOptions = {}): Promise<Answer> => {
    vi.mocked(step).mockClear();
    return handler(ev(name, o));
  };
  return { server, handler, turn };
}

/** Runs the code turn and returns its answer. */
async function enter(t: ReturnType<typeof setup>): Promise<Answer> {
  return t.turn('code', { digits: '427' });
}

const decodedJson = (state: string): string => Buffer.from(state, 'base64url').toString('utf8');
const KEYS_TEXT = 'Press 1 to play, 2 to text back, 9 to erase, pound for next.';

let logged: string[] = [];
beforeEach(() => {
  logged = [];
  for (const level of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(' '));
    });
  }
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// ---------------------------------------------------------------- task 27

describe('the turn Lambda: event and script', () => {
  it('[RR 14.2] a valid Connect event parses', () => {
    const parsed = ConnectEventSchema.safeParse(ev('key', { key: '1', state: 'abc' }));
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.Details.Parameters.step).toBe('key');
      expect(parsed.data.Details.ContactData.Attributes?.remoteState).toBe('abc');
    }
  });

  it('[RR 14.2] a missing step, an unknown step and a bad key are failure answers, and nothing is requested', async () => {
    const t = setup();
    const bad: unknown[] = [
      { Details: { ContactData: { ContactId: 'c' }, Parameters: {} } },
      ev('dance'),
      ev('key', { key: '12' }),
      ev('key'),
      null,
      'text',
    ];
    for (const event of bad) {
      const answer = await t.handler(event);
      expect(answer.prompt).toBe(FAILURE_PROMPT);
      expect(answer.next).toBe('goodbye');
    }
    expect(t.server.requests).toEqual([]);
  });

  it('[RR 14.1] imports step and startState from the domain script and holds no copy of it', () => {
    const source = readFileSync('infra/connect/remote-turn.ts', 'utf8');
    const imported = source.match(/import \{([^}]*)\} from '\.\.\/\.\.\/src\/domain\/remote-retrieval'/);
    expect(imported).not.toBeNull();
    expect(imported?.[1]).toMatch(/\bstep\b/);
    expect(imported?.[1]).toMatch(/\bstartState\b/);
    expect(source).not.toMatch(/function step\b|const step\b|function startState\b|const startState\b/);
    expect(source).not.toMatch(/case 'checking-code'|case 'ringing'/);
  });

  it('[RR 14.12] a missing server address or secret is a failure answer', async () => {
    const server = new FakeServer();
    const handler = createHandler({ fetch: server.fetch, env: { AFTERBEEP_URL: URL_BASE } });
    const answer = await handler(ev('code', { digits: '427' }));
    expect(answer.prompt).toBe(FAILURE_PROMPT);
    expect(server.requests).toEqual([]);
  });
});

// ---------------------------------------------------------------- task 28

describe('the turn Lambda: state encoding', () => {
  const queue: RemoteMessage[] = [
    { id: 'a1', urgency: 'emergency', callerName: 'Priya Shah', job: 'burst water heater', transcript: 'secret words', canText: true },
    { id: 'b2', urgency: 'routine', callerName: null, job: 'drain', transcript: 'more words', canText: false },
  ];
  const state: RemoteState = { ...startState('Hollow Creek Plumbing'), phase: 'message', index: 1, silences: 1, wrongCodes: 2, queue };

  it('[RR 14.7] a state survives a round trip', () => {
    const back = decodeState(encodeState(state));
    expect(back.phase).toBe('message');
    expect(back.index).toBe(1);
    expect(back.silences).toBe(1);
    expect(back.wrongCodes).toBe(2);
    expect(back.pending).toBeNull();
    expect(back.queue.map((m) => [m.id, m.urgency, m.canText])).toEqual([
      ['a1', 'emergency', true],
      ['b2', 'routine', false],
    ]);
  });

  it('[RR 14.7] the encoded string uses only letters, digits, - and _', () => {
    expect(encodeState(state)).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(encodeState({ ...state, pending: 'text' })).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('[RR 14.8] a state built from a queue holds no transcript, name, job, code or secret', () => {
    const json = decodedJson(encodeState({ ...state, digits: '427' }));
    for (const word of ['secret words', 'more words', 'Priya', 'Shah', 'burst water heater', 'drain', 'Hollow Creek', '427', SECRET]) {
      expect(json).not.toContain(word);
    }
    expect(decodeState(encodeState(state)).businessName).toBe('');
  });

  it('[RR 14.8] the state a real turn answers holds no message words, no code and no secret', async () => {
    const t = setup();
    const answer = await enter(t);
    const json = decodedJson(answer.state);
    for (const word of ['Priya', 'burst', 'transcript', 'Hi this is', '427', SECRET, 'Sam Ortega']) {
      expect(json).not.toContain(word);
    }
  });

  it('[RR 14.9] an encoded state over 16,000 characters gives the failure answer', async () => {
    const many = Array.from({ length: 300 }, (_, i) =>
      stored(`message-id-${String(i).padStart(4, '0')}-${'x'.repeat(30)}`, 'routine', `2026-11-10T09:${String(i % 60).padStart(2, '0')}:00Z`, 'Sam Ortega', 'drain'),
    );
    const t = setup(many);
    const answer = await enter(t);
    expect(answer.prompt).toBe(FAILURE_PROMPT);
    expect(answer.next).toBe('goodbye');
    const huge = { ...state, queue: Array.from({ length: 500 }, (_, i) => ({ ...(queue[0] as RemoteMessage), id: `id-${i}-${'y'.repeat(60)}` })) };
    expect(() => encodeState(huge)).toThrow();
    expect(() => decodeState('A'.repeat(16_001))).toThrow();
  });
});

// ---------------------------------------------------------------- task 29

describe('the turn Lambda: the spoken answer', () => {
  it('[RR 14.19] markup and emoji in a transcript are removed and plain marks stay', () => {
    const out = speakable(['<b>Hi</b> there 🔥 it\'s Priya; call me @ 5pm! Ok? Yes, - fine.', '{"x": [1]}']);
    expect(out).toMatch(/^[\p{L}\p{N} .,?!'-]+$/u);
    expect(out).toContain("Hi there it's Priya call me 5pm! Ok? Yes, - fine.");
    expect(out).not.toMatch(/[<>🔥@;{}[\]"]/u);
  });

  it('[RR 14.19] a 4,000-character transcript is cut at a word under 2,500 characters', () => {
    const long = Array.from({ length: 800 }, (_, i) => `word${i}`).join(' ');
    expect(long.length).toBeGreaterThan(4000);
    const out = speakable([long]);
    expect(out.length).toBeLessThanOrEqual(2500);
    expect(out.length).toBeGreaterThan(2400);
    const last = out.split(' ').at(-1) as string;
    expect(long.split(' ')).toContain(last);
  });

  it('[RR 14.18] next is code while the code is asked, menu on a message and goodbye once ended', () => {
    const base = startState('x');
    expect(nextFor({ ...base, phase: 'ask-code' })).toBe('code');
    expect(nextFor({ ...base, phase: 'message' })).toBe('menu');
    expect(nextFor({ ...base, phase: 'confirm-erase' })).toBe('menu');
    expect(nextFor({ ...base, phase: 'ended' })).toBe('goodbye');
    expect(nextFor({ ...base, phase: 'ask-invoice' })).toBe('goodbye');
  });

  it('[RR 14.18] every answer is flat strings: prompt, next and state', async () => {
    const t = setup();
    const answers = [await enter(t), await t.handler(ev('dance'))];
    for (const a of answers) {
      expect(Object.keys(a).sort()).toEqual(['next', 'prompt', 'state']);
      for (const value of Object.values(a)) expect(typeof value).toBe('string');
      expect(AnswerSchema.safeParse(a).success).toBe(true);
    }
  });

  it('[RR 14.19] a transcript with markup is spoken without it', async () => {
    const t = setup([stored('m1', 'routine', '2026-11-10T09:00:00Z', 'Sam Ortega', 'drain', { transcript: '<script>alert(1)</script> my drain 🔥 is {slow}' })]);
    const first = await enter(t);
    const played = await t.turn('key', { key: '1', state: first.state });
    expect(played.prompt).toMatch(/^[\p{L}\p{N} .,?!'-]+$/u);
    expect(played.prompt).toContain('my drain is slow');
  });
});

// ---------------------------------------------------------------- task 30

describe('the turn Lambda: one turn', () => {
  it('[RR 14.3] the first code turn answers the call, drops the opening and reads the messages', async () => {
    const t = setup();
    const answer = await enter(t);
    expect(answer.prompt).not.toContain('This is the answering machine');
    expect(answer.prompt).toContain('You have 3 new messages.');
    expect(answer.prompt).toContain('Message 1 of 3. Emergency. From Priya Shah. burst water heater.');
    expect(answer.prompt.endsWith(KEYS_TEXT)).toBe(true);
    expect(answer.next).toBe('menu');
    expect(decodeState(answer.state).phase).toBe('message');
    expect(t.server.paths()).toEqual(['POST /api/remote/code']);
  });

  it('[RR 14.4] the value Timeout and short digits are silence, and the code is asked again', async () => {
    const t = setup();
    for (const digits of ['Timeout', '42', '', '4271', '4a7']) {
      const answer = await t.turn('code', { digits });
      expect(answer.next, digits).toBe('code');
      expect(answer.prompt, digits).toBe('Enter your three-digit remote code.');
      expect(decodeState(answer.state).silences).toBe(1);
    }
    expect(t.server.requests).toEqual([]);
  });

  it('[RR 14.4] a second silence at the code ends the call', async () => {
    const t = setup();
    const first = await t.turn('code', { digits: 'Timeout' });
    const second = await t.turn('code', { digits: 'Timeout', state: first.state });
    expect(second.next).toBe('goodbye');
    expect(second.prompt).toBe('Goodbye.');
    expect(decodeState(second.state).phase).toBe('ended');
  });

  it('[RR 14.5] the key other never adds a code digit while the code is asked', async () => {
    const t = setup();
    const first = await t.turn('code', { digits: 'Timeout' });
    const other = await t.turn('key', { key: 'other', state: first.state });
    expect(other.next).toBe('code');
    expect(other.prompt).toBe('Enter your three-digit remote code.');
    expect(t.server.requests).toEqual([]);
    expect(decodeState(other.state).phase).toBe('ask-code');
  });

  it('[RR 14.5] the key other on a message is a stray key and never skips', async () => {
    const t = setup();
    const first = await enter(t);
    const other = await t.turn('key', { key: 'other', state: first.state });
    expect(other.prompt).toBe(`That key does nothing here. ${KEYS_TEXT}`);
    expect(decodeState(other.state).index).toBe(0);
  });

  it('[RR 14.5] a pressed key moves the call', async () => {
    const t = setup();
    const first = await enter(t);
    const next = await t.turn('key', { key: '#', state: first.state });
    expect(next.prompt).toContain('Message 2 of 3. Soon. From June Calloway. dryer belt.');
    expect(decodeState(next.state).index).toBe(1);
  });

  it('[RR 14.6] silence on a message asks again, and a second silence says goodbye', async () => {
    const t = setup();
    const first = await enter(t);
    const quiet = await t.turn('silence', { state: first.state });
    expect(quiet.prompt).toBe(KEYS_TEXT);
    expect(quiet.next).toBe('menu');
    const gone = await t.turn('silence', { state: quiet.state });
    expect(gone.prompt).toBe('Goodbye.');
    expect(gone.next).toBe('goodbye');
  });

  it('[RR 14.3] a turn with no saved state that is not a code turn is a failure', async () => {
    const t = setup();
    expect((await t.turn('key', { key: '1' })).prompt).toBe(FAILURE_PROMPT);
    expect((await t.turn('silence')).prompt).toBe(FAILURE_PROMPT);
  });

  it('[RR 14.24] a long random key sequence never runs over six steps or sends one request twice in a turn', async () => {
    let seed = 20261119;
    const random = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const pick = <T,>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
    const keys = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '#', 'other'];

    let t = setup();
    let state: string | undefined;
    for (let i = 0; i < 400; i++) {
      const before = t.server.requests.length;
      let answer: Answer;
      if (!state) {
        t = random() < 0.3 ? setup() : t;
        answer = await t.turn('code', { digits: pick(['427', '427', '000', '12', 'Timeout']) });
      } else {
        const kind = random();
        answer =
          kind < 0.1
            ? await t.turn('silence', { state })
            : kind < 0.15
              ? await t.turn('invoice', { state })
              : await t.turn('key', { key: pick(keys), state });
      }
      expect(vi.mocked(step).mock.calls.length).toBeLessThanOrEqual(6);
      const sent = t.server.requests.slice(before).map((r) => JSON.stringify(r));
      expect(new Set(sent).size).toBe(sent.length);
      expect(AnswerSchema.safeParse(answer).success).toBe(true);
      state = answer.next === 'goodbye' ? undefined : answer.state;
    }
  });

  it('[RR 14.1] one scripted call through handler gives the same prompts as step driven directly', async () => {
    const t = setup();
    const messages = remoteQueue(t.server.messages);
    const direct = (state: RemoteState, events: RemoteEvent[]) => {
      const spoken: string[] = [];
      for (const e of events) {
        const r = step(state, e);
        state = r.state;
        spoken.push(...r.prompts.map((p) => p.text));
      }
      return { state, spoken };
    };
    const k = (key: Key): RemoteEvent => ({ type: 'key', key });

    // The flow spoke the opening, so the phone skips the first prompt.
    let d = direct(startState('Hollow Creek'), [{ type: 'call-answered' }]);
    d = direct(d.state, [k('4'), k('2'), k('7'), { type: 'code-checked', result: 'ok', messages }]);
    const first = await enter(t);
    expect(first.prompt).toBe(speakable(d.spoken));

    const second = await t.turn('key', { key: '#', state: first.state });
    const d2 = direct(d.state, [k('#')]);
    expect(second.prompt).toBe(speakable(d2.spoken));

    const third = await t.turn('key', { key: '*', state: second.state });
    const d3 = direct(d2.state, [k('*')]);
    expect(third.prompt).toBe(speakable(d3.spoken));
  });
});

// ---------------------------------------------------------------- task 31

describe('the turn Lambda: the server client', () => {
  it('[RR 14.12] every request carries the bearer secret, the right method and the right path', async () => {
    const t = setup();
    const first = await enter(t);
    const played = await t.turn('key', { key: '1', state: first.state });
    const texted = await t.turn('key', { key: '2', state: played.state });
    const ask = await t.turn('key', { key: '9', state: texted.state });
    await t.turn('key', { key: '9', state: ask.state });

    expect(t.server.requests.map((r) => `${r.method} ${r.path}`)).toEqual([
      'POST /api/remote/code',
      'GET /api/messages',
      'POST /api/messages/m-emergency/status',
      'GET /api/messages',
      'POST /api/remote/messages/m-emergency/text',
      'GET /api/messages',
      'GET /api/messages',
      'POST /api/remote/messages/m-emergency/erase',
    ]);
    for (const r of t.server.requests) expect(r.auth).toBe(`Bearer ${SECRET}`);
    expect(t.server.requests[0]?.body).toEqual({ code: '427' });
    expect(t.server.requests[2]?.body).toEqual({ status: 'heard' });
  });

  it('[RR 14.12] a response that fails its schema is a failure answer', async () => {
    const codeBad = setup();
    codeBad.server.overrides.set('POST /api/remote/code', () => ({ status: 200, body: { result: 'ok', messages: 'nope' } }));
    expect((await enter(codeBad)).prompt).toBe(FAILURE_PROMPT);

    const listBad = setup();
    const first = await enter(listBad);
    listBad.server.overrides.set('GET /api/messages', () => ({ status: 200, body: { messages: [{ id: 5 }] } }));
    const answer = await listBad.turn('key', { key: '1', state: first.state });
    expect(answer.prompt).toBe(FAILURE_PROMPT);

    const textBad = setup();
    const s1 = await enter(textBad);
    textBad.server.overrides.set('POST /api/remote/messages/:id/text', () => ({ status: 200, body: { outcome: 'maybe' } }));
    expect((await textBad.turn('key', { key: '2', state: s1.state })).prompt).toBe(FAILURE_PROMPT);
  });

  it('[RR 14.21] a fetch that never answers is aborted and the failure answer arrives inside the budget', async () => {
    vi.useFakeTimers();
    let aborted = false;
    const hanging: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          aborted = true;
          reject(new DOMException('aborted', 'AbortError'));
        });
      });
    const handler = createHandler({ fetch: hanging, env: ENV });
    const pending = handler(ev('code', { digits: '427' }));
    await vi.advanceTimersByTimeAsync(4_999);
    let settled = false;
    void pending.then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const answer = await pending;
    expect(aborted).toBe(true);
    expect(answer.prompt).toBe(FAILURE_PROMPT);
    expect(answer.next).toBe('goodbye');
  });

  it('[RR 14.22] a fetch that ignores the abort signal still ends with the failure answer', async () => {
    vi.useFakeTimers();
    const deaf: typeof fetch = () => new Promise<Response>(() => undefined);
    const handler = createHandler({ fetch: deaf, env: ENV });
    const pending = handler(ev('code', { digits: '427' }));
    await vi.advanceTimersByTimeAsync(5_000);
    expect((await pending).prompt).toBe(FAILURE_PROMPT);
  });
});

// ---------------------------------------------------------------- task 32

describe('the turn Lambda: the queue from the server', () => {
  it('[RR 14.10] rebuilds the queue in the saved order with names and jobs from the server', async () => {
    const t = setup();
    const first = await enter(t);
    const second = await t.turn('key', { key: '#', state: first.state });
    const third = await t.turn('key', { key: '#', state: second.state });
    expect(third.prompt).toContain('Message 3 of 3. From Sam Ortega. garbage disposal.');
    const back = await t.turn('key', { key: '*', state: third.state });
    expect(back.prompt).toContain('Message 3 of 3. From Sam Ortega.');
    // The server's current words are used, not words saved in Connect.
    t.server.messages.find((m) => m.id === 'm-routine')!.extraction.job = 'leaking faucet';
    const again = await t.turn('key', { key: '*', state: back.state });
    expect(again.prompt).toContain('leaking faucet');
  });

  it('[RR 14.10] an id erased earlier in the call is dropped and the index follows', async () => {
    const t = setup();
    const first = await enter(t);
    const ask = await t.turn('key', { key: '9', state: first.state });
    const erased = await t.turn('key', { key: '9', state: ask.state });
    expect(erased.prompt).toContain('Erased.');
    expect(erased.prompt).toContain('Message 2 of 3. Soon. From June Calloway.');
    // Next turn: the erased id is gone from the server, so June is message 1 of 2.
    const repeat = await t.turn('key', { key: '*', state: erased.state });
    expect(repeat.prompt).toContain('Message 1 of 2. Soon. From June Calloway. dryer belt.');
    const state = decodeState(repeat.state);
    expect(state.queue.map((m) => m.id)).toEqual(['m-soon', 'm-routine']);
    expect(state.index).toBe(0);
  });

  it('[RR 14.11] a current message that is gone from the server is a failure answer', async () => {
    const t = setup();
    const first = await enter(t);
    t.server.messages.find((m) => m.id === 'm-emergency')!.erasedAt = '2026-11-11T00:00:00Z';
    const answer = await t.turn('key', { key: '1', state: first.state });
    expect(answer.prompt).toBe(FAILURE_PROMPT);
    expect(answer.next).toBe('goodbye');
  });

  it('[RR 14.10] no request is made in the code phases', async () => {
    const t = setup();
    const first = await t.turn('code', { digits: '12' });
    await t.turn('key', { key: '*', state: first.state });
    await t.turn('silence', { state: first.state });
    await t.turn('code', { digits: 'Timeout', state: first.state });
    expect(t.server.requests).toEqual([]);
  });
});

// ---------------------------------------------------------------- task 33

describe('the turn Lambda: effects', () => {
  it('[RR 14.13] the code goes to the server and appears in no state, answer or log', async () => {
    const t = setup();
    const answer = await enter(t);
    expect(t.server.requests[0]).toMatchObject({ method: 'POST', path: '/api/remote/code', body: { code: '427' } });
    expect(decodedJson(answer.state)).not.toContain('427');
    expect(answer.prompt).not.toContain('427');
    expect(logged).toEqual([]);
  });

  it('[RR 14.13] a wrong code asks again, three wrong codes end the call and a locked answer says so', async () => {
    const t = setup();
    const one = await t.turn('code', { digits: '111' });
    expect(one.prompt).toBe('That code is not right. Enter your three-digit remote code.');
    expect(one.next).toBe('code');
    expect(decodeState(one.state).wrongCodes).toBe(1);
    const two = await t.turn('code', { digits: '222', state: one.state });
    expect(two.next).toBe('code');
    const three = await t.turn('code', { digits: '333', state: two.state });
    expect(three.next).toBe('goodbye');
    expect(three.prompt).toBe('That code is not right. Goodbye.');

    const locked = setup();
    locked.server.overrides.set('POST /api/remote/code', () => ({ status: 200, body: { result: 'locked' } }));
    const answer = await enter(locked);
    expect(answer.prompt).toBe('The machine is locked. Try again later.');
    expect(answer.next).toBe('goodbye');
  });

  it('[RR 14.13] a failed code check says something went wrong and asks again', async () => {
    const t = setup();
    t.server.overrides.set('POST /api/remote/code', () => ({ status: 503 }));
    const answer = await enter(t);
    expect(answer.prompt).toBe('Something went wrong. Enter your three-digit remote code.');
    expect(answer.next).toBe('code');
  });

  it('[RR 14.14] the transcript is spoken before the keys prompt', async () => {
    const t = setup();
    const first = await enter(t);
    const played = await t.turn('key', { key: '1', state: first.state });
    const transcript = t.server.messages.find((m) => m.id === 'm-emergency')!.transcript;
    expect(played.prompt).toBe(`${transcript} ${KEYS_TEXT}`);
    expect(played.next).toBe('menu');
  });

  it('[RR 14.15] marks heard only a message that is still new', async () => {
    const t = setup();
    const first = await enter(t);
    await t.turn('key', { key: '1', state: first.state });
    expect(t.server.messages.find((m) => m.id === 'm-emergency')?.status).toBe('heard');

    const changed = setup();
    const s = await enter(changed);
    changed.server.messages.find((m) => m.id === 'm-emergency')!.status = 'called-back';
    await changed.turn('key', { key: '1', state: s.state });
    expect(changed.server.paths().filter((p) => p.includes('/status'))).toEqual([]);
    expect(changed.server.messages.find((m) => m.id === 'm-emergency')?.status).toBe('called-back');
  });

  it('[RR 14.15] a failed mark-heard does not end the call', async () => {
    const t = setup();
    const first = await enter(t);
    t.server.overrides.set('POST /api/messages/:id/status', () => ({ status: 500 }));
    const played = await t.turn('key', { key: '1', state: first.state });
    expect(played.next).toBe('menu');
    expect(played.prompt.endsWith(KEYS_TEXT)).toBe(true);
    expect(played.prompt).toContain('Priya Shah');

    const thrown = setup();
    const s = await enter(thrown);
    const inner = thrown.server.fetch;
    const handler = createHandler({
      fetch: (input, init) => {
        if (String(input).endsWith('/status')) throw new TypeError('network down');
        return inner(input, init);
      },
      env: ENV,
    });
    const answer = await handler(ev('key', { key: '1', state: s.state }));
    expect(answer.next).toBe('menu');
  });

  it('[RR 14.16] each text outcome is fed back and spoken', async () => {
    const spoken: Record<string, string> = {
      sent: 'Booking link texted.',
      'opted-out': 'That caller asked not to be texted.',
      'texted-recently': 'That caller was texted a moment ago.',
      'no-number': 'There is no number to text.',
      refused: 'The text did not go out.',
    };
    for (const [outcome, sentence] of Object.entries(spoken)) {
      const t = setup();
      const first = await enter(t);
      t.server.overrides.set('POST /api/remote/messages/:id/text', () => ({ status: 200, body: { outcome } }));
      const answer = await t.turn('key', { key: '2', state: first.state });
      expect(answer.prompt, outcome).toBe(`${sentence} ${KEYS_TEXT}`);
      expect(answer.next).toBe('menu');
      expect(decodeState(answer.state).pending).toBeNull();
    }
  });

  it('[RR 14.16] a failed text request says something went wrong and the call goes on', async () => {
    const t = setup();
    const first = await enter(t);
    t.server.overrides.set('POST /api/remote/messages/:id/text', () => ({ status: 500 }));
    const answer = await t.turn('key', { key: '2', state: first.state });
    expect(answer.prompt).toBe(`Something went wrong. ${KEYS_TEXT}`);
    expect(answer.next).toBe('menu');
    expect(decodeState(answer.state).pending).toBeNull();
  });

  it('[RR 14.17] an erase that is not found counts as done, and any other failure is effect-failed', async () => {
    const gone = setup();
    const a = await enter(gone);
    const askA = await gone.turn('key', { key: '9', state: a.state });
    gone.server.overrides.set('POST /api/remote/messages/:id/erase', () => ({ status: 404, body: { error: 'not-found' } }));
    const doneA = await gone.turn('key', { key: '9', state: askA.state });
    expect(doneA.prompt.startsWith('Erased.')).toBe(true);
    expect(decodeState(doneA.state).index).toBe(1);

    const broken = setup();
    const b = await enter(broken);
    const askB = await broken.turn('key', { key: '9', state: b.state });
    broken.server.overrides.set('POST /api/remote/messages/:id/erase', () => ({ status: 500 }));
    const failB = await broken.turn('key', { key: '9', state: askB.state });
    expect(failB.prompt).toContain('Something went wrong.');
    expect(failB.next).toBe('menu');
  });

  it('[RR 14.26] the same turn run twice sends a second text the server refuses and an erase that counts as done', async () => {
    const t = setup();
    const first = await enter(t);
    const one = await t.turn('key', { key: '2', state: first.state });
    const two = await t.turn('key', { key: '2', state: first.state });
    expect(one.prompt.startsWith('Booking link texted.')).toBe(true);
    expect(two.prompt.startsWith('That caller was texted a moment ago.')).toBe(true);

    const ask = await t.turn('key', { key: '9', state: first.state });
    const e1 = await t.turn('key', { key: '9', state: ask.state });
    const e2 = await t.turn('key', { key: '9', state: ask.state }).catch(() => null);
    expect(e1.prompt.startsWith('Erased.')).toBe(true);
    // The second run finds its message already gone from the list: the call ends politely, nothing throws.
    expect(e2).not.toBeNull();
    expect(e2?.next).toBe('goodbye');
  });

  it('[RR 14.24] each effect runs once: a key press makes at most one request of each kind', async () => {
    const t = setup();
    const first = await enter(t);
    const before = t.server.requests.length;
    await t.turn('key', { key: '1', state: first.state });
    const paths = t.server.requests.slice(before).map((r) => `${r.method} ${r.path}`);
    expect(paths).toEqual(['GET /api/messages', 'POST /api/messages/m-emergency/status']);
  });
});

// ---------------------------------------------------------------- task 34

describe('the turn Lambda: the invoice step on a phone', () => {
  it('[RR 14.20] after the last message the call ends with the phone rule and makes no draft', async () => {
    const t = setup([stored('only', 'routine', '2026-11-10T09:00:00Z', 'Sam Ortega', 'drain')]);
    const first = await enter(t);
    const last = await t.turn('key', { key: '#', state: first.state });
    expect(last.prompt).toBe(NO_PHONE_INVOICE);
    expect(NO_PHONE_INVOICE).toBe('Invoices by phone are not ready. Use the app.');
    expect(last.next).toBe('goodbye');
    expect(decodeState(last.state).phase).toBe('ended');
    expect(last.prompt).not.toContain('After the beep');
    expect(last.prompt).not.toContain('No invoice heard');
    expect(t.server.paths().some((p) => p.includes('/api/invoices'))).toBe(false);
  });

  it('[RR 14.20] with no messages the count is read and then the phone rule', async () => {
    const t = setup([]);
    const answer = await enter(t);
    expect(answer.prompt).toBe(`You have no new messages. ${NO_PHONE_INVOICE}`);
    expect(answer.next).toBe('goodbye');
    expect(t.server.paths()).toEqual(['POST /api/remote/code']);
  });

  it('[RR 14.20] erasing the last message goes to the phone rule too', async () => {
    const t = setup([stored('only', 'routine', '2026-11-10T09:00:00Z', 'Sam Ortega', 'drain')]);
    const first = await enter(t);
    const ask = await t.turn('key', { key: '9', state: first.state });
    const done = await t.turn('key', { key: '9', state: ask.state });
    expect(done.prompt).toBe(`Erased. ${NO_PHONE_INVOICE}`);
    expect(done.next).toBe('goodbye');
    expect(t.server.paths().some((p) => p.includes('/api/invoices'))).toBe(false);
  });

  it('[RR 14.20] an invoice turn ends the call with the phone rule', async () => {
    const t = setup();
    const first = await enter(t);
    const answer = await t.turn('invoice', { state: first.state });
    expect(answer.next).toBe('menu');
    const none = setup([]);
    const empty = await enter(none);
    expect(empty.next).toBe('goodbye');
  });

  it('[RR 14.25] every prompt the Lambda adds is under 30 words, with no name and no claim to be a person', async () => {
    const t = setup([]);
    const lines = [NO_PHONE_INVOICE, FAILURE_PROMPT, (await t.handler(ev('dance'))).prompt];
    const code = setup();
    const quiet = await code.turn('code', { digits: 'Timeout' });
    lines.push((await code.turn('key', { key: 'other', state: quiet.state })).prompt);
    for (const line of lines) {
      expect(line.split(/\s+/).length, line).toBeLessThan(30);
      expect(line).not.toMatch(/\b(I am|I'm|my name|this is|speaking|receptionist|assistant)\b/i);
      expect(line).not.toMatch(/\b[A-Z][a-z]+ (here|speaking)\b/);
    }
  });
});

// ---------------------------------------------------------------- task 35

describe('the turn Lambda: failure and logs', () => {
  const failing = async (): Promise<{ title: string; answer: Answer }[]> => {
    const out: { title: string; answer: Answer }[] = [];
    const ok = setup();
    const first = await enter(ok);

    const down = createHandler({
      fetch: () => {
        throw new Error('boom');
      },
      env: ENV,
    });
    out.push({ title: 'throwing fetch', answer: await down(ev('key', { key: '1', state: first.state })) });
    out.push({ title: 'garbage state', answer: await ok.handler(ev('key', { key: '1', state: '!!not-base64!!' })) });
    out.push({ title: 'valid base64, not json', answer: await ok.handler(ev('key', { key: '1', state: Buffer.from('hello there').toString('base64url') })) });
    out.push({ title: 'wrong shape', answer: await ok.handler(ev('key', { key: '1', state: Buffer.from('{"v":2}').toString('base64url') })) });
    out.push({ title: 'bad event', answer: await ok.handler({ nothing: true }) });
    out.push({ title: 'script throws', answer: await (async () => {
      vi.mocked(step).mockImplementationOnce(() => {
        throw new Error('bug with 427 and Priya');
      });
      return ok.handler(ev('code', { digits: '427' }));
    })() });
    return out;
  };

  it('[RR 14.22] a throwing fetch, a garbage state, a bad event and a thrown error each give the failure answer', async () => {
    for (const { title, answer } of await failing()) {
      expect(answer.prompt, title).toBe(FAILURE_PROMPT);
      expect(answer.next, title).toBe('goodbye');
      expect(decodeState(answer.state).phase, title).toBe('ended');
    }
  });

  it('[RR 14.22] handler never rejects', async () => {
    const t = setup();
    for (const event of [undefined, null, 5, [], {}, ev('code', { digits: '427', state: 'zzz' })]) {
      await expect(t.handler(event)).resolves.toMatchObject({ prompt: FAILURE_PROMPT, next: 'goodbye' });
    }
  });

  it('[RR 14.23] a log line names only the turn, the phase and the kind of failure', async () => {
    const t = setup();
    const first = await enter(t);
    await t.turn('key', { key: '1', state: first.state });
    await t.turn('code', { digits: '111' });
    const results = await failing();
    expect(results.length).toBeGreaterThan(0);

    expect(logged.length).toBeGreaterThan(0);
    for (const line of logged) {
      expect(line).toMatch(/^remote-turn failed turn=[a-z]+ phase=[a-z-]+ kind=[a-z-]+$/);
      for (const secret of ['427', '111', SECRET, first.state, 'Priya', 'Hi this is', 'burst', 'boom', 'Sam Ortega', OWNER]) {
        expect(line).not.toContain(secret);
      }
    }
  });
});

// ---------------------------------------------------------------- task 36

describe('the turn Lambda: caller ID', () => {
  it('[RR 15.5] the owner and a stranger get identical requests and answers', async () => {
    async function play(caller: string) {
      const t = setup();
      const answers: Answer[] = [];
      const wrong = await t.turn('code', { digits: '999', caller });
      answers.push(wrong);
      const first = await t.turn('code', { digits: '427', caller, state: wrong.state });
      answers.push(first);
      const second = await t.turn('key', { key: '2', caller, state: first.state });
      answers.push(second);
      return { answers, requests: t.server.requests };
    }
    const owner = await play(OWNER);
    const stranger = await play(STRANGER);
    expect(stranger.answers).toEqual(owner.answers);
    expect(stranger.requests).toEqual(owner.requests);
    expect(JSON.stringify(owner.requests)).not.toContain(OWNER);
  });

  it('[RR 16.8] the Lambda file holds no secret and no phone number, and reads its settings from the environment', () => {
    const source = readFileSync('infra/connect/remote-turn.ts', 'utf8');
    expect(source).not.toMatch(/\+\d{7,}|\b555[-\s]?01\d\d\b/);
    expect(source).not.toMatch(/sk_(live|test)_|arn:aws:[a-z-]+:[a-z0-9-]*:\d{12}/);
    expect(source).toMatch(/AFTERBEEP_WEBHOOK_SECRET/);
    expect(source).toMatch(/process\.env/);
  });

  it('[RR 15.5] the source never reads the caller parameter', () => {
    const source = readFileSync('infra/connect/remote-turn.ts', 'utf8');
    expect(source).not.toMatch(/\.caller\b|CustomerEndpoint/);
  });
});
