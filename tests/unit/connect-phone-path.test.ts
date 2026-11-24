import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { isMasked, maskPhone, maskTranscript } from '../../infra/connect/caller-mask';
import { capKeys, createGate, type CapStore } from '../../infra/connect/call-gate';
import { createHandler, DEFAULT_MAX_CALL_SECONDS, TIME_UP_PROMPT } from '../../infra/connect/remote-turn';
import { contactIdFromKey, createVoicemailHandler, SILENCE, type VoicemailDeps } from '../../infra/connect/voicemail-to-webhook';
import { fillFlow, NO_OWNER } from '../../scripts/deploy-phone';
import type { VoicemailExtraction } from '../../src/domain/types';

const SALT = 'test-salt-that-is-long-enough-to-use';
// A fictional 555-01xx number, built from parts so no file holds a whole phone number.
const realCaller = ['+1', '312', '555', '0147'].join('');
const contactId = '0f8fad5b-d9cb-469f-a165-70867728950e';

describe('caller masking', () => {
  it('maps a caller to one of the 100 fictional stand-ins, the same one every time', () => {
    const masked = maskPhone(realCaller, SALT);
    expect(isMasked(masked)).toBe(true);
    expect(masked).not.toContain('3125550147');
    expect(maskPhone(realCaller, SALT)).toBe(masked);
    expect(maskPhone(realCaller.slice(2), SALT)).toBe(masked);
    expect(maskPhone(masked, SALT)).toBe(masked);
  });

  it('gives a withheld caller ID a stand-in too', () => {
    expect(isMasked(maskPhone(undefined, SALT))).toBe(true);
    expect(isMasked(maskPhone('anonymous', SALT))).toBe(true);
  });

  it('masks numbers a caller says, in digits or in words, and leaves house numbers alone', () => {
    const said = 'this is gus at 19 cobweb lane call me at three one two, five five five, oh one four seven or 312-555-0147';
    const out = maskTranscript(said, SALT);
    expect(out).not.toMatch(/3125550147|312-555-0147|oh one four seven/);
    expect(out).toContain('19 cobweb lane');
    // The spoken number and the written one are the same caller, so they get the same stand-in.
    const standIns = out.match(/\(555\) 555-01\d\d/g) ?? [];
    expect(standIns).toHaveLength(2);
    expect(new Set(standIns).size).toBe(1);
    expect(maskTranscript(out, SALT)).toBe(out);
  });
});

function fakeStore(keys: string[] = []): CapStore & { keys: string[] } {
  return {
    keys,
    async list(prefix) {
      return this.keys.filter((k) => k.startsWith(prefix));
    },
    async put(key) {
      this.keys.push(key);
    },
  };
}

const gateEnv = { CAPS_BUCKET: 'afterbeep-test', DAILY_CALL_CAP: '2', MONTHLY_CALL_CAP: '3', AFTERBEEP_WEBHOOK_SECRET: SALT };
const gateEvent = (id = contactId) => ({ Details: { ContactData: { ContactId: id }, Parameters: { caller: realCaller } } });
const noon = new Date('2026-11-23T12:00:00Z');

