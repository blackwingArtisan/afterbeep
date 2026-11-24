# Real phone path: Amazon Connect

The web demo runs on the call simulator. This folder holds the pieces that put AfterBeep behind a real phone number, and they are deployed as the public demo line.

```
Caller -> demo line (Amazon Connect, US DID)
  voicemail flow: call gate Lambda (call caps, caller number masked, start time stamped)
    -> owner's own number, or * during the greeting -> remote retrieval flow
    -> greeting -> record up to 60 s -> stop recording -> goodbye
  recording lands in S3 -> voicemail Lambda
    -> Amazon Transcribe (English or Spanish) -> every spoken number masked
    -> Amazon Bedrock extraction (token-capped; rules if it fails)
    -> POST /api/hooks/connect-voicemail { contactId, callerNumber, recordingUri, transcript, extraction }  (Bearer secret)
  -> AfterBeep files the message and texts the caller the booking link
```

On the demo line the AfterBeep server is the public web demo, so the text back lands in its Outbox instead of on a phone (US texting from a local number needs 10DLC registration first).

## Deploy
`scripts/deploy-phone.ts` does the whole path and is safe to run again: it finds or creates the Connect instance, bundles the three Lambdas with esbuild, deploys [`../template.yaml`](../template.yaml) as the `afterbeep-phone` stack, creates or updates both flows from the JSON files here (filling the placeholders), claims one US DID number if the instance has none, and points it at the voicemail flow.

```bash
sam validate --lint -t infra/template.yaml        # offline; also runs in CI
AWS_PROFILE=<deploy profile> AFTERBEEP_WEBHOOK_SECRET=<32+ chars> OWNER_NUMBER=<owner's E.164 number> \
  RECORDING_RETENTION_DAYS=1 npx tsx scripts/deploy-phone.ts
```

Set the same `AFTERBEEP_WEBHOOK_SECRET` on the AfterBeep server (for the web demo: `wrangler pages secret put AFTERBEEP_WEBHOOK_SECRET`). The template creates the recordings bucket (encrypted, private, TLS only; recordings and transcripts expire after `RecordingRetentionDays`), points the instance's call recordings at it, deploys the three Lambdas with a dead-letter queue for hand-offs that fail after retries, lets the instance invoke the two flow Lambdas, and creates the IAM policy an AfterBeep server on AWS would need for Transcribe, Bedrock, SMS and the bucket.

## Caps
The demo line is public, so every cost has a ceiling:

