# AfterBeep: the business case

AfterBeep is the 1980s front office, back from the dead, for one-person trade businesses: an answering machine that texts callers a booking link, a Dictaphone that turns a spoken invoice into a checked bill, and carbon copies that remember what you charge. One plan, $39 a month.

Every figure below has a source. Where a number is our own assumption, it says so.

## What a missed call costs

| Fact | Figure | Source |
|---|---|---|
| Callers who reach voicemail and hang up without leaving a message | **69%** | Moneypenny small business call report: call data from 10,000 businesses plus a survey of 300 micro businesses (0-9 staff), Nov 2016 [1] |
| Micro businesses in that survey that failed to answer their incoming calls | **1 in 3** (33%) | Moneypenny, same report [1] |
| Customers whose calls go unanswered who will not call back | **up to 85%** | CallRail small business benchmark, 1.1 million leads across automotive, financial services, health care, home services, legal and real estate, Jan 2025 [14] |
| Calls to home services businesses that go unanswered | **14%** (health care 32%, legal 28%, real estate 9%) | CallRail, same benchmark [14] |
| What most people pay for a minor appliance repair | **$206** (typical range $129-$329) | Thumbtack cost guide, updated Mar 31 2026 [2] |
| What most people pay for emergency plumbing | **$377** (typical range $215-$655) | Thumbtack cost guide, updated Jul 8 2026 [3] |
| US building-equipment contractors (plumbing, HVAC, electrical) with no employees | **362,219**, up 10% from 329,055 in 2019 | US Census Bureau, Nonemployer Statistics 2023 and 2019, NAICS 2382 [4] |
| Their average yearly receipts | **$69,368** ($25.1 billion across 362,219 shops) | Same table [4] |
| US repair shops for personal and household goods (includes appliance repair) with no employees | **158,019** | Same table, NAICS 8114 [4] |
| US specialty trade contractors of every kind with no employees | **1,928,748** | Same table, NAICS 238 [4] |

**The pitch in one line.** Plain voicemail loses 69% of callers [1], and up to 85% of callers who get no answer never call back [14]. AfterBeep's greeting promises a text with open times in seconds, so callers have a reason to stay, and every message gets a booking link before the caller tries the next name.

**Payback.** AfterBeep texts only callers who leave a message (hang-ups are never texted), so the model starts from messages, not missed calls.

| Step | Figure | Basis |
|---|---|---|
| Missed calls a week | 5 | Assumption |
| Missed calls a month | 21.7 | 5 × 52 ÷ 12 |
| Share who leave a message | 50% | **Assumption.** Plain voicemail keeps 31% [1]; we assume a greeting that promises a text in seconds keeps more |
| Messages a month, each texted a booking link | 10.8 | |
| Share who book from the text | 1 in 3 | Assumption |
| Booked jobs a month | 3.6 | |
| Value per job | $206 | Thumbtack typical minor appliance repair [2] |
| **Booked work a month** | **about $740** | 18 times the $39 price |

**The Dictaphone and the carbon copies, priced on their own.** *Assume* one misheard price a week, at the $35 gap between "dryer belt, fifteen" and the usual $50: holding it is about **$1,820 a year** kept, close to four years of AfterBeep. That is before the hour a night of typing invoices from memory.

At the plain voicemail rate of 31% the same math gives about $460 a month, so even a greeting that keeps no extra callers pays for itself 11 times over. One booked job pays for more than five months of AfterBeep. A year of AfterBeep ($468) is 0.7% of the average solo shop's receipts. The landing page has the same model with both assumptions on sliders (`src/domain/payback.ts`, unit tested).

**Morgan's Tuesday, a worked scenario.** The demo data is built so the app shows these numbers after "Demo the whole story": 4 calls answered and texted back, 2 booked (Priya's emergency at a $377 quote, which is Thumbtack's typical emergency plumbing price [3], and June's dryer repair billed at $180 before tax, $182.88 with it), and $35 caught when "dryer belt, fifteen" was held at the usual $50. That is **$557 of booked work ($377 quoted + $180 billed)** in one afternoon, 14 times the monthly price.

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
- **Revenue at stake** (count × $468 a year, Census Nonemployer Statistics 2023 [4]):

  | Segment | Solo businesses | At $39 a month |
  |---|---|---|
  | Plumbing, HVAC and electrical contractors (NAICS 2382) | 362,219 | **about $170M a year** |
  | Personal and household goods repair shops (NAICS 8114) | 158,019 | about $74M a year |
  | All specialty trade contractors, including roofers, painters and carpenters (NAICS 238) | 1,928,748 | about $903M a year |

  NAICS 2382 sits inside NAICS 238, so the first and third rows overlap; the first row is the beachhead.
