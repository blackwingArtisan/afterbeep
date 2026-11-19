# Judge's map

Where to find the proof for each submission check and each judging criterion. Every row links to the file, number or screen that backs it. Numbers come from `npm run check`, `npm run test:e2e`, `npm run spec:coverage` and `npm run eval` on a fresh clone.

## Submission checks

| Check | Where to look |
|---|---|
| A working app | `npm ci && npm run build && npm start`, then http://localhost:3111. Runs with no accounts or keys; every external service has a free local adapter ([src/adapters/index.ts](../src/adapters/index.ts)). Steps in the [README](../README.md#try-it-in-60-seconds). |
| Open source license | [LICENSE](../LICENSE), MIT, at the repository root. |
| `/.kiro` at the root | [.kiro/](../.kiro): 6 steering files, 2 specs, 6 hooks, pinned MCP settings and a tracked custom agent, [.kiro/agents/afterbeep-builder.json](../.kiro/agents/afterbeep-builder.json). Not ignored by git. |
| Demo video | Under 3 minutes, following the beat sheet in [.kiro/steering/demo.md](../.kiro/steering/demo.md). Linked from the README. |
| How Kiro was used | [KIRO-LOG.md](../KIRO-LOG.md): a feature checklist with proof links, how Kiro and the coding assistant split the work (it matches `git log`), a "Caught by Kiro" table and a record of each Kiro session. |

## Judging criteria

### Potential value

| Claim | Proof |
|---|---|
| Plain voicemail loses 69% of callers | Cited on the landing page and in [docs/business.md](business.md), with sources |
| A missed job is worth about $206 to $377 | Thumbtack cost guides, cited in [docs/business.md](business.md) |
| The market: 362,219 solo building-equipment contractors, about $170M a year at stake | US Census nonemployer statistics, [docs/business.md](business.md) |
| It pays for itself: about $740 a month, 18 times the $39 price, under labelled assumptions | [src/domain/payback.ts](../src/domain/payback.ts), tested in [tests/unit/domain-payback.test.ts](../tests/unit/domain-payback.test.ts), interactive on the landing page |
| Morgan's Tuesday: 2 jobs booked, $557 of booked work ($377 quoted + $180 billed), $35 caught, 14 times the price | A labelled scenario; after "Demo the whole story" the inbox shows these exact numbers ([tests/e2e/whole-story.spec.ts](../tests/e2e/whole-story.spec.ts)) |
| About $0.074 per call on AWS, 80% gross margin at 50 calls a month | Unit economics in [docs/business.md](business.md) |
| Why not Live Voicemail, Google Voice, Jobber, Housecall Pro, GoHighLevel, Podium, ServiceTitan or an AI receptionist | Competitor table with prices checked live, in [docs/business.md](business.md#why-not-live-voicemail-google-voice-jobber-housecall-pro-gohighlevel-podium-servicetitan-or-an-ai-receptionist) and the README |
| A business, not just a feature: lifetime value, acquisition cost, 2,140 customers for $1M a year, a 12-month plan | [docs/business.md](business.md#startup-math), every input labelled as an assumption |

### Technical implementation

| Claim | Proof |
|---|---|
| The real phone path as infrastructure as code: an S3 recordings bucket, the hand-off Lambda with a dead-letter queue, and a least-privilege server policy, validated in CI | [infra/template.yaml](../infra/template.yaml), [infra/connect/README.md](../infra/connect/README.md) |
| Ports and adapters with free local defaults; AWS (Connect, Transcribe, Bedrock, End User Messaging) and Stripe behind environment variables | [src/adapters/](../src/adapters), [.kiro/steering/aws-adapters.md](../.kiro/steering/aws-adapters.md) |
| All money in integer cents; the server sends an invoice only when its recomputed total equals the exact total the owner approved | [src/domain/money.ts](../src/domain/money.ts), [src/server/services/invoicing.ts](../src/server/services/invoicing.ts), [.kiro/steering/money.md](../.kiro/steering/money.md) |
| The price check: "dryer belt, fifteen" is held when the usual price is $50 (more than 15% under or 25% over) | [src/domain/price-book.ts](../src/domain/price-book.ts) |
| Bedrock is forced to answer through one tool, and any number or address the caller never said is dropped; a failure falls back to the rules and records why | [src/adapters/extractor/bedrock.ts](../src/adapters/extractor/bedrock.ts) |
| 188 Vitest unit and API tests, 22 Playwright tests against the production build (desktop and Pixel 7) | `npm run check`, `npm run test:e2e`, CI in [.github/workflows/check.yml](../.github/workflows/check.yml) |
| 113 EARS criteria; 109 are named by test titles and the build fails if one is not, the other 4 are on the real AWS and Stripe path | `npm run spec:coverage`, [scripts/spec-coverage.ts](../scripts/spec-coverage.ts) |
| The extractor is measured, not assumed: on its first, held-out run over 24 labelled voicemails it got every phone number and address right and invented no address | [docs/eval.md](eval.md), `npm run eval` |

### Quality of the idea

| Claim | Proof |
|---|---|
| A resurrection of three dead machines: the answering machine, the Dictaphone and the carbon-copy invoice book | README "What died", the landing page and the three machine keys in the app |
| The machine that hears fifteen and knows you meant fifty | The carbon copies hold a misheard price against the owner's own past invoices: landing page **Bill** key, and step 5 of the whole story |
| Spanish callers get a Spanish text back, while the owner reads English | [src/domain/spanish.ts](../src/domain/spanish.ts), spec MC 3.10 and 4.9 |
| Raise the dead: callers who hang up without a word are not lost | The graveyard in the inbox; one owner press texts each a single booking link ([src/domain/graveyard.ts](../src/domain/graveyard.ts), spec MC 8) |

### Design

| Claim | Proof |
|---|---|
| A 1980s answering-machine identity: cassette tapes, a seven-segment counter, LCD readouts, rubber keys, carbon copies and stamps | Screens in the [README](../README.md#screens) and [docs/screens/](screens) |
| Two themes ("Graveyard shift" and "Daylight") | Theme switch in the header |
| Built for a phone first: the caller's booking page, a one-row machine header and a bottom key bar | [tests/e2e/caller.spec.ts](../tests/e2e/caller.spec.ts) runs on a Pixel 7 profile |
| Motion is optional: the landing machine never plays itself and the graveyard never moves under reduced motion | Tests `[MC 7.9]` and `[MC 8.7]` |

### Presentation

| Claim | Proof |
|---|---|
| A one-press guided demo: "Demo the whole story" runs a missed call through booking, a spoken invoice, payment and raising the dead | Landing page and machine header |
| A 15-second GIF of the whole flow | [docs/demo.gif](demo.gif) at the top of the README |
| A 60-second demo script | [.kiro/steering/demo.md](../.kiro/steering/demo.md) |