| Cap | Where | Default |
|---|---|---|
| Calls per UTC day | call gate (`DailyCallCap`) | 6 |
| Calls per UTC month | call gate (`MonthlyCallCap`) | 30 |
| Voicemail length | `listen` in the voicemail flow | 60 seconds |
| Remote call length | turn Lambda (`MaxCallSeconds`, from the gate's start stamp) | 240 seconds |
| Bedrock output | voicemail Lambda (`BedrockMaxTokens`) | 300 tokens a call |
| Bedrock input | voicemail Lambda (`BedrockMaxInputChars`) | 2,000 characters a call |

The gate counts admitted calls as empty marker objects under `caps/` in the recordings bucket and fails closed: if it cannot read the count, the call hears a short goodbye and is not recorded. A call over the cap hears the same goodbye. Bedrock runs only for admitted calls that had speech, so the call caps bound it too.

## Caller privacy
- The call gate swaps the caller's number for one of the 100 fictional numbers (555) 555-0100 to 0199, using a keyed hash, so the same caller always gets the same stand-in and nobody can reverse it. The flow stores only the stand-in as a contact attribute.
- The voicemail Lambda masks every phone number in the transcript (digits or spoken words) the same way before Bedrock or the server sees it, and masks the caller attribute again if it were ever a real number.
- Nothing logs a number or words from a message. Recordings and transcripts expire from S3 after a day on the demo line.

## Files
- `contact-flow.json`: the voicemail flow in Amazon Connect flow language.
- `remote-retrieval-flow.json`: the remote retrieval flow, described below.
- `call-gate.ts`: the first action of the voicemail flow (caps, masking, start stamp).
- `caller-mask.ts`: the stand-in numbers.
- `voicemail-to-webhook.ts`: Lambda for S3 `ObjectCreated` events on the recordings prefix: Transcribe, masking, Bedrock, then the webhook.
- `remote-turn.ts`: the turn Lambda for the remote retrieval flow.
- `inbound-text-to-webhook.mjs`: Lambda for replies. Turn on two-way SMS for the origination number with an SNS topic as the destination, subscribe this Lambda, and it posts each reply to `POST /api/hooks/inbound-text`, where STOP, HELP and START are handled. It is not deployed: the demo line sends no real texts.

## Remote retrieval flow
The owner calls their own number from the truck, keys the 3-digit remote code and hears the new messages with the keypad: 1 plays, 2 texts the caller the booking link, 9 9 erases, `#` moves on. After the last message the browser keypad takes a spoken invoice, which becomes a draft that still needs approval of the exact total; on a phone the call says invoices by phone are not ready yet and ends. The call script is the pure function in `src/domain/remote-retrieval.ts`; the browser keypad at `/machine/remote` is one driver and this flow is the other.

`remote-retrieval-flow.json` only collects keys and speaks what the turn Lambda returns. The code input stores up to three digits (`GetParticipantInput`, `StoreInput: "True"`); a timeout there takes the success branch with no digits, which the Lambda reads as silence, because Connect refuses a timeout branch on a stored input. The menu reads 1, 2, 9, `#` and `*` with one `Equals` condition each. Every key and every timeout goes to an `InvokeLambdaFunction` turn, and each turn goes to `save-state`, an `UpdateContactAttributes` action that stores `$.External.state` as the contact attribute `remoteState`. A `Compare` action then routes on the `next` answer: `code` asks for the code again, `menu` reads the next key, `invoice` and `goodbye` end the call. The flow holds no code and no message data.

## Decision: how the owner gets in
The owner reaches the remote menu by calling the business number from the owner's own phone, and the voicemail flow recognises the owner by caller ID. The owner then enters the 3-digit code. There is no second number. Like the remote feature on an old answering machine, anyone can also press `*` during the greeting to reach the code prompt, which is how the public tries the menu on the demo line.

- `check-owner` is a `Compare` of `$.CustomerEndpoint.Address` with `REPLACE_WITH_OWNER_NUMBER`. On a match, `to-remote` (`TransferToFlow`) hands the call to the remote flow. Any other caller, a withheld number, a failed compare or a failed transfer carries on at `save-caller`.
- Caller ID only routes the call. It can be faked, so the 3-digit code stays the only gate, with the lockout after five wrong codes. Neither the Lambda nor the server uses caller ID to accept or skip the code.
- A transferred call is not recorded and is not posted to the voicemail webhook: recording starts only after the greeting.
- The remote flow must be an inbound flow, because the Transfer to flow action is available only in inbound and transfer flows. A transfer action also needs a next action, which runs only if the transfer does not happen.
- Flow logging stays off on the instance. Logs would otherwise record the keyed digits and the attributes.

## Placeholders the deploy fills in
- `REPLACE_WITH_CALL_GATE_LAMBDA_ARN` in `contact-flow.json`: the call gate Lambda.
- `REPLACE_WITH_OWNER_NUMBER` in `contact-flow.json`: the owner's number in the form Connect reports as the caller, from `OWNER_NUMBER`. Without it no caller matches and `*` is the only way in.
- `REPLACE_WITH_REMOTE_FLOW_ID` in `contact-flow.json`: the remote flow's ARN.
- `REPLACE_WITH_REMOTE_TURN_LAMBDA_ARN` in `remote-retrieval-flow.json`: the turn Lambda.

No phone number, ARN or secret is stored in this repository. The Lambdas read their settings from the environment the stack sets.

## Status
Deployed as the AfterBeep demo line: the `afterbeep-phone` stack (call gate, voicemail Lambda, turn Lambda, recordings bucket, dead-letter queue), both flows, and one claimed US DID number pointed at the voicemail flow. What has run on a real phone is recorded in the main README.

## Server settings for an AfterBeep server on AWS
```
AFTERBEEP_TRANSCRIBER=aws
AFTERBEEP_EXTRACTOR=bedrock
AFTERBEEP_SMS=aws
AFTERBEEP_SMS_ORIGINATION=<registered 10DLC or toll-free number>
AFTERBEEP_WEBHOOK_SECRET=<long random string, also given to the Lambdas>
```

US SMS needs a registered origination number before carriers deliver it.
