# Kiro log

How Kiro is set up in this repository, what Kiro itself did, and what the coding assistant did. Every claim below can be checked against `git log` and the linked files.

## At a glance

| Kiro feature | Used here | Proof |
|---|---|---|
| Specs (requirements, design, tasks) | Yes: 2 specs, 114 EARS criteria, every task checked off | [.kiro/specs/](.kiro/specs); `npm run spec:coverage` fails CI if a criterion has no test (110 of 114 traced, 4 on the real-service path) |
| Steering, always included | Yes: 3 files | [product.md](.kiro/steering/product.md), [tech.md](.kiro/steering/tech.md), [structure.md](.kiro/steering/structure.md) |
| Steering, file match | Yes: 2 files | [money.md](.kiro/steering/money.md) loads with `src/domain/**`, [aws-adapters.md](.kiro/steering/aws-adapters.md) with `src/adapters/**` |
| Steering, manual | Yes: 1 file | [demo.md](.kiro/steering/demo.md), included with `#demo` |
| Hooks, file save | Yes: 4 | [test-on-save](.kiro/hooks/test-on-save.json), [money-guard](.kiro/hooks/money-guard.json), [spec-sync](.kiro/hooks/spec-sync.json), [copy-tone](.kiro/hooks/copy-tone.json) |
| Hooks, agent stop | Yes: 2 | [typecheck-on-stop](.kiro/hooks/typecheck-on-stop.json), [demo-readiness](.kiro/hooks/demo-readiness.json) |
| Custom agent with its own hooks | Yes: 1 agent, 3 hooks | [.kiro/agents/afterbeep-builder.json](.kiro/agents/afterbeep-builder.json): steering as resources, a PreToolUse guard, tests after every source write |
| MCP servers | Yes: 2, pinned to exact versions | [.kiro/settings/mcp.json](.kiro/settings/mcp.json): `awslabs.aws-documentation-mcp-server@1.2.4`, `@upstash/context7-mcp@4.5.0` |
| Spec-driven work | Yes | Both features were built task by task from their `tasks.md` (by Claude Code, see below); each task names its criteria |
| Vibe coding in Kiro chat | Not yet | Copy and design passes were done by Claude Code against `product.md` |
| Kiro sessions (kiro-cli) | 2 so far | [Sessions](#sessions) below; session 2 is commit `22a9c64` |

The hook files use Kiro's standalone JSON hook format (`version`, `hooks[]` with `trigger`, `matcher` and an `agent` or `command` action), described at https://kiro.dev/docs/hooks/. The custom agent uses the inline hook form from https://kiro.dev/docs/custom-agents/configuration-reference/.

## How Kiro and the coding assistant split the work

This repository was built by one developer working with two AI tools. `git log` shows it plainly: all 32 commits so far carry a `Co-Authored-By: Claude` trailer, because Claude Code, a coding assistant, wrote most of the code and documents. Kiro's part is different in kind.

| Who | What they did | Where it shows |
|---|---|---|
| **Kiro (the configuration)** | The rules every agent in this repo works under: steering that loads with the files it governs, specs in Kiro's EARS format, hooks on save and on stop, MCP servers, and a custom agent that blocks unsafe writes | `.kiro/` |
| **Kiro (kiro-cli sessions)** | Session 2 reviewed both specs against the code, found four built behaviors with no criterion and wrote them, and rewrote two hooks to the canonical format | Commit `22a9c64`, "Kiro pass: spec criteria for four built behaviors, canonical hooks" |
| **Claude Code (coding assistant)** | Wrote the specs in Kiro's format, then the code, tests and docs task by task against the Kiro steering and specs, keeping each test title tied to the criteria it proves | Every other commit |
| **The developer** | Product decisions, review and every commit | Commit author on all 32 commits |

**Next:** the remote retrieval feature (call your own machine from the truck, play messages with the keypad, then say the invoice) is planned as a spec that kiro-cli writes and builds itself under `afterbeep-builder`, one commit per task with a `Built-with: Kiro` trailer and session excerpts in `docs/kiro-sessions/`. It has not been run yet.

## Feature map

| Kiro feature | How AfterBeep uses it | Files | Written by |
|---|---|---|---|
| Steering, always included | Product rules (nothing is sent without the owner's approval, cited figures only), stack and engineering rules, file layout | `.kiro/steering/product.md`, `tech.md`, `structure.md` | Claude Code, before the first feature, so every later task was planned against them |
| Steering, file match | Money rules load when a domain file is open; adapter and AWS rules load when an adapter is open | `.kiro/steering/money.md`, `aws-adapters.md` | Claude Code |
| Steering, manual | The 60-second demo script, included with `#demo` | `.kiro/steering/demo.md` | Claude Code |
| Specs | Two features as EARS requirements, design and task lists: 68 criteria for missed-call booking and 46 for voice invoicing | `.kiro/specs/missed-call-booking/`, `.kiro/specs/voice-invoicing/` | Claude Code in Kiro's spec format; Kiro (session 2) added four criteria and their tasks |
| Spec traceability | Every test title names the criteria it proves, such as `[VI 3.4]`; `npm run spec:coverage` fails when a criterion has no test | `scripts/spec-coverage.ts` | Claude Code |
| Hooks: file save | Run the unit tests on any source save; restate the money rules and ask for a test when money code changes; keep specs in step with server code; review screen copy | `.kiro/hooks/test-on-save.json`, `money-guard.json`, `spec-sync.json`, `copy-tone.json` | `test-on-save` and `money-guard` rewritten to the canonical format by Kiro (session 2); the other two by Claude Code |
| Hooks: agent stop | Type-check the project; check spec coverage and the production build before work is handed back | `.kiro/hooks/typecheck-on-stop.json`, `demo-readiness.json` | Claude Code |
| Custom agent | `afterbeep-builder`: loads the steering, pins both MCP servers, blocks writes to `.env` files, live Stripe keys and float money in `src/domain`, and runs the unit tests after each source write | `.kiro/agents/afterbeep-builder.json`, `scripts/kiro/guard-write.mjs`, `scripts/kiro/test-after-write.mjs` | Claude Code |
| MCP servers | AWS documentation for the Connect, Transcribe, Bedrock and End User Messaging adapters; Context7 for library docs | `.kiro/settings/mcp.json` | Claude Code |

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

The IDE file-save hooks run inside the Kiro IDE. No IDE firing has been recorded yet; a screen recording of the money guard firing on save is planned for the demo video.

## Sessions

### Session 1: write both specs (kiro-cli, non-interactive)
Kiro read the steering files and hooks, planned the work and composed the requirements, but non-interactive mode could not approve file writes, and a retry was throttled by the service. No file was written. Claude Code then wrote both specs in Kiro's format against the same steering, and built them task by task.

### Session 2: review the specs against the code (kiro-cli v3, file tools only)
Kiro read every file under `src/`, the seed, the adapters, the client pages and the tests, and compared the behavior with both specs. Every task already checked off was confirmed as implemented and tested. It found four behaviors the specs did not describe and added an EARS criterion and a done task for each (the first four rows of "Caught by Kiro"). It also rewrote `test-on-save.json` and `money-guard.json` to the canonical hook format, checked against the Kiro hooks documentation, and paused `typecheck-on-stop.json`, which has since been turned back on.

## Lessons
- Give kiro-cli write trust up front (`--trust-all-tools`, or the exact tool names it reports) and run one task per call; non-interactive mode cannot approve writes, and spaced calls stay under the rate limit.
- Put the guard rails in a tracked custom agent, not in a prompt, so every session gets them and a judge can read them.
