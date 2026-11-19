# Kiro log

How Kiro is set up in this repository, and what each Kiro session did. Each row says who wrote the file, so the record stays exact.

## Feature map

| Kiro feature | How AfterBeep uses it | Files | Written by |
|---|---|---|---|
| Steering, always included | Product rules (nothing is sent without the owner's approval, cited figures only), stack and engineering rules, file layout | `.kiro/steering/product.md`, `tech.md`, `structure.md` | By hand, before any Kiro session, so Kiro planned against them |
| Steering, file match | Money rules load when a domain file is open; adapter and AWS rules load when an adapter is open | `.kiro/steering/money.md`, `aws-adapters.md` | By hand |
| Steering, manual | The 60-second demo script, included with `#demo` | `.kiro/steering/demo.md` | By hand |
| Specs | Two features as EARS requirements, design and task lists: 57 criteria for missed-call booking and 44 for voice invoicing | `.kiro/specs/missed-call-booking/`, `.kiro/specs/voice-invoicing/` | Drafted by hand in Kiro's spec format; Kiro reviewed them against the code and added four criteria (below) |
| Spec traceability | Every test title names the criteria it proves, such as `[VI 3.4]`; `npm run spec:coverage` fails when a criterion has no test | `scripts/spec-coverage.ts` | By hand |
| Hooks: file save | Run the unit tests on any source save; restate the money rules and ask for a test when money code changes; keep specs in step with server code; review screen copy | `.kiro/hooks/test-on-save.json`, `money-guard.json`, `spec-sync.json`, `copy-tone.json` | `test-on-save` and `money-guard` rewritten to the v1 format by Kiro; the other two by hand |
| Hooks: agent stop | Type-check the project; check spec coverage and the production build before work is handed back | `.kiro/hooks/typecheck-on-stop.json`, `demo-readiness.json` | By hand |
| MCP servers | AWS documentation for the Connect, Transcribe, Bedrock and End User Messaging adapters; Context7 for library docs | `.kiro/settings/mcp.json` | By hand |

## Sessions

### Session 1: write both specs (kiro-cli, non-interactive)
Kiro was asked to read the steering files and write both specs as requirements, design and tasks. It read the steering files and hooks, planned the work and composed the requirements, but the session could not approve file writes in non-interactive mode, and a retry with the v2 agent was throttled by the service. No file was written. The specs were then drafted by hand in Kiro's format against the same steering, and built task by task.

### Session 2: review the specs against the code (kiro-cli, non-interactive, file tools only)
Kiro read every file under `src/`, the seed, the adapters, the client pages and the tests, and compared the behavior with both specs. Every task already checked off was confirmed as implemented and tested. It found four behaviors the specs did not describe and added an EARS criterion and a done task for each:

| Added | Behavior |
|---|---|
| Voice invoicing Req 5.6 | An invoice is due 14 days after its date, and the customer page shows the due date |
| Voice invoicing Req 4.9 | An invoice with no spoken title takes the booked job's description |
| Missed-call Req 5.9 | The caller can confirm or correct the visit address, and that address goes on the job |
| Missed-call Req 5.10 | With no open time in the next two weeks, the caller is asked to call the business |

In the same session Kiro rewrote `test-on-save.json` and `money-guard.json` to the canonical v1 hook format, checked against the Kiro hooks documentation, and paused `typecheck-on-stop.json` with `enabled: false`. That hook has since been turned back on.

## Lessons
- Run spec generation interactively, or trust the write tool by the exact name Kiro reports, so writes can be approved.
- Space Kiro calls out to stay under the service's rate limit.
