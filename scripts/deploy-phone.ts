/**
 * Deploys the real phone path to AWS, end to end, and is safe to run again:
 *
 *   1. finds (or creates) the Amazon Connect instance by alias
 *   2. bundles the three Lambdas (call gate, voicemail, remote turn) with esbuild
 *   3. deploys infra/template.yaml as the afterbeep-phone stack
 *   4. creates or updates both contact flows from infra/connect/*.json, filling the placeholders
 *   5. claims one US DID number (only if the instance has none) and points it at the voicemail flow
 *
 * Settings come from the environment, never from this repository:
 *   AFTERBEEP_WEBHOOK_SECRET  shared secret, also set on the AfterBeep server (required)
 *   AFTERBEEP_URL             server base URL (default https://afterbeep.pages.dev)
 *   OWNER_NUMBER              owner's phone in E.164; their calls go straight to the remote menu (optional)
 *   CONNECT_ALIAS             instance alias (default afterbeep-demo)
 *   STACK_NAME                stack name (default afterbeep-phone)
 *   DAILY_CALL_CAP, MONTHLY_CALL_CAP, MAX_CALL_SECONDS, RECORDING_RETENTION_DAYS  caps (template defaults)
 *
 * Usage: AWS_PROFILE=<deploy profile> AFTERBEEP_WEBHOOK_SECRET=... npx tsx scripts/deploy-phone.ts
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const FLOW_NAMES = { remote: 'AfterBeep remote retrieval', voicemail: 'AfterBeep voicemail' } as const;
/** Compared with caller ID when no owner number is set; no caller ID can equal it. */
export const NO_OWNER = 'no-owner-number-set';

/** Fills every placeholder in a flow and refuses to return a flow that still has one. */
export function fillFlow(raw: string, values: Record<string, string>): string {
  let out = raw;
  for (const [name, value] of Object.entries(values)) out = out.split(name).join(value);
  const left = out.match(/REPLACE_WITH_[A-Z_]+/);
  if (left) throw new Error(`Flow placeholder ${left[0]} has no value`);
  JSON.parse(out);
  return out;
}

const region = process.env.AWS_REGION ?? 'us-east-1';

