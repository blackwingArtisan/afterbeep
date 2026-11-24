# Kiro log

How Kiro is set up in this repository, what Kiro itself did, and what the coding assistant did. Every claim below can be checked against `git log` and the linked files.

## What Kiro built: remote retrieval

The remote retrieval feature was specified and built by Kiro through its spec workflow, in eight kiro-cli sessions under the `afterbeep-builder` agent: five for the call script, the routes, the keypad screen and the Connect flow, then three for the phone path (the turn Lambda and the caller-ID way in). The owner calls their own machine from the truck, keys the code 4-2-7, hears "You have N new messages", presses 1 to play, 2 to text the caller the booking link, 9 twice to erase and # for the next, then hears "After the beep, say your invoice." Try it at `/machine/remote`.

| Session | What Kiro did | Commit | Time | Credits |
|---|---|---|---|---|
| [3](docs/kiro-sessions/session-3-remote-retrieval-spec.md) | Wrote requirements.md (83 EARS criteria, RR 1.1 to 13.6), design.md and tasks.md (25 tasks). Searched and read the Amazon Connect keypad-input pages with the `aws-docs` MCP server first (10 calls) and cited them | `a502190` | 6 min | 7.9 |
| [4](docs/kiro-sessions/session-4-call-script.md) | Tasks 1 to 8: the pure call script `src/domain/remote-retrieval.ts` and 57 unit tests, including a seeded random-key run | `c8a4ad4` | 6 min | 5.0 |
| [5](docs/kiro-sessions/session-5-remote-routes.md) | Tasks 9 to 14: the remote code check with lockout, soft erase, `src/server/services/remote.ts` and three `/api/remote/*` routes, 34 tests | `1db8377` | 5 min | 5.4 |
| [6](docs/kiro-sessions/session-6-keypad-simulation.md) | Tasks 15 to 20: DTMF tones, the Keypad component, the Remote screen, the hand-off to the voice invoice draft, Playwright and unit tests | `c03f105` | 13 min | 9.0 |
| [7](docs/kiro-sessions/session-7-connect-flow.md) | Tasks 21 to 25: `infra/connect/remote-retrieval-flow.json` and its parse test, the RR prefix in `spec:coverage` with tests for every remaining criterion, steering updates | `3a6db4b` | 30 min, stopped at the limit | 10.3, two attempts |
| [8](docs/kiro-sessions/session-8-phone-path-spec.md) | Extended the spec for the phone path: 41 new criteria (RR 14.1 to 16.8), a design section and tasks 26 to 41. Read the Connect Lambda, contact-attribute, UpdateContactAttributes, TransferToFlow and Compare pages with the `aws-docs` MCP server first (15 calls) | `b89ff30` | 7 min | 11.6 |
| [9](docs/kiro-sessions/session-9-turn-lambda.md) | Tasks 26 to 36: `infra/connect/remote-turn.ts`, the Lambda Connect calls on every turn. It runs the shared `step()`, keeps the call state in a contact attribute that holds only ids, urgency and a can-text flag, calls the existing routes with the bearer secret inside a 5-second budget, and never throws. 54 unit tests with a fake fetch | `b89ff30` | 7 min | 10.2 |
| [10](docs/kiro-sessions/session-10-flows-and-readme.md) | Tasks 37 to 41: the caller-ID check at the start of the voicemail flow, state saving, `*` and a code retry in the remote flow, the owner's decision in `infra/connect/README.md`, and spec coverage back to green | `b89ff30` | 3 min | 4.2 |

Together the eight sessions used 63.6 credits, including the stopped first attempt of session 7, and about 77 minutes.

**Who wrote the lines.** Sessions 3 to 7 added about 3,300 lines across the spec, the code, the tests and the Connect flow; sessions 8 to 10 added 2,256 more and removed 45, among them the 527-line Lambda, its 955 lines of tests and 283 lines of spec. Claude Code changed 23 lines of Kiro's files (17 added, 6 removed): a layout fix in `74aaa20` and one import line in the remote Playwright spec in `c03f105` (below), and one sentence in `infra/connect/README.md` that still said the owner speaks an invoice on the phone, which the new design rules out. Claude Code also ran the shell between sessions (installs, the full test suites, fresh-clone checks), made the commits, and copied each session's output into `docs/kiro-sessions/`.

