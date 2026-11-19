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

One plan, $39 a month. In our worked scenario, one afternoon of missed calls books $557 of work ($377 quoted + $180 billed): 14 times the price. No robot pretends to be your receptionist: the machine says it is a machine, takes the message and texts your real open times.

## How we built it
React and Vite on the front, Hono on Node, with ports and adapters so every outside service (Amazon Connect, Amazon Transcribe, Amazon Bedrock, AWS End User Messaging, Stripe) has a free local stand-in. The whole product runs on a laptop with no accounts, and each real service is one environment variable away.

Kiro shaped the build through steering (product, money and AWS rules that load with the files they govern), two EARS specs with 119 criteria, hooks (tests on every save, a money guard that restates the integer-cents rules whenever money code changes), pinned AWS documentation and Context7 MCP servers, and a custom agent whose guard blocks `.env` writes, live keys and float money. Every test title names the criteria it proves, and CI fails if any criterion has no test. KIRO-LOG.md says exactly which parts Kiro did and which the coding assistant did.

## Code does the math
All money is integer cents. The model, when one is used, only reads words; code does every multiplication, the tax and the total. The server recomputes the invoice and sends it only when the total equals the exact amount the owner approved.

## Challenges
Speech-to-text hears "fifteen" and "fifty" the same way, and "forty gallon water heater" is a size, not a quantity. The price check, against the owner's own past invoices, is what makes spoken invoicing safe.

## Accomplishments
- 195 unit and API tests and 23 Playwright tests, run in CI on every push.
- 115 of 119 spec criteria named by tests; the other 4 sit on the real AWS and Stripe path.
- Every phone number and address right on a held-out set of 24 voicemails, with no invented addresses.
- About $0.074 per call on AWS, for an 80% gross margin at 50 calls a month.

## The business
$39 a month flat, about $0.074 a call on AWS, and an 80% gross margin at 50 calls a month. With assumed 3% monthly churn, a customer is worth about $1,040; counter cards at supply houses and referrals should win one for about $150. About 2,140 customers make $1M a year, out of 362,219 solo plumbing, HVAC and electrical contractors. The first year: ten techs at one supply house, then that metro, then three. Text-back is table stakes; of the tools we compared (Jobber, Housecall Pro, GoHighLevel, Podium, ServiceTitan, AI receptionists), only AfterBeep checks a spoken price against your own past invoices.

## What's next
A real phone number on Amazon Connect, the Bedrock extractor scored side by side with the rules, and a Spanish booking page to match the Spanish texts.