function aws<T = any>(args: string[], input?: string): T {
  const out = execFileSync('aws', [...args, '--region', region, '--output', 'json', '--cli-error-format', 'json'], {
    encoding: 'utf8',
    input,
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  return (out.trim() ? JSON.parse(out) : {}) as T;
}

function step(text: string): void {
  console.log(`\n== ${text}`);
}

function bundle(): void {
  const entries = { 'call-gate': 'infra/connect/call-gate.ts', voicemail: 'infra/connect/voicemail-to-webhook.ts', 'remote-turn': 'infra/connect/remote-turn.ts' };
  for (const [name, entry] of Object.entries(entries)) {
    execFileSync(
      'npx',
      ['esbuild', entry, '--bundle', '--platform=node', '--target=node22', '--format=esm', '--external:@aws-sdk/*', `--outfile=dist/lambda/${name}/index.mjs`, '--log-level=warning'],
      { stdio: 'inherit' },
    );
  }
}

function findInstance(alias: string): { Id: string; Arn: string } {
  const { InstanceSummaryList = [] } = aws<{ InstanceSummaryList: { Id: string; Arn: string; InstanceAlias: string }[] }>(['connect', 'list-instances']);
  const found = InstanceSummaryList.find((i) => i.InstanceAlias === alias);
  if (found) return found;
  return aws(['connect', 'create-instance', '--identity-management-type', 'CONNECT_MANAGED', '--instance-alias', alias, '--inbound-calls-enabled', '--outbound-calls-enabled']);
}

/** Creates or updates a flow by name and answers its ARN, which a transfer action needs. */
function upsertFlow(instanceId: string, name: string, content: string, description: string): string {
  const { ContactFlowSummaryList = [] } = aws<{ ContactFlowSummaryList: { Id: string; Arn: string; Name: string }[] }>([
    'connect', 'list-contact-flows', '--instance-id', instanceId, '--contact-flow-types', 'CONTACT_FLOW',
  ]);
  const existing = ContactFlowSummaryList.find((f) => f.Name === name);
  if (existing) {
    aws(['connect', 'update-contact-flow-content', '--instance-id', instanceId, '--contact-flow-id', existing.Id, '--content', content]);
    return existing.Arn;
  }
  const created = aws<{ ContactFlowArn: string }>([
    'connect', 'create-contact-flow', '--instance-id', instanceId, '--name', name, '--type', 'CONTACT_FLOW', '--description', description, '--content', content,
  ]);
  return created.ContactFlowArn;
}

function phoneNumber(instanceArn: string): { id: string; number: string } {
  const listed = aws<{ ListPhoneNumbersSummaryList: { PhoneNumberId: string; PhoneNumber: string; PhoneNumberType: string }[] }>([
    'connect', 'list-phone-numbers-v2', '--target-arn', instanceArn,
  ]).ListPhoneNumbersSummaryList ?? [];
  const did = listed.find((n) => n.PhoneNumberType === 'DID');
  if (did) return { id: did.PhoneNumberId, number: did.PhoneNumber };

  const { AvailableNumbersList = [] } = aws<{ AvailableNumbersList: { PhoneNumber: string }[] }>([
    'connect', 'search-available-phone-numbers', '--target-arn', instanceArn, '--phone-number-country-code', 'US', '--phone-number-type', 'DID', '--max-results', '5',
  ]);
  // A listed number can be taken by someone else before the claim lands, so try each in turn.
  let claimed: { PhoneNumberId: string } | undefined;
  let pick: { PhoneNumber: string } | undefined;
  for (const candidate of AvailableNumbersList) {
    try {
      claimed = aws<{ PhoneNumberId: string }>([
        'connect', 'claim-phone-number', '--target-arn', instanceArn, '--phone-number', candidate.PhoneNumber, '--phone-number-description', 'AfterBeep demo line',
      ]);
      pick = candidate;
      break;
    } catch {
      console.log(`${candidate.PhoneNumber} was not available; trying the next`);
    }
  }
  if (!claimed || !pick) throw new Error('No listed US DID number could be claimed');
  for (let i = 0; i < 30; i++) {
    const status = aws<{ ClaimedPhoneNumberSummary: { PhoneNumberStatus: { Status: string } } }>([
      'connect', 'describe-phone-number', '--phone-number-id', claimed.PhoneNumberId,
    ]).ClaimedPhoneNumberSummary.PhoneNumberStatus.Status;
    if (status === 'CLAIMED') break;
    if (status === 'FAILED') throw new Error('Claiming the number failed');
    execFileSync('sleep', ['2']);
  }
  return { id: claimed.PhoneNumberId, number: pick.PhoneNumber };
}

function main(): void {
  const secret = process.env.AFTERBEEP_WEBHOOK_SECRET;
  if (!secret || secret.length < 32) throw new Error('Set AFTERBEEP_WEBHOOK_SECRET (32 characters or more)');
  const url = (process.env.AFTERBEEP_URL ?? 'https://afterbeep.pages.dev').replace(/\/+$/, '');
  const stack = process.env.STACK_NAME ?? 'afterbeep-phone';
  const owner = process.env.OWNER_NUMBER?.trim() || NO_OWNER;
  const account = aws<{ Account: string }>(['sts', 'get-caller-identity']).Account;

  step('Connect instance');
  const instance = findInstance(process.env.CONNECT_ALIAS ?? 'afterbeep-demo');
  console.log(`instance ${instance.Id}`);

  step('Bundle the Lambdas');
  bundle();

  step(`Deploy the ${stack} stack`);
  const artifacts = `${stack}-artifacts-${account}`;
  try {
    aws(['s3api', 'head-bucket', '--bucket', artifacts]);
  } catch {
    aws(['s3api', 'create-bucket', '--bucket', artifacts]);
    aws(['s3api', 'put-public-access-block', '--bucket', artifacts, '--public-access-block-configuration', 'BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true']);
  }
  execFileSync('aws', ['cloudformation', 'package', '--region', region, '--template-file', 'infra/template.yaml', '--s3-bucket', artifacts, '--output-template-file', 'dist/lambda/packaged.yaml'], { stdio: ['ignore', 'ignore', 'inherit'] });
  const overrides = [
    `ConnectInstanceArn=${instance.Arn}`,
    `AfterBeepUrl=${url}`,
    `WebhookSecret=${secret}`,
    ...(['DAILY_CALL_CAP:DailyCallCap', 'MONTHLY_CALL_CAP:MonthlyCallCap', 'MAX_CALL_SECONDS:MaxCallSeconds', 'RECORDING_RETENTION_DAYS:RecordingRetentionDays']
      .map((pair) => pair.split(':') as [string, string])
      .filter(([env]) => process.env[env])
      .map(([env, param]) => `${param}=${process.env[env]}`)),
  ];
  execFileSync(
    'aws',
    ['cloudformation', 'deploy', '--region', region, '--template-file', 'dist/lambda/packaged.yaml', '--stack-name', stack, '--capabilities', 'CAPABILITY_IAM', 'CAPABILITY_AUTO_EXPAND', '--no-fail-on-empty-changeset', '--parameter-overrides', ...overrides],
    { stdio: ['ignore', 'inherit', 'inherit'] },
  );
  const outputs = Object.fromEntries(
    (aws<{ Stacks: { Outputs: { OutputKey: string; OutputValue: string }[] }[] }>(['cloudformation', 'describe-stacks', '--stack-name', stack]).Stacks[0]?.Outputs ?? []).map((o) => [o.OutputKey, o.OutputValue]),
  );

  step('Contact flows');
  const remoteArn = upsertFlow(
    instance.Id,
    FLOW_NAMES.remote,
    fillFlow(readFileSync('infra/connect/remote-retrieval-flow.json', 'utf8'), { REPLACE_WITH_REMOTE_TURN_LAMBDA_ARN: outputs.RemoteTurnFunctionArn! }),
    'Owner keys the remote code and hears messages with the keypad.',
  );
  const voicemailArn = upsertFlow(
    instance.Id,
    FLOW_NAMES.voicemail,
    fillFlow(readFileSync('infra/connect/contact-flow.json', 'utf8'), {
      REPLACE_WITH_CALL_GATE_LAMBDA_ARN: outputs.CallGateFunctionArn!,
      REPLACE_WITH_REMOTE_FLOW_ID: remoteArn,
      REPLACE_WITH_OWNER_NUMBER: owner,
    }),
    'Demo line: call gate, greeting, recorded message; the owner goes to the remote menu.',
  );
  const voicemailId = voicemailArn.split('/').pop()!;
  console.log(`remote flow ${remoteArn.split('/').pop()}\nvoicemail flow ${voicemailId}`);

  step('Phone number');
  const number = phoneNumber(instance.Arn);
  aws(['connect', 'associate-phone-number-contact-flow', '--phone-number-id', number.id, '--instance-id', instance.Id, '--contact-flow-id', voicemailId]);
  console.log(`demo line ${number.number} -> ${FLOW_NAMES.voicemail}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
