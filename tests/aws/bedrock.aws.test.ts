/**
 * The real Amazon Bedrock path, end to end. Skipped unless AFTERBEEP_AWS_TEST=1, because each run
 * makes two small paid model calls (well under a cent on Nova Lite). Run with `npm run test:aws`.
 */
import { describe, expect, it } from 'vitest';
import { BedrockExtractor } from '../../src/adapters/extractor/bedrock';
import { demoBusiness } from '../../src/server/seed';

const enabled = process.env.AFTERBEEP_AWS_TEST === '1';
const callerId = '+16145550199';

describe.skipIf(!enabled)('Amazon Bedrock extractor (live)', () => {
  const bedrock = new BedrockExtractor({
    region: process.env.AWS_REGION ?? 'us-east-1',
    modelId: process.env.AFTERBEEP_BEDROCK_MODEL ?? 'amazon.nova-lite-v1:0',
    log: (line) => console.warn(line),
  });

  it('reads an emergency voicemail without falling back', async () => {
    const result = await bedrock.extract(
      'hi this is priya natarajan at eighty eight hollow pine road my water heater just burst and theres water all over the basement please call me back at six one four five five five zero one three four',
      { callerId, business: demoBusiness },
    );
    expect(result.fallbackReason).toBeUndefined();
    expect(result).toMatchObject({ source: 'bedrock', urgency: 'emergency', callbackNumber: '(614) 555-0134' });
    expect(result.address?.toLowerCase()).toContain('hollow pine');
  }, 30_000);

  it('never invents an address the caller did not give', async () => {
    const result = await bedrock.extract('hey its gus my dryer is not heating no rush call me whenever', { callerId, business: demoBusiness });
    expect(result.address).toBeNull();
    expect(result.callbackNumber).toBe('(614) 555-0199');
  }, 30_000);
});
