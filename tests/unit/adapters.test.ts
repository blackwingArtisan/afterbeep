import type { ConverseCommand, ConverseCommandOutput } from '@aws-sdk/client-bedrock-runtime';
import { describe, expect, it } from 'vitest';
import { adaptersFromEnv, isDemoMode } from '../../src/adapters';
import { addressIsGrounded, BedrockExtractor, numberIsGrounded } from '../../src/adapters/extractor/bedrock';
import { MemoryStore } from '../../src/adapters/store/local';
import { emptyDb } from '../../src/server/seed-db';
import { demoBusiness } from '../../src/server/seed';

const ctx = {
  store: new MemoryStore(emptyDb()),
  clock: () => new Date('2026-11-16T19:30:00Z'),
  newId: () => 'id1',
  publicBaseUrl: 'http://localhost:3111',
};

const transcript =
  "Hi, this is Priya Natarajan. My water heater just burst and there's water all over the basement floor. " +
  "I'm at 88 Hollow Pine Road. Please call me back at six one four, five five five, zero one three four.";
const callerId = '+16145550199';

function stubClient(input: unknown, fail = false) {
  const calls: ConverseCommand[] = [];
  return {
    calls,
    client: {
      async send(command: ConverseCommand): Promise<ConverseCommandOutput> {
        calls.push(command);
        if (fail) throw new Error('throttled');
        return {
          output: { message: { role: 'assistant', content: [{ toolUse: { toolUseId: 't1', name: 'record_voicemail', input: input as never } }] } },
          stopReason: 'tool_use',
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          metrics: { latencyMs: 1 },
          $metadata: {},
        };
      },
    },
  };
}

const modelAnswer = {
  callerName: 'Priya Natarajan',
  callbackNumber: '6145550134',
  address: '88 Hollow Pine Road',
  job: 'Water heater: burst, flooding',
  jobCategory: 'water-heater',
  urgency: 'emergency',
  summary: 'Burst water heater flooding the basement.',
};

describe('adapter selection', () => {
  it('defaults every port to the free local implementation', async () => {
    const a = await adaptersFromEnv({}, ctx);
    expect([a.transcriber.name, a.extractor.name, a.sms.name, a.invoices.name]).toEqual(['local', 'rules', 'outbox', 'local']);
  });

  it('selects the real implementations by env var without calling them', async () => {
    const a = await adaptersFromEnv(
      {
        AFTERBEEP_TRANSCRIBER: 'aws',
        AFTERBEEP_EXTRACTOR: 'bedrock',
        AFTERBEEP_SMS: 'aws',
        AFTERBEEP_SMS_ORIGINATION: '+16145550100',
        AFTERBEEP_INVOICES: 'stripe',
        STRIPE_SECRET_KEY: 'sk_test_example',
      },
      ctx,
    );
    expect([a.transcriber.name, a.extractor.name, a.sms.name, a.invoices.name]).toEqual(['amazon-transcribe', 'bedrock', 'aws-end-user-messaging', 'stripe']);
  });

  it('refuses a live Stripe key and a missing SMS origination number', async () => {
    await expect(adaptersFromEnv({ AFTERBEEP_INVOICES: 'stripe', STRIPE_SECRET_KEY: 'sk_live_example' }, ctx)).rejects.toThrow(/test mode/);
    await expect(adaptersFromEnv({ AFTERBEEP_SMS: 'aws' }, ctx)).rejects.toThrow(/AFTERBEEP_SMS_ORIGINATION/);
  });
});

describe('demo mode', () => {
  it('is on by default only while every adapter is local', () => {
    expect(isDemoMode({})).toBe(true);
    expect(isDemoMode({ AFTERBEEP_SMS: 'outbox', AFTERBEEP_EXTRACTOR: 'rules' })).toBe(true);
    expect(isDemoMode({ AFTERBEEP_SMS: 'aws' })).toBe(false);
    expect(isDemoMode({ AFTERBEEP_INVOICES: 'stripe' })).toBe(false);
  });
  it('follows an explicit AFTERBEEP_DEMO', () => {
    expect(isDemoMode({ AFTERBEEP_DEMO: 'off' })).toBe(false);
    expect(isDemoMode({ AFTERBEEP_DEMO: 'on', AFTERBEEP_SMS: 'aws' })).toBe(true);
  });
});

describe('Bedrock extractor (stubbed client)', () => {
  it('forces the extraction tool and returns the validated answer', async () => {
    const stub = stubClient(modelAnswer);
    const x = new BedrockExtractor({ region: 'us-east-1', modelId: 'amazon.nova-lite-v1:0', client: stub.client });
    const result = await x.extract(transcript, { callerId, business: demoBusiness });
    expect(result).toMatchObject({ source: 'bedrock', callbackNumber: '(614) 555-0134', address: '88 Hollow Pine Road', urgency: 'emergency' });
    expect(stub.calls[0]!.input.toolConfig?.toolChoice).toEqual({ tool: { name: 'record_voicemail' } });
  });

  it('drops a number or address the caller never said', async () => {
    const stub = stubClient({ ...modelAnswer, callbackNumber: '6145550777', address: '12 Elm Street' });
    const x = new BedrockExtractor({ region: 'us-east-1', modelId: 'm', client: stub.client });
    const result = await x.extract(transcript, { callerId, business: demoBusiness });
    expect(result.callbackNumber).toBe('(614) 555-0199');
    expect(result.address).toBeNull();
  });

  it('falls back to the rules when the call fails or the answer is malformed', async () => {
    for (const stub of [stubClient(modelAnswer, true), stubClient({ callerName: 'Priya' })]) {
      const x = new BedrockExtractor({ region: 'us-east-1', modelId: 'm', client: stub.client });
      const result = await x.extract(transcript, { callerId, business: demoBusiness });
      expect(result.source).toBe('rules');
      expect(result.callbackNumber).toBe('(614) 555-0134');
    }
  });

  it('grounds numbers and addresses against the transcript', () => {
    expect(numberIsGrounded('614-555-0134', transcript, callerId)).toBe(true);
    expect(numberIsGrounded('614-555-0199', 'no number said', callerId)).toBe(true);
    expect(numberIsGrounded('614-555-0777', transcript, callerId)).toBe(false);
    expect(addressIsGrounded('88 Hollow Pine Rd', transcript)).toBe(true);
    expect(addressIsGrounded('5 Main Street', transcript)).toBe(false);
  });
});
