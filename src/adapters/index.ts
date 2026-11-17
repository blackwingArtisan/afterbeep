import type { Extractor } from './extractor/types';
import type { InvoiceProvider } from './invoices/types';
import type { SmsSender } from './sms/types';
import type { Store } from './store/types';
import type { Transcriber } from './transcriber/types';
import { RuleExtractor } from './extractor/local';
import { LocalInvoiceProvider } from './invoices/local';
import { OutboxSms } from './sms/local';
import { PassThroughTranscriber } from './transcriber/local';

export interface Adapters {
  transcriber: Transcriber;
  extractor: Extractor;
  sms: SmsSender;
  invoices: InvoiceProvider;
}

export interface AdapterContext {
  store: Store;
  clock: () => Date;
  newId: () => string;
  publicBaseUrl: string;
}

type Env = Record<string, string | undefined>;

function required(env: Env, key: string): string {
  const value = env[key];
  if (!value) throw new Error(`${key} must be set for the selected adapter`);
  return value;
}

/**
 * Picks an implementation for each port from env vars. Local implementations are the default; real
 * ones are imported lazily so the AWS and Stripe SDKs never load unless selected.
 */
export async function adaptersFromEnv(env: Env, ctx: AdapterContext): Promise<Adapters> {
  const region = env.AWS_REGION ?? 'us-east-1';

  let transcriber: Transcriber = new PassThroughTranscriber();
  if (env.AFTERBEEP_TRANSCRIBER === 'aws') {
    const { AwsTranscriber } = await import('./transcriber/aws');
    transcriber = new AwsTranscriber({ region, newJobName: () => `afterbeep-${ctx.newId()}` });
  }

  let extractor: Extractor = new RuleExtractor();
  if (env.AFTERBEEP_EXTRACTOR === 'bedrock') {
    const { BedrockExtractor } = await import('./extractor/bedrock');
    extractor = new BedrockExtractor({ region, modelId: env.AFTERBEEP_BEDROCK_MODEL ?? 'amazon.nova-lite-v1:0' });
  }

  let sms: SmsSender = new OutboxSms(ctx.store, ctx.clock, ctx.newId);
  if (env.AFTERBEEP_SMS === 'aws') {
    const { AwsSms } = await import('./sms/aws');
    sms = new AwsSms({
      region,
      originationIdentity: required(env, 'AFTERBEEP_SMS_ORIGINATION'),
      configurationSetName: env.AFTERBEEP_SMS_CONFIGURATION_SET,
    });
  }

  let invoices: InvoiceProvider = new LocalInvoiceProvider(ctx.store, ctx.clock, ctx.newId, ctx.publicBaseUrl);
  if (env.AFTERBEEP_INVOICES === 'stripe') {
    const { StripeInvoiceProvider } = await import('./invoices/stripe');
    invoices = new StripeInvoiceProvider({ secretKey: required(env, 'STRIPE_SECRET_KEY') });
  }

  return { transcriber, extractor, sms, invoices };
}

export function localAdapters(ctx: AdapterContext): Adapters {
  return {
    transcriber: new PassThroughTranscriber(),
    extractor: new RuleExtractor(),
    sms: new OutboxSms(ctx.store, ctx.clock, ctx.newId),
    invoices: new LocalInvoiceProvider(ctx.store, ctx.clock, ctx.newId, ctx.publicBaseUrl),
  };
}
