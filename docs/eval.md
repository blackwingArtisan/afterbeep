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
