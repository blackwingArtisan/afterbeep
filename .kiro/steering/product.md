---
inclusion: always
---
# Product: AfterBeep

**One line:** The answering machine, resurrected. AfterBeep answers the calls a one-person trade business misses, books the job by text, and turns a spoken invoice into a checked, approved bill.

## Who it is for
Solo tradespeople and two-person shops: plumbers, roofers, HVAC techs, appliance repair. They work with their hands, often in a crawlspace or on a roof, and cannot answer the phone. Every missed call is a job that goes to the next name on the search results.

## The two jobs AfterBeep does
1. **Missed calls -> booked jobs.** When the owner cannot pick up, the machine answers, records the caller, transcribes the message, extracts name, callback number, address, job and urgency, and texts the caller a booking link with real open slots. The owner sees each message as a cassette in an inbox with a summary and a one-tap call back. When the caller picks a slot, the job lands on the schedule.
2. **Spoken invoice -> approved bill.** After the job the owner says the invoice out loud ("dryer repair, drum motor three twenty-nine taxed, two hours labor at eighty-five"). AfterBeep turns speech into line items, checks every spoken price against the owner's own past invoices, holds the invoice when a price looks wrong, and sends only after the owner approves the exact total.

## Product rules (non-negotiable)
- **Code does all arithmetic.** Money is integer cents. No model, prompt or parser output is ever trusted for a total, tax or line amount. Models may only label words (description, quantity, unit price as spoken).
- **Nothing is sent without approval.** An invoice is sent only when the client posts the exact total the owner saw and the server recomputes the same number. Any mismatch is refused.
- **The price book is the owner's own history.** A spoken price is compared with what this owner charged before for the same item. A large deviation blocks sending until the owner picks a price.
- **Callers are never left hanging.** Every recorded message gets a text back within the pipeline, even when extraction is partial (fall back to caller ID and a generic job summary).
- **Every external service sits behind an adapter** with a free local implementation used by default, so the product runs, demos and tests with no accounts and no cost.

## Tone and design
- Theme: the 1980s answering machine brought back from the dead. Cassette tapes, blinking red message light, seven-segment counter, "You have 3 new messages". Spooky (Kiroween) but trustworthy: this handles real customers and real money.
- Copy is short, plain and confident. Talk to a busy tradesperson, not a developer.
- Every screen must work one-handed on a phone.

## Business model
Flat monthly price, one plan: $39/month, includes one phone number, unlimited messages and invoices, and the text-back. 14-day free trial. No per-invoice fees from AfterBeep.

## Why now
Speech-to-text and language models became cheap and accurate enough to listen to a voicemail for well under a cent, so a one-person shop can have a front desk for less than a tank of gas.