**Fixed after Kiro.** On review, Kiro's transcript gave each line its speaker as a bare class, and `machine` matched the app layout's `.machine` rule (`min-height: 100vh`), so each prompt was a full screen tall. Claude Code prefixed the classes, made the transcript scroll to the newest line, and added a Playwright check that fails without the fix (`74aaa20`, 15 lines added, 4 removed). Separately, fresh-clone runs showed the long remote test timing out while every screen was right: the browser's speechSynthesis waits on the operating system's voice service, which stalled headless Chrome for about 15 seconds per prompt on a busy machine. Claude Code added `tests/e2e/fixtures.ts`, a stand-in voice with realistic timing for every end-to-end test (`397ec4a`), and changed the import line of Kiro's remote spec to use it.

**The phone path.** The owner reaches the remote menu by calling the business number from their own phone: the voicemail flow matches the caller ID and hands the call to the remote flow, which still asks for the 3-digit code. There is no second number, and caller ID only routes the call; the code stays the only gate. Kiro found two gaps in the earlier flow while writing the spec: the menu had no `*` branch, so "repeat" would have said "That key does nothing here", and the router had no way to ask for the code again after a wrong code (RR 16.3, 16.4). It also flagged that the Connect docs say string-map answers allow only letters, digits, dash and underscore while their own example returns `$1000`, and kept the state attribute to base64url so it fits either reading. Besides the unit tests, Claude Code bundled the Lambda with the esbuild command in `infra/connect/README.md` and drove a whole call through it against a local AfterBeep server: code 4-2-7, play, text back, next, erase with 9 9, and the closing line.

**Deployed (Claude Code, November 24).** Both flows and the turn Lambda now run on the demo line, deployed by `scripts/deploy-phone.ts`. Connect's own validator caught two things the parse tests could not: a stored keypad input may not have a timeout branch (a timeout takes the success branch with no digits, which the Lambda already read as silence), and a Transfer to flow action needs a next action. Claude Code fixed both in Kiro's flows, changed criteria 13.6 and 16.7 from "not deployed" to "say whether it is deployed", added the call gate (call caps, masked caller numbers, a start stamp the turn Lambda uses to end long calls) and `*` during the greeting, and invoked the deployed turn Lambda against the live demo: code 4-2-7 answered "You have 3 new messages", `#` moved to message 2, and a call past the time limit was ended. On real calls Connect accepted the call gate's string-map answer, a + sign in the number included; the turn Lambda's spoken prompts use the same response type but have not yet been through a real call. A phone call cannot leave an invoice draft behind; the phone path says so and ends the call. Kiro's closing text in sessions 8 to 10 refers to "hook output" from `spec:coverage`, but kiro-cli does not print hook output, so no hook firing is claimed here.

## At a glance

