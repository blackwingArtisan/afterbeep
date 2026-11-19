---
inclusion: always
---
# Product: AfterBeep

**One line:** The 1980s front office, back from the dead. AfterBeep answers the calls a one-person trade business misses, books the job by text, and turns a spoken invoice into a checked, approved bill.

**The thesis.** Three office machines a one-truck business used to rely on, rebuilt: the **answering machine** (missed calls become booked jobs), the **Dictaphone** (a spoken invoice becomes line items) and the **carbon copies** (the price book: "your carbon copies remember what you charge"). Copy, screen names and features should fit one of the three. The price book is called "Carbon copies" on every screen. Closing line: "The answering machine is back. This time it books the job and checks the bill."

**What died.** The answering machine, the Dictaphone and the carbon-copy invoice book were the solo trade's front office. Cell phone voicemail folded all three into a beep. Say this plainly; do not cite dates we have not sourced.

## Who it is for
Solo tradespeople and two-person shops: plumbers, roofers, HVAC techs, appliance repair. They work with their hands, often in a crawlspace or on a roof, and cannot answer the phone. Every missed call is a job that goes to the next name on the search results.

## The two jobs AfterBeep does
1. **Missed calls -> booked jobs.** When the owner cannot pick up, the machine answers, records the caller, transcribes the message, extracts name, callback number, address, job and urgency, and texts the caller a booking link with real open slots. The owner sees each message as a cassette in an inbox with a summary and a one-tap call back. When the caller picks a slot, the job lands on the schedule.
2. **Spoken invoice -> approved bill.** After the job the owner says the invoice out loud ("dryer repair, drum motor three twenty-nine taxed, two hours labor at eighty-five"). AfterBeep turns speech into line items, checks every spoken price against the owner's own past invoices, holds the invoice when a price looks wrong, and sends only after the owner approves the exact total.

## Product rules (non-negotiable)
- **Code does all arithmetic.** Money is integer cents. No model, prompt or parser output is ever trusted for a total, tax or line amount. Models may only label words (description, quantity, unit price as spoken).
- **Nothing is sent without approval.** An invoice is sent only when the client posts the exact total the owner saw and the server recomputes the same number. Any mismatch is refused.
- **The price book is the owner's own history.** A spoken price is compared with what this owner charged before for the same item. A large deviation blocks sending until the owner picks a price.
- **Callers are never left hanging, and strangers are never spammed.** Every message with a real request gets a text back within the pipeline, even when extraction is partial (fall back to caller ID and a generic job summary). Hang-ups and empty messages are filed without a text, and one number gets at most one text per 10 minutes.
- **Check quantities as hard as prices.** A misheard quantity costs as much as a misheard price, so unusual quantities and numbers the parser could not place hold the invoice too.
- **Every external service sits behind an adapter** with a free local implementation used by default, so the product runs, demos and tests with no accounts and no cost.

## Tone and design
- Theme: the 1980s answering machine brought back from the dead. Cassette tapes, blinking red message light, seven-segment counter, "You have 3 new messages". Spooky (Kiroween) but trustworthy: this handles real customers and real money.
- Copy is short, plain and confident. Talk to a busy tradesperson, not a developer.
- Every screen must work one-handed on a phone.

## What a missed call costs (cited; full table and sources in docs/business.md)
- 69% of callers who reach voicemail hang up without leaving a message (Moneypenny, call data from 10,000 businesses, 2016). This is the pitch: plain voicemail loses 69% of callers; AfterBeep's greeting promises a text with open times in seconds, so callers have a reason to stay.
- Up to 85% of customers whose calls go unanswered will not call back; home services businesses miss 14% of calls (CallRail small business benchmark, 1.1 million leads, Jan 2025).
- Most people pay $206 for a minor appliance repair and $377 for emergency plumbing (Thumbtack cost guides, 2026).
- 362,219 US plumbing, HVAC and electrical contractors have no employees, with average receipts of $69,368 (Census Nonemployer Statistics 2023, NAICS 2382).
- Payback: 5 missed calls a week (22 a month); half leave a message when the greeting promises a text; 1 in 3 of those book at $206. That is about $740 a month, 18 times the price. One job pays for five months. (The 5 a week, the 50% and the 1 in 3 are assumptions; plain voicemail keeps 31%.)
- Revenue at stake: 362,219 solo building-equipment contractors × $468 a year is about $170M a year; 1% is about $1.7M.

Use only these cited figures in copy. Never invent a statistic, a customer or a testimonial.

## Business model
Flat monthly price, one plan: $39/month, includes one phone number, unlimited messages and invoices, and the text-back. 14-day free trial. No per-invoice fees from AfterBeep. AWS cost per customer is about $7.61 a month at 50 missed calls (80% gross margin) and $18.73 at 200 (52%), worst case on texts.

## Go to market
Conditional call forwarding on the owner's own phone (no new number), counter cards at plumbing and HVAC supply houses, trade communities, a Google Business Profile guide, and a free month per referral.

## Why now
Phones already transcribe voicemail for free (iPhone Live Voicemail, Google Voice), and reading a voicemail on AWS now costs well under a cent (Transcribe $0.006 a minute, Nova Lite about $0.0002 a message). The transcript stopped being the hard part; what a solo tech still lacks is what happens after the beep: the text back, the booking and the bill.

## Competitors, in one line each
Live Voicemail and Google Voice transcribe but never text back, book or bill. Jobber ($29-$49 a month plus $29 for its AI receptionist) is a whole field-service suite. Podium does not publish prices. Smith.ai's AI receptionist is free for 25 calls, then $150 a month for 75, and answers as a receptionist. AfterBeep is an honest machine on your own number, flat $39, with price-book checks and the exact-total guarantee.
