# Design: Missed-call booking

## Overview
A single Node process (Hono) serves the API and the React client. The voicemail pipeline is one service function, `receiveVoicemail`, that depends only on ports (transcriber, extractor, SMS sender, store) passed in. The local call simulator and the Amazon Connect webhook both call it, so the demo path and the production path share all business logic.

```
Phone (Amazon Connect) --recording in S3--> Lambda --POST /api/hooks/connect-voicemail--+
Browser call simulator --------------------------- POST /api/calls --------------------+
                                                                                        v
                         receiveVoicemail: Transcriber -> Extractor -> Store -> openSlots -> SmsSender
                                                                                        |
Caller's phone <---------------- text with /book/:token <-------------------------------+
Caller -> GET /api/book/:token -> POST /api/book/:token -> Job on schedule -> confirmation text
```

## Components
| Component | File | Responsibility |
|---|---|---|
| Rule extractor | `src/domain/voicemail-rules.ts` | Name, number, address, job, urgency from text |
| Spoken numbers | `src/domain/spoken-numbers.ts` | "six one four five five five..." to digits |
| Slot finder | `src/domain/slots.ts` | Open slots in the business time zone |
| Pipeline | `src/server/services/voicemail.ts` | Transcribe, extract, file, text back |
| Booking | `src/server/services/booking.ts` | Booking view, slot validation, job creation |
| Adapters | `src/adapters/*` | Ports with local and AWS implementations |
| Inbox | `src/client/pages/Inbox.tsx` | Cassette inbox and playback |
| Simulator | `src/client/pages/CallSimulator.tsx` | Ring, greeting, beep, record, submit |
| Booking page | `src/client/pages/Booking.tsx` | Caller-facing slot picker |

## Data models
```ts
type Urgency = 'emergency' | 'soon' | 'routine';

interface VoicemailExtraction {
  callerName: string | null;
  callbackNumber: string | null; // "(614) 555-0134"
  address: string | null;
  job: string;                   // "Water heater: burst, flooding"
  jobCategory: JobCategory;
  urgency: Urgency;
  summary: string;
  source: 'rules' | 'bedrock';
}

interface Message {
  id: string;
  receivedAt: string;            // ISO UTC
  from: string;                  // E.164 caller ID
  durationSec: number;
  transcript: string;
  extraction: VoicemailExtraction;
  status: 'new' | 'heard' | 'called-back';
  bookingToken: string;          // 72 random bits, base64url
  textedAt: string | null;
  noTextReason: string | null;   // why no text went out: empty message or cooldown
  jobId: string | null;          // set once the caller books
}

interface Job {
  id: string; messageId: string | null; customerName: string; phone: string; email: string | null;
  address: string | null; description: string; urgency: Urgency;
  start: string; end: string; status: 'scheduled' | 'done' | 'invoiced'; invoiceId: string | null;
}
```

## Adapter interfaces
```ts
interface Transcriber { name: string; transcribe(input: { transcript?: string; audioUri?: string }): Promise<{ text: string; provider: string }> }
interface Extractor   { name: string; extract(transcript: string, ctx: { callerId: string; business: Business }): Promise<VoicemailExtraction> }
interface SmsSender   { name: string; send(msg: { to: string; body: string; linkPath: string | null }): Promise<{ provider: string; providerRef: string | null }> }
```
| Port | Local (default) | Real |
|---|---|---|
| Transcriber | `PassThroughTranscriber` uses the browser transcript | `AwsTranscriber`: StartTranscriptionJob on the S3 recording, poll, fetch transcript |
| Extractor | `RuleExtractor` | `BedrockExtractor`: Converse API with one forced tool whose input schema is the extraction; zod-validated; drops any number or address not found in the transcript; falls back to rules |
| SMS | `OutboxSms` writes to the store | `AwsSms`: End User Messaging SMS `SendTextMessage`, transactional |

## API
| Method | Route | Body | Result |
|---|---|---|---|
| POST | `/api/calls` | `{ from, transcript, durationSec? }` | 201 `{ message }` |
| POST | `/api/hooks/connect-voicemail` | `{ contactId, callerNumber, recordingUri, durationSec? }` + `Authorization: Bearer <secret>` | 201 `{ messageId }` |
| GET | `/api/messages` | | `{ messages, newCount }` |
| POST | `/api/messages/:id/status` | `{ status }` | `{ message }` |
| GET | `/api/book/:token` | | `{ business, caller, slots, booked }` |
| POST | `/api/book/:token` | `{ start, end, address? }` | 201 `{ job }` |
| GET | `/api/jobs`, `/api/outbox`, `/api/samples` | | lists |

## Slot rules
Slots are generated per day from the business's weekly hours in its IANA time zone (wall time converted with `Intl`, so daylight saving is handled). A slot is offered when it starts at least 60 minutes from now, fits before closing and overlaps no job. Emergencies search from today, others from tomorrow, up to 14 days. Booking re-runs the same check inside the store transaction, so two callers cannot take one slot.

## Error handling
| Case | Status | Code |
|---|---|---|
| Bad caller ID or body | 400 | `bad-caller-id`, `invalid-request` |
| Unknown booking token | 404 | `not-found` |
| Slot taken / already booked | 409 | `slot-taken`, `already-booked` |
| Transcription failed | 422 | `transcription-failed` |
| Webhook not configured | 503 | `webhook-disabled` |

## Testing strategy
- Unit: extraction on all sample voicemails, spoken digits, address and name edge cases, urgency precedence, slot generation across time zones, weekends and booked jobs.
- API: the whole pipeline through `app.request` with a memory store and a fixed clock; double booking; webhook auth.
- End to end (Playwright, production build): simulator call to booked job to schedule, inbox counter and outbox; caller booking on a phone viewport with no horizontal scroll.
