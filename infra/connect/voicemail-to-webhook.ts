/**
 * The voicemail Lambda. Amazon Connect stores each voicemail recording in S3, and this function,
 * triggered by the new object, does the AWS half of the missed-call pipeline:
 *
 *   recording -> Amazon Transcribe -> numbers masked -> Amazon Bedrock extraction (capped)
 *   -> POST /api/hooks/connect-voicemail on the AfterBeep server, which files it and texts back.
 *
 * The caller's number arrives already masked (the call gate stored a stand-in), and every number in
 * the transcript is masked before Bedrock or the server sees it. Nothing here logs a number or words
 * from the message. Transcripts are written to the same bucket, which expires them.
 */
import { ConnectClient, GetContactAttributesCommand } from '@aws-sdk/client-connect';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import {
  ConflictException,
  GetTranscriptionJobCommand,
  StartTranscriptionJobCommand,
  TranscribeClient,
} from '@aws-sdk/client-transcribe';
import { z } from 'zod';
import { BedrockExtractor } from '../../src/adapters/extractor/bedrock';
import type { Business, VoicemailExtraction } from '../../src/domain/types';
import { isMasked, maskPhone, maskTranscript } from './caller-mask';

/** What a message with no speech is filed as, so a hang-up still reaches the graveyard. */
export const SILENCE = '(silence)';

const EnvSchema = z.object({
  CONNECT_INSTANCE_ID: z.string().min(1),
  AFTERBEEP_URL: z.string().url(),
  AFTERBEEP_WEBHOOK_SECRET: z.string().min(1),
  BEDROCK_MODEL_ID: z.string().min(1).default('amazon.nova-lite-v1:0'),
  BEDROCK_MAX_TOKENS: z.coerce.number().int().min(50).max(1000).default(300),
  BEDROCK_MAX_INPUT_CHARS: z.coerce.number().int().min(100).max(8000).default(2000),
  AWS_REGION: z.string().default('us-east-1'),
});
export type VoicemailEnv = z.infer<typeof EnvSchema>;

export interface S3Record {
  s3: { bucket: { name: string }; object: { key: string } };
}

/** Each call this Lambda makes, injectable so tests never reach AWS or the network. */
export interface VoicemailDeps {
  env: Record<string, string | undefined>;
  callerFor(instanceId: string, contactId: string): Promise<string | undefined>;
  transcribe(bucket: string, key: string, contactId: string): Promise<string>;
  extract(transcript: string, callerId: string, business: Business, env: VoicemailEnv): Promise<VoicemailExtraction>;
  fetch: typeof fetch;
}

/** Connect names recordings <contactId>_<timestamp>[_suffix].wav under the instance prefix. */
export function contactIdFromKey(key: string): string | null {
  const file = key.split('/').pop() ?? '';
  const id = file.split('_')[0] ?? '';
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ? id : null;
}

export interface Filed {
  contactId: string;
  status: number;
  extractor?: string;
}

