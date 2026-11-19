# AfterBeep: the business case

AfterBeep is the 1985 front office, back from the dead, for one-person trade businesses: an answering machine that texts callers a booking link, a Dictaphone that turns a spoken invoice into a checked bill, and carbon copies that remember what you charge. One plan, $39 a month.

Every figure below has a source. Where a number is our own assumption, it says so.

## What a missed call costs

| Fact | Figure | Source |
|---|---|---|
| Callers who reach voicemail and hang up without leaving a message | **69%** | Moneypenny small business call report: call data from 10,000 businesses plus a survey of 300 micro businesses (0-9 staff), Nov 2016 [1] |
| Micro businesses in that survey that failed to answer their incoming calls | **1 in 3** (33%) | Moneypenny, same report [1] |
| What most people pay for a minor appliance repair | **$206** (typical range $129-$329) | Thumbtack cost guide, updated Mar 31 2026 [2] |
| What most people pay for emergency plumbing | **$377** (typical range $215-$655) | Thumbtack cost guide, updated Jul 8 2026 [3] |
| US building-equipment contractors (plumbing, HVAC, electrical) with no employees | **362,219**, up 10% from 329,055 in 2019 | US Census Bureau, Nonemployer Statistics 2023 and 2019, NAICS 2382 [4] |
| Their average yearly receipts | **$69,368** ($25.1 billion across 362,219 shops) | Same table [4] |
| US repair shops for personal and household goods (includes appliance repair) with no employees | **158,019** | Same table, NAICS 8114 [4] |

**Payback.** Say a solo plumber misses 5 calls a week, about 22 a month (our assumption). If AfterBeep turns 1 in 3 of them into a booked job (our assumption) at Thumbtack's typical $206 repair, that is about **$1,490 a month** of work that would have gone to the next name on the search page. One booked job pays for more than five months of AfterBeep. A year of AfterBeep ($468) is 0.7% of the average solo shop's receipts.

## Unit economics on AWS

Prices are AWS list prices in US East (N. Virginia), read from the AWS Price List API and pricing pages in November 2026. One call is assumed to use one minute of line time (greeting plus message). The worst case is assumed for texts: every caller gets a two-segment text-back and books, which adds a two-segment confirmation.

| Item | Unit price | Per call |
|---|---|---|
| Amazon Connect voice usage | $0.018 per minute [5] | $0.0180 |
| Amazon Connect inbound telephony, US DID number | $0.0022 per minute [6] | $0.0022 |
| Amazon Transcribe batch | $0.0001 per second ($0.006 per minute) [5] | $0.0060 |
| Amazon Bedrock, Nova Lite (about 1,500 input and 300 output tokens) | $0.00006 per 1K input, $0.00024 per 1K output [5] | $0.0002 |
| AWS End User Messaging SMS, US 10DLC, 4 segments | $0.00774 per segment plus $0.00421 carrier fee [7] | $0.0478 |
| **Total per call** | | **$0.0742** |

Fixed cost per customer each month: the Connect phone number ($0.03 a day, about $0.90) [6], a 10DLC phone number lease ($1) [8] and a low-volume 10DLC campaign ($2) [8], so **$3.90**. Lambda, S3 and Kinesis Video Streams add fractions of a cent per call and are left out.

| Missed calls a month | AWS cost | Gross margin on $39 |
|---|---|---|
| 50 | $3.71 + $3.90 = **$7.61** | **80%** |
| 200 | $14.83 + $3.90 = **$18.73** | **52%** |

Texts are two-thirds of the cost, so the main lever is short texts: one segment instead of two takes the per-call cost to about $0.05. Payment processing on the $39 subscription is not included.

## Market

- **Who buys:** the 362,219 plumbing, HVAC and electrical contractors with no employees [4], plus solo appliance techs inside the 158,019 household repair shops [4]. They work with their hands, so they cannot answer, and they bill at night.
- **Size:** if 1% of the building-equipment contractors alone pay $39 a month, that is about **$1.7 million a year** in revenue.
- **Price:** $39 a month, flat, with a 14-day free trial. No per-invoice fee. It sits next to Jobber's one-user Core plan ($39 a month on a one-year commitment) [9], not above it.

## Go to market