| Kiro feature | Used here | Proof |
|---|---|---|
| Specs (requirements, design, tasks) | Yes: 3 specs, 243 EARS criteria, every task checked off | [.kiro/specs/](.kiro/specs); `npm run spec:coverage` fails CI if a criterion has no test (239 of 243 traced, 4 on the real-service path). The remote-retrieval spec (124 criteria, 41 tasks) was written by Kiro |
| Steering, always included | Yes: 3 files | [product.md](.kiro/steering/product.md), [tech.md](.kiro/steering/tech.md), [structure.md](.kiro/steering/structure.md) |
| Steering, file match | Yes: 2 files | [money.md](.kiro/steering/money.md) loads with `src/domain/**`, [aws-adapters.md](.kiro/steering/aws-adapters.md) with `src/adapters/**` |
| Steering, manual | Yes: 1 file | [demo.md](.kiro/steering/demo.md), included with `#demo` |
| Hooks, file save | Yes: 4 | [test-on-save](.kiro/hooks/test-on-save.json), [money-guard](.kiro/hooks/money-guard.json), [spec-sync](.kiro/hooks/spec-sync.json), [copy-tone](.kiro/hooks/copy-tone.json) |
| Hooks, agent stop | Yes: 2 | [typecheck-on-stop](.kiro/hooks/typecheck-on-stop.json), [demo-readiness](.kiro/hooks/demo-readiness.json) |
| Custom agent with its own hooks | Yes: 1 agent, 3 hooks | [.kiro/agents/afterbeep-builder.json](.kiro/agents/afterbeep-builder.json): steering as resources, a PreToolUse guard, tests after every source write. All eight remote-retrieval sessions ran under it; kiro-cli 3.5.0 upgraded it to the v3 permissions format itself (`6d3b0e9`) |
| MCP servers | Yes: 3; the two from registries pinned to exact versions, plus the project's own | [.kiro/settings/mcp.json](.kiro/settings/mcp.json): `awslabs.aws-documentation-mcp-server@1.2.4`, `@upstash/context7-mcp@4.5.0`, and [scripts/mcp/afterbeep-mcp.ts](scripts/mcp/afterbeep-mcp.ts) (`spec_coverage`, `price_book_lookup`, `check_greeting`). Session 3 made 10 `aws-docs` calls for the Connect keypad design and session 8 made 15 for the turn Lambda; no session has called Context7 or the afterbeep server yet |
| Spec-driven work | Yes | Remote retrieval, including the phone Lambda, was specified and built by Kiro, task by task. The first two features were built task by task from their `tasks.md` by Claude Code (see below). Each task names its criteria |
| Vibe coding in Kiro chat | Not yet | Copy and design passes were done by Claude Code against `product.md` |
| Kiro sessions (kiro-cli) | 10 so far | [Sessions](#sessions) below; sessions 3 to 10 built remote retrieval, with prompts and output in [docs/kiro-sessions/](docs/kiro-sessions) |

The hook files use Kiro's standalone JSON hook format (`version`, `hooks[]` with `trigger`, `matcher` and an `agent` or `command` action), described at https://kiro.dev/docs/hooks/. The custom agent uses the inline hook form from https://kiro.dev/docs/custom-agents/configuration-reference/.

## How Kiro and the coding assistant split the work

This repository was built by one developer working with two AI tools. `git log` shows it plainly: every commit carries a `Co-Authored-By: Claude` trailer, and Kiro's commits also carry a `Built-with: Kiro` trailer. Claude Code, a coding assistant, wrote most of the code for the first two features (missed-call booking and voice invoicing). Kiro specified and built the third, remote retrieval.

| Who | What they did | Where it shows |
|---|---|---|
| **Kiro (the configuration)** | The rules every agent in this repo works under: steering that loads with the files it governs, specs in Kiro's EARS format, hooks on save and on stop, MCP servers, and a custom agent that blocks unsafe writes | `.kiro/` |
| **Kiro (kiro-cli sessions)** | Sessions 3 to 7 wrote the remote-retrieval spec and built all 25 of its tasks: the call script, the routes, the keypad screen, the Connect flow and their tests. Sessions 8 to 10 extended the spec for the phone path and built tasks 26 to 41: the turn Lambda, the caller-ID way in and the flow changes. Session 2 reviewed the first two specs against the code, found four built behaviors with no criterion and wrote them, and rewrote two hooks to the canonical format | `a502190`, `c8a4ad4`, `1db8377`, `c03f105`, `3a6db4b`, `b89ff30`; `22a9c64` |
| **Claude Code (coding assistant)** | Wrote the first two specs in Kiro's format, then their code, tests and docs task by task against the Kiro steering and specs. For remote retrieval: ran the shell and the test suites, made the commits, fixed one layout bug, and added the stand-in voice for the end-to-end tests | Every other commit; `74aaa20` and `397ec4a` |
| **The developer** | Product decisions, review and every commit | Commit author on every commit |

Remote retrieval, described at the top of this file, is the first feature Kiro built end to end.

## Feature map

| Kiro feature | How AfterBeep uses it | Files | Written by |
|---|---|---|---|
| Steering, always included | Product rules (nothing is sent without the owner's approval, cited figures only), stack and engineering rules, file layout | `.kiro/steering/product.md`, `tech.md`, `structure.md` | Claude Code, before the first feature, so every later task was planned against them |
| Steering, file match | Money rules load when a domain file is open; adapter and AWS rules load when an adapter is open | `.kiro/steering/money.md`, `aws-adapters.md` | Claude Code |
| Steering, manual | The 60-second demo script, included with `#demo` | `.kiro/steering/demo.md` | Claude Code |
| Specs | Three features as EARS requirements, design and task lists: 73 criteria for missed-call booking, 46 for voice invoicing and 124 for remote retrieval | `.kiro/specs/missed-call-booking/`, `.kiro/specs/voice-invoicing/`, `.kiro/specs/remote-retrieval/` | Remote retrieval: Kiro (sessions 3 and 8), built by Kiro (sessions 4 to 7, 9 and 10). The other two: Claude Code in Kiro's spec format; Kiro (session 2) added four criteria and their tasks |
| Spec traceability | Every test title names the criteria it proves, such as `[VI 3.4]` or `[RR 2.3]`; `npm run spec:coverage` fails when a criterion has no test | `scripts/spec-coverage.ts` | Claude Code; Kiro added the RR prefix (session 7) |
| Hooks: file save | Run the unit tests on any source save; restate the money rules and ask for a test when money code changes; keep specs in step with server code; review screen copy | `.kiro/hooks/test-on-save.json`, `money-guard.json`, `spec-sync.json`, `copy-tone.json` | `test-on-save` and `money-guard` rewritten to the canonical format by Kiro (session 2); the other two by Claude Code |
| Hooks: agent stop | Type-check the project; check spec coverage and the production build before work is handed back | `.kiro/hooks/typecheck-on-stop.json`, `demo-readiness.json` | Claude Code |
| Custom agent | `afterbeep-builder`: loads the steering and all three MCP servers, blocks writes to `.env` files, live Stripe keys and float money in `src/domain`, and runs the unit tests after each source write | `.kiro/agents/afterbeep-builder.json`, `scripts/kiro/guard-write.mjs`, `scripts/kiro/test-after-write.mjs` | Claude Code |
| MCP servers | AWS documentation for the Connect, Transcribe, Bedrock and End User Messaging adapters, used by Kiro in sessions 3 and 8 for the Connect keypad design and the turn Lambda; Context7 for library docs; the project's own server so an agent can check spec coverage, look up the usual price of an item and check a greeting without leaving the session | `.kiro/settings/mcp.json`, `scripts/mcp/afterbeep-mcp.ts` | Claude Code |

## Caught by Kiro

Each time a Kiro review or hook stopped a mistake or filled a gap. Only events that really ran are listed, and the "Ran in" column says where.

| Date | What fired | File | What it caught | Ran in | Commit |
|---|---|---|---|---|---|
| 2026-11-16 | Spec review (kiro-cli session 2) | `.kiro/specs/voice-invoicing/requirements.md` | The 14-day due date was built and shown but had no criterion: added VI 5.6 | kiro-cli | `22a9c64` |
| 2026-11-16 | Spec review (kiro-cli session 2) | `.kiro/specs/voice-invoicing/requirements.md` | The title falls back to the job's description: added VI 4.9 | kiro-cli | `22a9c64` |
| 2026-11-16 | Spec review (kiro-cli session 2) | `.kiro/specs/missed-call-booking/requirements.md` | The caller can correct the visit address: added MC 5.9 | kiro-cli | `22a9c64` |
| 2026-11-16 | Spec review (kiro-cli session 2) | `.kiro/specs/missed-call-booking/requirements.md` | With no open time in two weeks, the caller is asked to call: added MC 5.10 | kiro-cli | `22a9c64` |
| 2026-11-16 | Hook format check (kiro-cli session 2) | `.kiro/hooks/test-on-save.json`, `money-guard.json` | Both hooks rewritten to the canonical format | kiro-cli | `22a9c64` |
| 2026-11-18 | `afterbeep-builder` PreToolUse guard | `.env` | A write to `.env` blocked with exit code 2 and the reason sent back to the agent; live keys and float money blocked the same way | The guard script fed Kiro's PreToolUse event by hand, and by `tests/unit/kiro-guard.test.ts` in CI; not yet inside a kiro-cli session | `dceca4d` |
| 2026-11-19 | Spec writing (kiro-cli session 3) | `.kiro/specs/remote-retrieval/requirements.md` | A stray 9 while driving would erase a customer's message: Kiro made erase ask for a second 9 (RR 6.1) | kiro-cli | `a502190` |
| 2026-11-19 | Spec writing (kiro-cli session 3) | `.kiro/specs/remote-retrieval/requirements.md` | A 3-digit code from a spoofable caller ID can be guessed: Kiro added a per-business lockout after five wrong codes and kept the code out of every API response (RR 2.3, 2.4) | kiro-cli | `a502190` |
| 2026-11-19 | Build (kiro-cli session 5) | `src/domain/graveyard.ts` | Erased hang-ups would still rise in the graveyard: Kiro made the graveyard skip them | kiro-cli | `1db8377` |
| 2026-11-19 | Spec writing (kiro-cli session 8) | `infra/connect/remote-retrieval-flow.json` | The menu had no `*` branch, so "repeat" on a phone would have answered "That key does nothing here": Kiro added it (RR 16.4) | kiro-cli | `b89ff30` |
| 2026-11-19 | Spec writing (kiro-cli session 8) | `infra/connect/remote-retrieval-flow.json` | After a wrong code the flow had no route back to the code prompt: Kiro added a `code` branch with its own keypad input (RR 16.3) | kiro-cli | `b89ff30` |
| 2026-11-19 | Spec writing (kiro-cli session 8) | `.kiro/specs/remote-retrieval/design.md` | Transcripts, names and jobs would have been copied into Connect contact attributes: Kiro kept only ids, urgency and a can-text flag there and fetches the words each turn (RR 14.8) | kiro-cli | `b89ff30` |

The IDE file-save hooks run inside the Kiro IDE. No IDE firing has been recorded yet; a screen recording of the money guard firing on save is planned for the demo video.

## Sessions

### Session 1: write both specs (kiro-cli, non-interactive)
Kiro read the steering files and hooks, planned the work and composed the requirements, but non-interactive mode could not approve file writes, and a retry was throttled by the service. No file was written. Claude Code then wrote both specs in Kiro's format against the same steering, and built them task by task.

### Sessions 3 to 10: specify and build remote retrieval (kiro-cli v3, agent `afterbeep-builder`)
Each session was one non-interactive call, `kiro-cli chat --v3 --no-interactive --trust-workspace --agent afterbeep-builder --trust-tools=fs_read,fs_write,run_command,@aws-docs,@context7,@afterbeep "<prompt>"`, with a 25-minute limit. The exact prompts, durations, credits and Kiro's own output are in [docs/kiro-sessions/](docs/kiro-sessions), and the table at the top of this file lists them. Kiro ran typecheck, Vitest and Playwright itself with its shell tool; Claude Code ran them again, plus a fresh-clone check, before each commit.

### Session 2: review the specs against the code (kiro-cli v3, file tools only)
Kiro read every file under `src/`, the seed, the adapters, the client pages and the tests, and compared the behavior with both specs. Every task already checked off was confirmed as implemented and tested. It found four behaviors the specs did not describe and added an EARS criterion and a done task for each (the first four rows of "Caught by Kiro"). It also rewrote `test-on-save.json` and `money-guard.json` to the canonical hook format, checked against the Kiro hooks documentation, and paused `typecheck-on-stop.json`, which has since been turned back on.

## Lessons
- Give kiro-cli write trust up front with the exact tools (`--trust-tools=fs_read,fs_write,run_command` plus `@server` names for MCP), not `--trust-all-tools`; non-interactive mode cannot approve writes.
- Group a spec's tasks into calls of 5 to 15 minutes each (one layer per call: domain, server, client, infrastructure) and commit between calls; spaced calls stayed under the rate limit.
- Check for an MCP server in Kiro's output before relying on it: `aws-docs` loaded in session 3 but not in session 7, and Kiro said so.
- Put the guard rails in a tracked custom agent, not in a prompt, so every session gets them and a judge can read them.
