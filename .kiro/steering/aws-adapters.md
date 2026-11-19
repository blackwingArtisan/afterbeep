---
inclusion: fileMatch
fileMatchPattern: "src/adapters/**"
---
# AWS and outside-service adapters

## Shape
- Each port (`transcriber`, `extractor`, `sms`, `invoices`, `store`) has `types.ts`, a free `local` implementation and, where it applies, a real one (`aws.ts`, `bedrock.ts`, `stripe.ts`).
- Real implementations are loaded with dynamic `import()` from `src/adapters/index.ts`, selected only by environment variable, and never called by tests. Tests stub the SDK client instead.
- Validate every response from an outside service with zod before it reaches a service.

## Amazon services used
- **Amazon Connect** answers the call, plays the greeting and records after the beep (`infra/connect/contact-flow.json`); a Lambda posts the finished recording to `/api/hooks/connect-voicemail` with a shared secret.
- **Amazon Transcribe** turns the recording into text.
- **Amazon Bedrock** (Converse API with a forced tool) reads the transcript into the extraction schema. Any phone number or address the caller never said is dropped, and any failure falls back to the rules extractor.
- **AWS End User Messaging SMS** sends the text-back. A refused text is filed with its reason and can be retried.

## Rules
- Never put keys in the repo; read them from the environment. `.env.example` lists every setting.
- Stripe runs in test mode only; a live key stops the adapter from starting.
- Check current API shapes and quotas against the AWS documentation (the `aws-docs` MCP server in `.kiro/settings/mcp.json`) before changing a real adapter.
