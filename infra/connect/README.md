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
- `recording-to-webhook.mjs`: Lambda for S3 `ObjectCreated` events on the call-recordings prefix. It reads the caller number that the flow stored as a contact attribute and posts the recording location to AfterBeep.
- `inbound-text-to-webhook.mjs`: Lambda for replies. Turn on two-way SMS for the origination number with an SNS topic as the destination, subscribe this Lambda, and it posts each reply to `POST /api/hooks/inbound-text`, where STOP, HELP and START are handled. It is not in `template.yaml` yet; the topic and subscription are made by hand.

## Server settings for this path
```
AFTERBEEP_TRANSCRIBER=aws
AFTERBEEP_EXTRACTOR=bedrock
AFTERBEEP_SMS=aws
AFTERBEEP_SMS_ORIGINATION=<registered 10DLC or toll-free number>
AFTERBEEP_WEBHOOK_SECRET=<long random string, also given to the Lambda>
```

The Transcribe role needs read access to the recordings bucket. US SMS needs a registered origination number before carriers deliver it.
