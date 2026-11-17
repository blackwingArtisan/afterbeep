# AfterBeep

**The answering machine, back from the dead: it answers the calls a one-person trade business misses, books the job by text, and turns a spoken invoice into a checked, approved bill.**

![AfterBeep inbox: missed calls shown as cassettes](docs/inbox.png)

## Who it's for
Plumbers, appliance techs, HVAC and roofing crews of one. They miss calls because they are under a sink, and they write invoices at 9 pm because they were on a ladder all day. Every missed call is a job that goes to the next name on the search page.

**Why now:** speech-to-text and language models became cheap and accurate enough to read a voicemail for less than a cent, so a one-person shop can have a front desk for less than a tank of gas.

**Pricing:** one plan, $39 a month, with a 14-day free trial. No per-invoice fee.

## What works today
Everything below runs on a laptop with no accounts and no keys.

**Missed calls**
- A call simulator rings the machine, plays the greeting and the beep, and records the caller. You can pick a sample voicemail, say one into the mic (Web Speech API), or type it.
- Each message is read for the caller's name, callback number (a spoken number beats the caller ID), address, job, and urgency (emergency, soon, or routine).
- The caller gets a text right away with a booking link. Emergencies are promised a call back, and everyone else is shown the first open slot.
- The booking page shows real open slots: in the business's time zone, inside opening hours, with no overlap with booked jobs. Emergencies are offered slots today. When the caller books, the job lands on the schedule and a confirmation text goes out.
- The inbox shows each message as a cassette with a seven-segment counter, a blinking message light, playback by speech synthesis, and one-tap call back.

**Voice invoices**
- Say "Dryer belt fifteen, taxed. One hour labor at eighty-five. Trip charge." and get line items. Code does every multiplication, the tax and the total, in integer cents.
- A price book is built from the owner's past invoices. "Fifteen" for a belt that has always been $50 holds the invoice until the owner chooses. A missing price is filled from history, and "twelve fifty" reads as $1,250 for a water heater and $12.50 for a cartridge.
- The confirm screen sends only when the server's recomputed total equals the exact total the owner approved. The customer gets an invoice link, the job is marked invoiced, and the price book learns the new prices.

**Product**
- A landing page with pricing, light and dark themes, and caller pages built for phones.

## How to run
Requires Node 24 or later.

```bash
npm ci
npm run build
npm start                 # http://localhost:3111
```

For development with hot reload:

```bash
npm run dev               # client on http://localhost:3110, API on 3111
```

Open `/machine` for the owner's machine and `/machine/call` to leave it a message. **Reset demo** restores the seeded data.

## How to test
```bash
npm run typecheck
npm test                  # Vitest: domain and API
npx playwright install chromium
npm run test:e2e          # Playwright against the production build on port 3112
```

The end-to-end tests drive the real server. They cover a missed call to a booked job, a held invoice that is approved and sent, the landing page and theme, and the caller booking page on a phone viewport.

## Architecture
```
src/domain/     pure logic: money, spoken numbers, tax, invoice parser, price book, voicemail rules, slots
src/adapters/   ports + implementations: store, transcriber, extractor, sms, invoices
src/server/     Hono API, services (voicemail, booking, invoicing), seed data
src/client/     React app: landing, machine (inbox, call, schedule, invoice, outbox, prices), caller pages
infra/connect/  Amazon Connect contact flow + Lambda for the real phone path
.kiro/          steering, specs, hooks
```

```
Phone or simulator -> receiveVoicemail: Transcriber -> Extractor -> Store -> openSlots -> SMS with /book/:token
Caller -> /book/:token -> bookSlot -> Job -> confirmation SMS
Owner speech -> parseInvoiceSpeech -> price book checks -> totals in cents -> approve exact total -> InvoiceProvider -> /i/:id
```

The domain layer has no I/O. Services take their dependencies (store, adapters, clock, id generator) as arguments, so the tests run the whole pipeline in memory with a fixed clock.

## Adapters
Each external service has a free local default and a real implementation. The real implementations are type-checked and are not called by the tests.

| Port | Env var | Local (default) | Real |
|---|---|---|---|
| Transcriber | `AFTERBEEP_TRANSCRIBER` | `local`: uses the browser transcript | `aws`: Amazon Transcribe on the S3 recording |
| Extractor | `AFTERBEEP_EXTRACTOR` | `rules`: deterministic rules | `bedrock`: Amazon Bedrock Converse with a forced tool and schema validation; drops any number or address the caller never said; falls back to rules |
| SMS | `AFTERBEEP_SMS` | `outbox`: shown at `/machine/outbox` | `aws`: AWS End User Messaging SMS |
| Invoices | `AFTERBEEP_INVOICES` | `local`: outbox message and `/i/:id` page | `stripe`: Stripe Invoicing, test keys only, voids the invoice if Stripe's total differs |
| Store | `AFTERBEEP_DATA_DIR` | JSON file with atomic writes | |

All settings are listed in `.env.example`. The phone wiring is described in `infra/connect/README.md`.

## Deploy
`render.yaml` targets Render's free web service tier (one Node service, health check `/api/health`). The app has not been deployed.

## Built with Kiro
- `.kiro/steering/` holds the product rules, stack and file layout that every change follows.
- `.kiro/specs/missed-call-booking/` and `.kiro/specs/voice-invoicing/` hold the EARS requirements, design and task list for each feature.
- `.kiro/hooks/` runs the unit tests on save, asks for a money-safety review when the money files change, and type-checks at the end of a session.
- `KIRO-LOG.md` records every Kiro call: what it was asked, what it produced, and what went wrong.

## License
MIT, Stubborn Otter Software. All people, businesses, addresses and phone numbers in the demo data are invented.