- **Near-term goal:** 1% of the solo building-equipment contractors paying $39 a month is about **$1.7 million a year**.
- **To $1M a year:** $1,000,000 ÷ $468 is about **2,140 paying customers**, 0.6% of the solo building-equipment contractors.
- **Price:** $39 a month, flat, with a 14-day free trial. No per-invoice fee. It sits next to Jobber's one-user Core plan ($39 a month on a one-year commitment) [9], not above it.

## Startup math

Every input below is an assumption until there are paying customers, and it is labelled as one.

| Step | Figure | Basis |
|---|---|---|
| Revenue per customer | $39 a month | The one plan |
| Gross margin | 80% | AWS cost at 50 calls a month, above |
| Monthly churn | 3% | **Assumption**, typical for small-business software; a tool that books jobs every week should do better |
| Customer lifetime | about 33 months | 1 ÷ 3% |
| Lifetime value | about **$1,040** | $39 × 80% ÷ 3% |
| Cost to win a customer | about **$150** | **Assumption**: supply-house counter cards, trade forums and a free month per referral, no paid ads |
| Payback on that cost | under 5 months | $150 ÷ ($39 × 80%) |
| Lifetime value to acquisition cost | about **7 to 1** | |
| Customers for $1M a year | about **2,140** | $1,000,000 ÷ $468 |

**The first 12 months.** Months 1 to 3: ten techs who buy at one supply house, to measure missed calls, the share who leave a message and the share who book. Months 4 to 6: that whole metro through counter cards and referrals. Months 7 to 12: three metros, with the conversion numbers from the first one replacing the assumptions above.

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
- **Many callers, and many techs, speak Spanish.** About 1 in 8 US residents age 5 and older speak Spanish at home: 21.7% speak a language other than English and 61.1% of them speak Spanish (our multiplication of the Census figures) [20]. In 2025, 30.3% of plumbers, pipefitters and steamfitters and 26.7% of HVAC mechanics and installers were Hispanic or Latino [21]. A machine that reads a Spanish voicemail and texts back in Spanish serves both sides of the call.

## Why not Live Voicemail, Google Voice, Jobber, Housecall Pro, GoHighLevel, Podium, ServiceTitan or an AI receptionist?

**Text-back is table stakes. Of the tools below, only AfterBeep checks a spoken price against your own carbon copies, at $39 flat on your own number.**

| Option | Price | Answers as | What it does | What it does not do |
|---|---|---|---|---|
| iPhone Live Voicemail | Free with iOS 17 or later [10] | Your voicemail | Shows the message on screen while the caller leaves it | No text back, no booking, no invoice. The caller still waits for a call back |
| Google Voice | Free for personal use; $10, $20 or $30 per user a month for businesses [11] | Your voicemail | Transcribes voicemail and blocks spam | No booking link, no schedule, no price checks |
| Jobber | Core $29-$49 a month for one user; AI Receptionist add-on $29 a month [9] | An AI receptionist (add-on) | A full field-service suite: quotes, scheduling, invoicing, and an AI that answers calls | It asks you to move your whole business into a suite. Its invoices do not check a spoken price against what you charged before |
| Housecall Pro | Basic $79 a month, or $59 a month billed yearly, for 1 user; Essentials $189 for up to 5 [15] | An AI call-answering add-on ("CSR AI"), price not published [15] | A field-service suite: scheduling, dispatch, invoicing, payments | A suite to move into; no spoken-price check |
| GoHighLevel | Starter $97 a month [16], plus metered phone, text and AI usage | Your voicemail, with a missed-call text-back setting [17] | A marketing and CRM platform built for agencies, with automations | Text-back is a setting or a workflow you build; no invoices from speech, no price checks |
| Podium | Not published; quotes come from sales [12] | An "AI employee" add-on [12] | Reviews, messaging, payments | No public price, built for multi-location businesses |
| ServiceTitan | Not published; quotes come from sales [18] | Your office staff, with phone add-ons | Software for shops with dispatchers and call takers | Built for larger shops; far beyond a one-truck budget |
| AI receptionists for trades, such as Rosie | Professional $49 a month for 250 minutes; Scale $149 for 1,000 [19] | A voice agent with a name and voice you pick [19] | Answers live calls and takes details | No invoices, no price checks, priced by the minute |
| Smith.ai AI Receptionist | Free for 25 calls; Pro from $150 a month for 75 calls [13] | An AI receptionist, with human backup [13] | An AI answers live calls | Priced per call. No invoices |
| **AfterBeep** | **$39 a month, flat** | **Your own greeting, and it says it is a machine** | Text back, booking, spoken invoices checked against your history | |