describe('call gate', () => {
  it('admits calls up to the daily cap, then turns them away', async () => {
    const store = fakeStore();
    const gate = createGate({ store, env: gateEnv, clock: () => noon });
    expect((await gate(gateEvent('a'))).allowed).toBe('yes');
    expect((await gate(gateEvent('b'))).allowed).toBe('yes');
    expect((await gate(gateEvent('c'))).allowed).toBe('no');
    expect(store.keys).toEqual([capKeys(noon, 'a').marker, capKeys(noon, 'b').marker]);
  });

  it('counts the month too, and a new day does not reset it', async () => {
    const store = fakeStore();
    const days = ['2026-11-21', '2026-11-22', '2026-11-23', '2026-11-24'].map((d) => new Date(`${d}T12:00:00Z`));
    const answers = [];
    for (const [i, day] of days.entries()) answers.push((await createGate({ store, env: gateEnv, clock: () => day })(gateEvent(`c${i}`))).allowed);
    expect(answers).toEqual(['yes', 'yes', 'yes', 'no']);
  });

  it('counts the same contact once, so a transfer or a retry is not a second call', async () => {
    const store = fakeStore();
    const gate = createGate({ store, env: gateEnv, clock: () => noon });
    await gate(gateEvent('a'));
    await gate(gateEvent('a'));
    expect(store.keys).toHaveLength(1);
  });

  it('answers with the masked caller and the start time, never the real number', async () => {
    const answer = await createGate({ store: fakeStore(), env: gateEnv, clock: () => noon })(gateEvent());
    expect(answer.maskedCaller).toBe(maskPhone(realCaller, SALT));
    expect(answer.startedAt).toBe(String(noon.getTime() / 1000));
    expect(JSON.stringify(answer)).not.toContain('3125550147');
  });

  it('fails closed when the count cannot be read or the settings are missing', async () => {
    const broken: CapStore = { list: () => Promise.reject(new Error('denied')), put: () => Promise.resolve() };
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await createGate({ store: broken, env: gateEnv, clock: () => noon })(gateEvent())).allowed).toBe('no');
    expect((await createGate({ store: fakeStore(), env: {}, clock: () => noon })(gateEvent())).allowed).toBe('no');
    expect(log.mock.calls.flat().join(' ')).not.toContain('3125550147');
    log.mockRestore();
  });
});

