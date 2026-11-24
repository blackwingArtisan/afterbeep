# Extractor evaluation

How well the free rules extractor reads a voicemail, measured on 24 invented voicemails in [`eval/voicemails.json`](../eval/voicemails.json). They are written the way speech-to-text returns them, with missing punctuation, spoken digits and false starts, and labelled by hand before the first run.

```bash
npx tsx scripts/eval-extractor.ts --misses
```

The script runs only the local rules, so it is free and offline. A field counts as right when it matches the label, ignoring case, punctuation and how a unit number is spelled.

## Results

| Field | First run (held out) | After two rule fixes |
|---|---|---|
| Caller name | 21 of 24 (88%) | 21 of 24 (88%) |
| Callback number | 24 of 24 (100%) | 24 of 24 (100%) |
| Address | 24 of 24 (100%) | 24 of 24 (100%) |
| Job category | 18 of 24 (75%) | 18 of 24 (75%) |
| Urgency | 19 of 24 (79%) | 21 of 24 (88%) |
| Every field right | 14 of 24 (58%) | 16 of 24 (67%) |
| Address the caller never gave | 0 | 0 |

The first run is a held-out score: none of these voicemails had been seen when the rules were written. It found two missed emergencies, and both were fixed with unit tests that use different wording:

- "The outlet in my bathroom **sparked**" was read as routine, because the rule knew "spark", "sparks" and "sparking" but not "sparked".
- "**The heat's out** and my mother is ninety-two" was read as routine, because the rule knew "the heat is out" but not the contraction, and did not count a stated age of eighty or ninety as a vulnerable person.

The second column is no longer held out, since those two fixes were made after seeing these cases. A fresh set is needed to measure the next round.

## What the rules still miss

| Case | Miss | Why it matters |
|---|---|---|
| Roof dripping into a bucket right now | Category leak, urgency routine | Active water through a roof should be an emergency |
| "A few shingles blew off" | Category leak, urgency soon | A roof call filed as plumbing goes to the wrong trade |
| "Pete Lindgren, 61 Ashby Road" with no "this is" | Name missed | The text back says "Hi there" instead of "Hi Pete" |
| "Sam from the coffee shop" | Name missed | Same |
| Jammed garbage disposal | Category drain | Close enough to book; the label says appliance |
| Ceiling fan and light fixtures | Category general | No electrical keyword for fixtures yet |
| Pipe split and spraying | Category general, urgency right | The job label is vague, but the emergency is caught |
| "Can you come by this week?" | Urgency soon, labelled routine | A judgment call; the rules count "this week" as soon |
| Running toilet | Category drain, labelled general | A judgment call |

The phone number and address are the fields that send a tech to the right house, and both scored 24 of 24 with no invented addresses. The Bedrock extractor exists for the cases the rules miss; it drops any number or address the caller never said and falls back to these rules on any failure. It was not scored here because calling it costs money.

## Scoring the Bedrock extractor

The same script scores Amazon Bedrock (Nova Lite by default) side by side with the rules, on the same 24 voicemails and the same comparison:

```bash
AFTERBEEP_EVAL_PAID=1 npx tsx scripts/eval-extractor.ts --bedrock --misses
```

It makes one model call per voicemail, about 24 small calls in all, so it refuses to run without `AFTERBEEP_EVAL_PAID=1` and AWS credentials. Set `AFTERBEEP_BEDROCK_MODEL` to score a different model. Besides the five fields it reports how many answers **fell back** to the rules, and why each one did: the extractor now records a `fallbackReason` (the AWS error name, a schema failure, or a reply without the forced tool call) on the message and in the server log.

| Field | Rules | Nova Lite |
|---|---|---|
| Caller name | 21 of 24 | not run yet |
| Callback number | 24 of 24 | not run yet |
| Address | 24 of 24 | not run yet |
| Job category | 18 of 24 | not run yet |
| Urgency | 21 of 24 | not run yet |
| Every field right | 16 of 24 | not run yet |
| Address the caller never gave | 0 | not run yet |

Two more paid checks sit behind the same kind of switch:

- `AFTERBEEP_AWS_TEST=1 npm run test:aws` runs two live Bedrock extractions (an emergency with a spoken number and address, and a caller who gave no address) and fails on any fallback or invented address. Without the variable both tests are skipped, so `npm test` and CI never spend money.
- `AFTERBEEP_EVAL_PAID=1 npx tsx scripts/transcribe-sample.ts s3://bucket/voicemail.wav` runs one Amazon Transcribe batch job on a real recording and prints the transcript, how long it took, and what the rules read from it.

## The real phone path
On November 24, 2026 (UTC) the demo line was tested with real calls. Amazon Connect placed each call to the demo line from the line itself, with Amazon Polly speaking an invented voicemail after the greeting, so every step after the dial was the production path: the call gate, the greeting, the IVR recording in S3, the voicemail Lambda (Amazon Transcribe with English and Spanish, number masking, Nova Lite on Bedrock with the caps), the webhook, and the text back in the live demo's Outbox.

Two of four placed calls connected; the carrier dropped the other two as possible robocalls, because a number calling itself looks like a spoofed caller ID. Both calls that connected were read right on every field:

| Call | Name | Address | Job | Urgency | Language | Callback | Tokens in / out |
|---|---|---|---|---|---|---|---|
| Burst water heater, spoken callback number | Dana Whitfield | 42 Lantern Street | Water heater: burst, flooding | emergency | English | the spoken number, masked | 810 / 103 |
| Dryer not heating, in Spanish | Marisol Ortega | 66 Orchard Lane | Dryer: not heating | routine | Spanish | caller ID, masked | 792 / 82 |

Both were filed with `source: bedrock` (no fallback to rules), and both callers' text backs were written: an emergency promise of a call back in English, and the first opening in Spanish. The transcripts held no part of the greeting, because recording starts after it. At Nova Lite's on-demand price the two extractions cost well under a hundredth of a cent; the calls' Connect, telephony and Transcribe minutes cost a few cents in all.