**AfterBeep's answer: an honest machine on your own number.** No robot pretending to be your receptionist. It says it is a machine, takes the message and texts every real caller your real open slots, then turns your spoken invoice into a bill that is held when a price or quantity looks wrong, and sent only at the exact total you approved. Flat $39 a month, no per-call or per-invoice fees.

## Texting rules

- **Opt-out on every number.** Every first text names the business and ends "Reply STOP to opt out." in the caller's language. STOP, UNSUBSCRIBE, CANCEL, PARAR and the rest of the common set put the number on an opt-out list that every send checks first; HELP gets the business name and phone; START opts back in. AWS End User Messaging keeps its own opt-out list per number too.
- **Registered sending.** US business texts from a local number need A2P 10DLC registration: a registered brand and a campaign. AfterBeep's campaign is customer care, replies to people who called the business first, with no marketing content. The $1 number lease and $2 campaign fee are in the unit economics above [8].
- **Raise the dead is a one-time reply to a call the person made.** Only numbers that called in the last 30 days and never heard back, only when the owner presses it, one text each that names the day they called, never a second, and never to a number that opted out.


Prices were checked on November 18 2026 and change over time.

## Sources

1. Moneypenny, "Findings of small business call report revealed", Nov 21 2016. https://moneypenny.com/us/resources/news/small-business-call-report/
2. Thumbtack, "How much does appliance repair cost?", updated Mar 31 2026. https://www.thumbtack.com/p/appliance-repair-cost
3. Thumbtack, "How much do emergency plumbers cost?", updated Jul 8 2026. https://www.thumbtack.com/p/emergency-plumber-cost
4. US Census Bureau, Nonemployer Statistics, national files for 2023 and 2019 (rows NAICS 238, 2382 and 8114, all legal forms, all receipt sizes). https://www2.census.gov/programs-surveys/nonemployer-statistics/datasets/2023/historical-datasets/nonemp23us.zip and https://www2.census.gov/programs-surveys/nonemployer-statistics/datasets/2019/historical-datasets/nonemp19us.zip
5. AWS Price List API, us-east-1 offer files for AmazonConnect ("End customer minutes used"), transcribe ("TranscribeAudio") and AmazonBedrockFoundationModels ("Nova Lite input/output tokens"). https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/index.json
6. Amazon Connect pricing appendix (US DID number per day; inbound per minute). https://aws.amazon.com/products/connect/customer/pricing/appendix/
7. AWS End User Messaging SMS prices per country (CSV, United States, 10DLC). Linked from https://aws.amazon.com/end-user-messaging/pricing/
8. AWS End User Messaging pricing (10DLC number lease and campaign fees). https://aws.amazon.com/end-user-messaging/pricing/
9. Jobber pricing. https://www.getjobber.com/pricing/
10. Apple Support, "Use Live Voicemail on your iPhone". https://support.apple.com/en-us/105066
11. Google Workspace, Google Voice plans. https://workspace.google.com/products/voice/
12. Podium pricing. https://www.podium.com/pricing
13. Smith.ai AI Receptionist pricing. https://smith.ai/pricing/ai-receptionist
14. CallRail, small business marketing benchmark report, released Jan 15 2025, as reported by Plumber magazine, Jan 20 2025. https://www.plumbermag.com/online_exclusives/2025/01/callrail-releases-report-analyzing-which-marketing-efforts-best-convert-leads-into-business

15. Housecall Pro, product and pricing facts for AI assistants, prices "as of July 2026". https://www.housecallpro.com/llm-info/
16. HighLevel pricing. https://www.gohighlevel.com/pricing
17. HighLevel help center, "Where and How to Configure the Missed Call Text Back Feature". https://help.gohighlevel.com/support/solutions/articles/48001239140
18. ServiceTitan pricing ("Request pricing"). https://www.servicetitan.com/pricing
19. Rosie pricing. https://heyrosie.com/pricing
20. U.S. Census Bureau, "Language Spoken at Home" (American Community Survey 5-year estimates, 2018-2022), December 7, 2023: 78.3% of people age 5 and older spoke only English at home; Spanish was 61.1% of those who spoke another language. https://www.census.gov/newsroom/press-releases/2023/language-at-home-acs-5-year.html
21. U.S. Bureau of Labor Statistics, Current Population Survey, Table 11, "Employed persons by detailed occupation, sex, race, and Hispanic or Latino ethnicity", 2025 annual averages (11 months; October 2025 was not collected). https://www.bls.gov/cps/cpsaat11.htm