describe('remote turn time limit', () => {
  const start = noon.getTime() / 1000;
  const event = (afterbeepStart: string) => ({
    Details: { ContactData: { ContactId: contactId, Attributes: { afterbeepStart } }, Parameters: { step: 'code', digits: '427' } },
  });

  it('ends a call that has run past the limit without asking the server', async () => {
    const fetch = vi.fn();
    const later = new Date((start + DEFAULT_MAX_CALL_SECONDS + 1) * 1000);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const answer = await createHandler({ fetch, env: { AFTERBEEP_URL: 'https://x.test', AFTERBEEP_WEBHOOK_SECRET: 's' }, clock: () => later })(event(String(start)));
    log.mockRestore();
    expect(answer).toMatchObject({ prompt: TIME_UP_PROMPT, next: 'goodbye' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('honours MAX_CALL_SECONDS and lets a call inside the limit carry on', async () => {
    const fetch = vi.fn(async () => Response.json({ result: 'wrong' }));
    const soon = new Date((start + 30) * 1000);
    const env = { AFTERBEEP_URL: 'https://x.test', AFTERBEEP_WEBHOOK_SECRET: 's', MAX_CALL_SECONDS: '60' };
    const answer = await createHandler({ fetch, env, clock: () => soon })(event(String(start)));
    expect(answer.prompt).not.toBe(TIME_UP_PROMPT);
    expect(fetch).toHaveBeenCalled();
  });
});

const extraction: VoicemailExtraction = {
  callerName: 'Gus',
  callbackNumber: null,
  address: '19 Cobweb Lane',
  job: 'Dryer: not heating',
  jobCategory: 'appliance',
  urgency: 'routine',
  summary: 'Dryer is not heating.',
  source: 'bedrock',
};

function voicemailDeps(over: Partial<VoicemailDeps> = {}) {
  const posts: { url: string; body: any }[] = [];
  const deps: VoicemailDeps = {
    env: { CONNECT_INSTANCE_ID: 'inst', AFTERBEEP_URL: 'https://afterbeep.test', AFTERBEEP_WEBHOOK_SECRET: SALT },
    callerFor: async () => maskPhone(realCaller, SALT),
    transcribe: async () => 'hi its gus at 19 cobweb lane my dryer is not heating call me at 312 555 0147',
    extract: vi.fn(async () => extraction),
    fetch: (async (url: string, init?: RequestInit) => {
      if (url.endsWith('/api/business')) return Response.json({ business: { name: 'Hollow Creek', trade: 'plumbing' } });
      posts.push({ url, body: JSON.parse(String(init?.body)) });
      return Response.json({ messageId: 'm1' }, { status: 201 });
    }) as typeof fetch,
    ...over,
  };
  return { deps, posts };
}

const s3Event = (key = `connect/afterbeep/CallRecordings/2026/11/23/${contactId}_20261123T12:00_UTC.wav`) => ({
  Records: [{ s3: { bucket: { name: 'afterbeep-test' }, object: { key } } }],
});

describe('voicemail Lambda', () => {
  it('reads the contact id from a Connect recording key', () => {
    expect(contactIdFromKey(`connect/x/CallRecordings/2026/11/23/${contactId}_20261123T12:00_UTC.wav`)).toBe(contactId);
    expect(contactIdFromKey('connect/x/not-a-recording.wav')).toBeNull();
  });

  it('masks the transcript before Bedrock and posts the transcript and extraction to the webhook', async () => {
    const { deps, posts } = voicemailDeps();
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await createVoicemailHandler(deps)(s3Event());
    const logged = log.mock.calls.flat().join(' ');
    log.mockRestore();
    const [said] = (deps.extract as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(said).not.toMatch(/312 555 0147/);
    expect(said).toMatch(/\(555\) 555-01\d\d/);
    expect(posts).toHaveLength(1);
    expect(posts[0]!.url).toBe('https://afterbeep.test/api/hooks/connect-voicemail');
    expect(posts[0]!.body).toMatchObject({ contactId, callerNumber: maskPhone(realCaller, SALT), transcript: said, extraction });
    expect(JSON.stringify(posts[0]!.body)).not.toContain('3125550147');
    expect(logged).not.toMatch(/3125550147|cobweb/i);
  });

  it('files a recording with no speech as silence, without calling Bedrock', async () => {
    const { deps, posts } = voicemailDeps({ transcribe: async () => '' });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await createVoicemailHandler(deps)(s3Event());
    vi.restoreAllMocks();
    expect(deps.extract).not.toHaveBeenCalled();
    expect(posts[0]!.body.transcript).toBe(SILENCE);
  });

  it('skips a recording with no caller attribute, and masks a stored number that is somehow real', async () => {
    const skipped = voicemailDeps({ callerFor: async () => undefined });
    const real = voicemailDeps({ callerFor: async () => realCaller });
    vi.spyOn(console, 'log').mockImplementation(() => {});
    await createVoicemailHandler(skipped.deps)(s3Event());
    await createVoicemailHandler(real.deps)(s3Event());
    vi.restoreAllMocks();
    expect(skipped.posts).toHaveLength(0);
    expect(real.posts[0]!.body.callerNumber).toBe(maskPhone(realCaller, SALT));
  });

  it('throws on a webhook failure so Lambda retries and then parks the event', async () => {
    const { deps } = voicemailDeps({
      fetch: (async (url: string) =>
        url.endsWith('/api/business') ? Response.json({ business: {} }) : new Response('down', { status: 503 })) as typeof fetch,
    });
    await expect(createVoicemailHandler(deps)(s3Event())).rejects.toThrow('503');
  });
});

describe('deploy script', () => {
  it('fills every placeholder in both flows and refuses a flow with one left', () => {
    const remote = fillFlow(readFileSync('infra/connect/remote-retrieval-flow.json', 'utf8'), { REPLACE_WITH_REMOTE_TURN_LAMBDA_ARN: 'arn:turn' });
    expect(remote).not.toContain('REPLACE_WITH_');
    const voicemail = fillFlow(readFileSync('infra/connect/contact-flow.json', 'utf8'), {
      REPLACE_WITH_CALL_GATE_LAMBDA_ARN: 'arn:gate',
      REPLACE_WITH_REMOTE_FLOW_ID: 'flow-id',
      REPLACE_WITH_OWNER_NUMBER: NO_OWNER,
    });
    expect(voicemail).not.toContain('REPLACE_WITH_');
    expect(() => fillFlow(readFileSync('infra/connect/contact-flow.json', 'utf8'), {})).toThrow(/placeholder/);
  });
});
