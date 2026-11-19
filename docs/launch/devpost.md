# Devpost description (draft)

## Inspiration
A one-truck plumber or appliance tech misses calls all day, because their hands are inside a water heater. Plain voicemail loses 69% of those callers, and up to 85% of people whose call goes unanswered never call back. A missed job is worth $206 for a typical appliance repair and $377 for an emergency plumbing call. The same owner then types up invoices at midnight from memory.

Their office used to be three machines: an answering machine on the kitchen counter, a Dictaphone in the truck and a carbon-copy invoice book on the dash. The cell phone killed all three. AfterBeep brings them back, and this time they book the job and check the bill.

## What it does
- **The answering machine** answers a missed call, reads the voicemail for name, callback number, address, job and urgency, and texts the caller a booking link with open times within seconds. Emergencies are flagged and promised a call back.
- **The Dictaphone** turns "dryer belt fifteen, taxed, one hour labor at eighty-five, trip charge" into invoice lines.
- **The carbon copies** remember what you charged before. When the machine hears "fifteen" for a part you always bill at $50, it holds the invoice and asks. That is the line we built it around: *the machine that hears fifteen and knows you meant fifty.*
- **Spanish callers** get their text back and booking confirmation in Spanish, while the owner reads the message in English.
- **Raise the dead.** Callers who hang up without a word wait in a graveyard. One owner press texts each a single booking link.

One plan, $39 a month. In our worked scenario, one afternoon of missed calls books $557 of work: 14 times the price.

## How we built it
React and Vite on the front, Hono on Node, with ports and adapters so every outside service (Amazon Connect, Amazon Transcribe, Amazon Bedrock, AWS End User Messaging, Stripe) has a free local stand-in. The whole product runs on a laptop with no accounts, and each real service is one environment variable away.

Kiro shaped the build through steering (product, money and AWS rules that load with the files they govern), two EARS specs with 103 criteria, and hooks: tests run on every save, and a money guard restates the integer-cents rules whenever money code changes. Every test title names the criteria it proves, and CI fails if any criterion has no test.

## Code does the math
All money is integer cents. The model, when one is used, only reads words; code does every multiplication, the tax and the total. The server recomputes the invoice and sends it only when the total equals the exact amount the owner approved.

## Challenges
Speech-to-text hears "fifteen" and "fifty" the same way, and "forty gallon water heater" is a size, not a quantity. The price check, against the owner's own past invoices, is what makes spoken invoicing safe.

## Accomplishments
- 160 unit and API tests and 22 Playwright tests, run in CI on every push.
- 99 of 103 spec criteria named by tests; the other 4 sit on the real AWS and Stripe path.
- Every phone number and address right on a held-out set of 24 voicemails, with no invented addresses.
- About $0.074 per call on AWS, for an 80% gross margin at 50 calls a month.

## What's next
A real phone number on Amazon Connect, the Bedrock extractor scored side by side with the rules, and a Spanish booking page to match the Spanish texts.
