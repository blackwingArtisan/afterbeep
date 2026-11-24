/**
 * The call gate: the first action of the voicemail flow invokes it once per call.
 *
 * It enforces the demo line's call caps (calls per UTC day and per UTC month), swaps the caller's
 * number for a stand-in before the flow stores anything, and stamps the call's start time so the
 * turn Lambda can end a remote call that runs too long. Each admitted call leaves one empty marker
 * object in S3 under caps/<month>/<day>/<contactId>; the bucket expires them.
 *
 * It fails closed: if the count cannot be read, the call is turned away rather than let through.
 * It never logs the caller's number.
 */
import { ListObjectsV2Command, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { z } from 'zod';
import { maskPhone } from './caller-mask';

export const GateEventSchema = z.object({
  Details: z.object({
    ContactData: z.object({ ContactId: z.string().min(1).max(256) }),
    Parameters: z.object({ caller: z.string().max(64).optional() }).optional(),
  }),
});

const EnvSchema = z.object({
  CAPS_BUCKET: z.string().min(3),
  DAILY_CALL_CAP: z.coerce.number().int().min(0).max(1000),
  MONTHLY_CALL_CAP: z.coerce.number().int().min(0).max(10000),
  AFTERBEEP_WEBHOOK_SECRET: z.string().min(1),
});

export interface GateAnswer {
  /** "yes" lets the call in; "no" sends it to the over-cap goodbye. */
  allowed: 'yes' | 'no';
  /** The caller's stand-in number, stored by the flow as the afterbeepCaller attribute. */
  maskedCaller: string;
  /** When the call started, in whole seconds since the epoch, stored as afterbeepStart. */
  startedAt: string;
}

/** The slice of S3 the gate uses, so tests can fake it. */
export interface CapStore {
  /** Keys under a prefix, up to 1,000, which is above every cap. */
  list(prefix: string): Promise<string[]>;
  put(key: string): Promise<void>;
}

export interface GateDeps {
  store: CapStore;
  env: Record<string, string | undefined>;
  clock: () => Date;
}

export function capKeys(now: Date, contactId: string) {
  const day = now.toISOString().slice(0, 10);
  const month = day.slice(0, 7);
  return { monthPrefix: `caps/${month}/`, dayPrefix: `caps/${month}/${day}/`, marker: `caps/${month}/${day}/${contactId}` };
}

export function createGate(deps: GateDeps): (event: unknown) => Promise<GateAnswer> {
  return async (rawEvent) => {
    const now = deps.clock();
    const startedAt = String(Math.floor(now.getTime() / 1000));
    const env = EnvSchema.safeParse(deps.env);
    const parsed = GateEventSchema.safeParse(rawEvent);
    const salt = env.success ? env.data.AFTERBEEP_WEBHOOK_SECRET : 'unconfigured';
    const maskedCaller = maskPhone(parsed.success ? parsed.data.Details.Parameters?.caller : undefined, salt);
    if (!env.success || !parsed.success) {
      console.error(`call-gate refused kind=${env.success ? 'bad-event' : 'config'}`);
      return { allowed: 'no', maskedCaller, startedAt };
    }

    const contactId = parsed.data.Details.ContactData.ContactId;
    const keys = capKeys(now, contactId);
    try {
      const month = await deps.store.list(keys.monthPrefix);
      // A transferred or retried invocation for the same contact is already counted.
      if (month.includes(keys.marker)) return { allowed: 'yes', maskedCaller, startedAt };
      const today = month.filter((k) => k.startsWith(keys.dayPrefix)).length;
      if (today >= env.data.DAILY_CALL_CAP || month.length >= env.data.MONTHLY_CALL_CAP) {
        console.log(`call-gate over-cap today=${today} month=${month.length}`);
        return { allowed: 'no', maskedCaller, startedAt };
      }
      await deps.store.put(keys.marker);
      console.log(`call-gate admitted today=${today + 1} month=${month.length + 1}`);
      return { allowed: 'yes', maskedCaller, startedAt };
    } catch (error) {
      console.error(`call-gate refused kind=store error=${error instanceof Error ? error.name : 'unknown'}`);
      return { allowed: 'no', maskedCaller, startedAt };
    }
  };
}

export function s3CapStore(bucket: string, client = new S3Client({})): CapStore {
  return {
    async list(prefix) {
      const res = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, MaxKeys: 1000 }));
      return (res.Contents ?? []).map((o) => o.Key ?? '').filter(Boolean);
    },
    async put(key) {
      await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: '' }));
    },
  };
}

export const handler = createGate({
  store: s3CapStore(process.env.CAPS_BUCKET ?? ''),
  env: process.env,
  clock: () => new Date(),
});