export function createVoicemailHandler(deps: VoicemailDeps) {
  return async (event: { Records?: S3Record[] }): Promise<Filed[]> => {
    const env = EnvSchema.parse(deps.env);
    const base = env.AFTERBEEP_URL.replace(/\/+$/, '');
    const auth = { authorization: `Bearer ${env.AFTERBEEP_WEBHOOK_SECRET}` };
    const filed: Filed[] = [];

    for (const record of event.Records ?? []) {
      const bucket = record.s3.bucket.name;
      const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));
      const contactId = contactIdFromKey(key);
      if (!contactId) continue;

      // Only calls that went through the gate carry a caller attribute; anything else is not a voicemail.
      const stored = await deps.callerFor(env.CONNECT_INSTANCE_ID, contactId);
      if (!stored) {
        console.log(`voicemail skipped contact=${contactId} reason=no-caller-attribute`);
        continue;
      }
      // Belt and braces: a caller attribute that is somehow a real number is masked here too.
      const callerNumber = isMasked(stored) ? stored : maskPhone(stored, env.AFTERBEEP_WEBHOOK_SECRET);

      const heard = (await deps.transcribe(bucket, key, contactId)).trim();
      const transcript = heard ? maskTranscript(heard, env.AFTERBEEP_WEBHOOK_SECRET).slice(0, 4000) : SILENCE;

      let extraction: VoicemailExtraction | undefined;
      if (transcript !== SILENCE) {
        const res = await deps.fetch(`${base}/api/business`, { headers: auth });
        if (res.ok) {
          const { business } = (await res.json()) as { business: Omit<Business, 'remoteCode'> };
          extraction = await deps.extract(transcript, callerNumber, { ...business, remoteCode: '' }, env);
        }
      }

      const res = await deps.fetch(`${base}/api/hooks/connect-voicemail`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...auth },
        body: JSON.stringify({ contactId, callerNumber, recordingUri: `s3://${bucket}/${key}`, transcript, extraction }),
      });
      // A failure throws, so Lambda retries and then parks the event on the dead-letter queue.
      if (!res.ok && res.status !== 409) throw new Error(`AfterBeep webhook returned ${res.status}`);
      console.log(`voicemail filed contact=${contactId} status=${res.status} extractor=${extraction?.source ?? 'server'}`);
      filed.push({ contactId, status: res.status, extractor: extraction?.source });
    }
    return filed;
  };
}

// ---------------------------------------------------------------- the real AWS calls

const connect = new ConnectClient({});
const s3 = new S3Client({});
const transcribeClient = new TranscribeClient({});

async function callerFor(instanceId: string, contactId: string): Promise<string | undefined> {
  const { Attributes = {} } = await connect.send(new GetContactAttributesCommand({ InstanceId: instanceId, InitialContactId: contactId }));
  return Attributes.afterbeepCaller;
}

async function transcribe(bucket: string, key: string, contactId: string): Promise<string> {
  const jobName = `afterbeep-${contactId}`;
  try {
    await transcribeClient.send(
      new StartTranscriptionJobCommand({
        TranscriptionJobName: jobName,
        Media: { MediaFileUri: `s3://${bucket}/${key}` },
        IdentifyLanguage: true,
        LanguageOptions: ['en-US', 'es-US'],
        OutputBucketName: bucket,
        OutputKey: `transcripts/${contactId}.json`,
      }),
    );
  } catch (error) {
    // A retried event finds the job already started; carry on and read it.
    if (!(error instanceof ConflictException)) throw error;
  }
  const deadline = Date.now() + 100_000;
  while (Date.now() < deadline) {
    const { TranscriptionJob: job } = await transcribeClient.send(new GetTranscriptionJobCommand({ TranscriptionJobName: jobName }));
    if (job?.TranscriptionJobStatus === 'FAILED') {
      console.log(`voicemail transcription failed contact=${contactId}`);
      return '';
    }
    if (job?.TranscriptionJobStatus === 'COMPLETED') {
      const obj = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: `transcripts/${contactId}.json` }));
      const body = JSON.parse(await obj.Body!.transformToString()) as { results?: { transcripts?: Array<{ transcript?: string }> } };
      return body.results?.transcripts?.map((t) => t.transcript ?? '').join(' ') ?? '';
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error('Transcription timed out');
}

async function extract(transcript: string, callerId: string, business: Business, env: VoicemailEnv): Promise<VoicemailExtraction> {
  const extractor = new BedrockExtractor({
    region: env.AWS_REGION,
    modelId: env.BEDROCK_MODEL_ID,
    maxTokens: env.BEDROCK_MAX_TOKENS,
    maxInputChars: env.BEDROCK_MAX_INPUT_CHARS,
    onUsage: ({ inputTokens, outputTokens }) => console.log(`bedrock usage model=${env.BEDROCK_MODEL_ID} in=${inputTokens} out=${outputTokens}`),
    log: (line) => console.log(line),
  });
  return extractor.extract(transcript, { callerId, business });
}

export const handler = createVoicemailHandler({
  env: process.env,
  callerFor,
  transcribe,
  extract,
  fetch: (input, init) => globalThis.fetch(input, init),
});