1. **No new number.** The owner turns on conditional call forwarding on the phone they already have, so unanswered calls roll to AfterBeep. Setup is one carrier code and a test call.
2. **Supply houses.** Solo techs pick up parts at the same counter most mornings. A counter card with a QR code ("Call this number and leave a message. Watch what happens.") lets them try the machine in 60 seconds.
3. **Trade communities.** Plumbing, HVAC and appliance-repair forums and local trade associations, with the demo call as the pitch, not an ad.
4. **Google Business Profile.** The call button on a business profile is where most missed calls come from. A short guide shows how to point it at a number that never goes unanswered.
5. **Referrals.** A free month for each tech who brings another. Trades talk to trades.

## Why now

- **Reading a voicemail now costs well under a cent.** Amazon Transcribe batch is $0.006 a minute and Nova Lite reads a message for about $0.0002 [5], so understanding every call is no longer the expensive part.
- **Transcripts became free, so the value moved.** iPhone Live Voicemail shows the message as it is left [10] and Google Voice transcribes voicemail [11]. A transcript alone is no longer worth paying for. What a solo tech still lacks is what happens after the beep: the text back, the booking and the bill.
- **The customer base is growing.** Solo building-equipment contractors grew 10% from 2019 to 2023 [4].

## Why not iPhone Live Voicemail, Google Voice, Jobber, Podium or Smith.ai?

| Option | Price | What it does | What it does not do |
|---|---|---|---|
| iPhone Live Voicemail | Free with iOS 17 or later [10] | Shows the message on screen while the caller leaves it | No text back, no booking, no invoice. The caller still waits for a call back |
| Google Voice | Free for personal use; $10, $20 or $30 per user a month for businesses [11] | Transcribes voicemail and blocks spam | No booking link, no schedule, no price checks |
| Jobber | Core $29-$49 a month for one user; AI Receptionist add-on $29 a month [9] | A full field-service suite: quotes, scheduling, invoicing, and an AI that answers calls | It asks you to move your whole business into a suite. Its invoices do not check a spoken price against what you charged before |
| Podium | Not published; quotes come from sales [12] | Reviews, messaging, payments, an "AI employee" add-on | No public price, built for multi-location businesses |
| Smith.ai AI Receptionist | Free for 25 calls; Pro from $150 a month for 75 calls [13] | An AI answers live calls, with human backup | Priced per call, and it answers as a receptionist rather than being the owner's own machine. No invoices |

**AfterBeep's answer:** an honest machine on your own number. It never pretends to be a person. It texts every real caller a booking link with your real open slots, and turns your spoken invoice into a bill that is held when a price or quantity looks wrong, and sent only at the exact total you approved. Flat $39 a month, no per-call or per-invoice fees.

## Sources

1. Moneypenny, "Findings of small business call report revealed", Nov 21 2016. https://moneypenny.com/us/resources/news/small-business-call-report/
2. Thumbtack, "How much does appliance repair cost?", updated Mar 31 2026. https://www.thumbtack.com/p/appliance-repair-cost
3. Thumbtack, "How much do emergency plumbers cost?", updated Jul 8 2026. https://www.thumbtack.com/p/emergency-plumber-cost
4. US Census Bureau, Nonemployer Statistics, national files for 2023 and 2019 (rows NAICS 2382 and 8114, all legal forms, all receipt sizes). https://www2.census.gov/programs-surveys/nonemployer-statistics/datasets/2023/historical-datasets/nonemp23us.zip and https://www2.census.gov/programs-surveys/nonemployer-statistics/datasets/2019/historical-datasets/nonemp19us.zip
5. AWS Price List API, us-east-1 offer files for AmazonConnect ("End customer minutes used"), transcribe ("TranscribeAudio") and AmazonBedrockFoundationModels ("Nova Lite input/output tokens"). https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/index.json
6. Amazon Connect pricing appendix (US DID number per day; inbound per minute). https://aws.amazon.com/products/connect/customer/pricing/appendix/
7. AWS End User Messaging SMS prices per country (CSV, United States, 10DLC). Linked from https://aws.amazon.com/end-user-messaging/pricing/
8. AWS End User Messaging pricing (10DLC number lease and campaign fees). https://aws.amazon.com/end-user-messaging/pricing/
9. Jobber pricing. https://www.getjobber.com/pricing/
10. Apple Support, "Use Live Voicemail on your iPhone". https://support.apple.com/en-us/105066
11. Google Workspace, Google Voice plans. https://workspace.google.com/products/voice/
12. Podium pricing. https://www.podium.com/pricing
13. Smith.ai AI Receptionist pricing. https://smith.ai/pricing/ai-receptionist

Prices were checked on November 18 2026 and change over time.
