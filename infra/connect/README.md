# Real phone path: Amazon Connect

The demo runs on the call simulator. This folder holds the pieces that put AfterBeep behind a real phone number. They are written for review and have not been deployed.

```
Caller -> owner's number (no answer, forwards) -> Amazon Connect number
  contact flow: save caller number -> record customer audio -> greeting -> listen up to 2 min -> hang up
  recording lands in S3 -> recording-to-webhook.mjs (Lambda)
  -> POST /api/hooks/connect-voicemail { contactId, callerNumber, recordingUri: s3://... }  (Bearer secret)
  -> AfterBeep: Amazon Transcribe -> Bedrock extraction -> End User Messaging SMS with the booking link
```

## Deploy with SAM
[`../template.yaml`](../template.yaml) creates the recordings bucket (encrypted, private, TLS only, recordings expire after 30 days), points the Connect instance's call recordings at it, deploys the Lambda below with an S3 trigger and a dead-letter queue for hand-offs that fail after retries, and creates the IAM policy the AfterBeep server needs for Transcribe, Bedrock, SMS and the bucket.

```bash
sam validate --lint -t infra/template.yaml        # offline; also runs in CI
sam deploy --guided -t infra/template.yaml        # asks for the Connect instance ARN, server URL and webhook secret
```

Then import `contact-flow.json` in the Connect flow designer, point the number at it, and attach the `ServerPolicyArn` output to the server's role.

## Files
- `contact-flow.json`: the voicemail flow in Amazon Connect flow language. Import it in the flow designer, then point the number at it.
- `remote-retrieval-flow.json`: the remote retrieval flow, described below.
- `recording-to-webhook.mjs`: Lambda for S3 `ObjectCreated` events on the call-recordings prefix. It reads the caller number that the flow stored as a contact attribute and posts the recording location to AfterBeep.
- `inbound-text-to-webhook.mjs`: Lambda for replies. Turn on two-way SMS for the origination number with an SNS topic as the destination, subscribe this Lambda, and it posts each reply to `POST /api/hooks/inbound-text`, where STOP, HELP and START are handled. It is not in `template.yaml` yet; the topic and subscription are made by hand.

## Remote retrieval flow
The owner calls their own number from the truck, keys the 3-digit remote code and hears the new messages with the keypad: 1 plays, 2 texts the caller the booking link, 9 9 erases, `#` moves on. After the last message the owner says an invoice, which becomes a draft that still needs approval of the exact total. The call script is the pure function in `src/domain/remote-retrieval.ts`; the browser keypad at `/machine/remote` is one driver and this flow is the other.

`remote-retrieval-flow.json` only collects keys and speaks what a Lambda returns. The code input stores up to three digits (`GetParticipantInput`, `StoreInput: "True"`). The menu reads 1, 2, 9 and `#` with one `Equals` condition each. Every key and every timeout goes to an `InvokeLambdaFunction` turn, and a `Compare` action routes on the `next` answer (`menu`, `invoice` or `goodbye`). The flow holds no code and no message data. The `REPLACE_WITH_REMOTE_TURN_LAMBDA_ARN` placeholder stands for a Lambda that keeps the call state between turns and calls `/api/remote/*` with the webhook secret. That Lambda is not written.

Two ways to reach it, not decided yet:
- A second Connect number that starts this flow.
- The owner presses a key during the greeting on the voicemail number, and the voicemail flow transfers to this one.

This flow is written and checked but not deployed. `tests/unit/connect-remote-flow.test.ts` parses the file; nothing has been imported into a Connect instance or called on a real phone.

## Server settings for this path
```
AFTERBEEP_TRANSCRIBER=aws
AFTERBEEP_EXTRACTOR=bedrock
AFTERBEEP_SMS=aws
AFTERBEEP_SMS_ORIGINATION=<registered 10DLC or toll-free number>
AFTERBEEP_WEBHOOK_SECRET=<long random string, also given to the Lambda>
```

The Transcribe role needs read access to the recordings bucket. US SMS needs a registered origination number before carriers deliver it.
