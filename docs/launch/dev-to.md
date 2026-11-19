---
title: "The machine that hears fifteen and knows you meant fifty"
tags: kiro, aws, typescript, hackathon
---

# The machine that hears fifteen and knows you meant fifty

Say "dryer belt, fifteen" into your phone. Speech-to-text writes $15. You meant $50. If you are a one-person appliance shop billing from the truck, you just lost $35, and you will never notice.

AfterBeep is my Kiroween 2026 entry: an answering machine, a Dictaphone and a carbon-copy invoice book for one-person trade businesses, brought back from the dead. This post is about the engineering choices that keep a voice-driven invoice honest.

## 1. Code does the math, in integer cents

Every amount in AfterBeep is an integer number of cents. Quantities are multiplied as hundredths, a line is rounded half away from zero to the cent, and tax is applied once to the sum of taxable lines, never line by line. No floating-point sum ever touches money. A Kiro steering file states these rules, and it loads automatically whenever a file in `src/domain/` is open, so the rules are in context exactly when they matter.

## 2. The server only sends the total you approved

The owner approves a total on screen. The server recomputes it from the lines and refuses to send unless the two match exactly. A client cannot inject a total, and a bug in the client cannot change what the customer is charged.

## 3. The carbon copies

Every sent invoice becomes history. When a new line is more than 15% under or 25% over what you usually charge for that item, the invoice is held and the owner picks: the heard price, or the usual one. "Twelve fifty" could be $12.50 or $1,250; for a water heater, history picks $1,250, and "forty gallon" stays a size, not a quantity of forty.

## 4. A model may only report what the caller said

When Amazon Bedrock reads a voicemail, it must answer through one forced tool with a validated schema. Then every phone number and address is checked against the transcript; anything the caller never said is dropped. Any failure falls back to deterministic rules, and the reason is recorded. On 24 held-out voicemails, the rules alone got every phone number and address right.

## 5. Specs that fail the build

Two EARS specs hold 119 criteria. Every test title names the criteria it proves, like `[VI 3.4]`, and a script fails CI when a criterion has no test. Kiro's spec review found four behaviors the code had that the specs did not describe.

## Try it

The whole thing runs locally with no accounts: `npm ci && npm run build && npm start`, then press **Demo the whole story**.
