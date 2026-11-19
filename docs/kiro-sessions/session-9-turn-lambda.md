# Kiro session 9: build the turn Lambda (tasks 26 to 36)

- Tool: kiro-cli 3.5.0, v3 engine, non-interactive, agent `afterbeep-builder`
- Trusted tools: `fs_read`, `fs_write`, `run_command`, and the `@aws-docs`, `@context7` and `@afterbeep` MCP servers (not `--trust-all-tools`)
- Duration: 7 min 5 s; exit code 0; credits used: 10.21 (kiroween2026 balance 206.43 before, 216.64 after)
- No MCP calls in this session; the design already held the Connect facts it needed.
- One unit test failed at the end of this session by design: the MCP server test runs `spec:coverage`, which counted the criteria of tasks 37 to 41 as missing until session 10.

## Prompt

```text
Implement tasks 26 to 36 of .kiro/specs/remote-retrieval/tasks.md ("Build session A: the turn Lambda and its unit tests"), following requirements.md and design.md in the same folder and the steering files. Tasks 1 to 25 are done. Tasks 37 to 41 are for the next session; do not start them.

Rules:
- The Lambda is infra/connect/remote-turn.ts as the design says. It reuses step() and startState from src/domain/remote-retrieval.ts and holds no copy of the call script. It is not deployed; nothing calls AWS or the network. Tests use a fake fetch and sample Connect events.
- If you need a Connect or Lambda behavior the design does not cover, look it up with the aws-docs MCP server first and add it to "Sources looked up" in design.md.
- Every test title names its criteria, such as [RR 14.2].
- npm run spec:coverage will still list the criteria of tasks 37 to 41 (15.1 to 15.4, 15.6, 15.7 and 16.x) as missing until the next session; that is expected. Every criterion of tasks 26 to 36 must be named by a test when you finish.
- When done, run `npm run typecheck`, `npm test` and `AFTERBEEP_E2E_PORT=3821 npx playwright test` with run_command (always set that port; never use another) and fix anything that fails.
- Tick each task in tasks.md once its tests pass.
- Do not run git commands; the developer commits. Leave README.md and KIRO-LOG.md alone.

Finish with a short summary: the files you wrote or changed, the test counts, the spec coverage line, and anything in the spec you had to change.
```

## Session output

Kiro's narration and tool calls as printed by kiro-cli. Tool status lines and client log lines are removed; nothing else is edited.

```text
[tool] Read File
[tool] Read File
[tool] Read File
[tool] Grep Search
[tool] Read File
[tool] Read File
[tool] Read File
[tool] Grep Search
[tool] Run Command
[tool] Read File
[tool] Read File
[tool] Grep Search
[tool] Replace in File
[tool] status: Pending
[tool] Replace in File
[tool] status: Pending
[tool] Run Command
[tool] Write File
[tool] status: Pending
[tool] Replace in File
[tool] Run Command
[tool] status: Pending
[tool] Replace in File
[tool] status: Pending
[tool] Replace in File
[tool] status: Pending
[tool] Write File
[tool] status: Pending
[tool] Run Command
The `});` after the spy loop should be `}`.
[tool] Replace in File
[tool] status: Pending
[tool] Run Command
[tool] Run Command
[tool] Replace in File
[tool] status: Pending
[tool] status: Failed: Replace in File
[tool] Replace in File
[tool] status: Pending
[tool] status: Failed: Replace in File
[tool] Replace in File
[tool] status: Pending
[tool] Run Command
Tasks 26 to 36 are done and ticked in `tasks.md`. Typecheck passes and the Playwright run passes (24 passed, 1 skipped, port 3821). `npm test` has one failure, which is expected because spec coverage is still incomplete: `tests/unit/mcp-server.test.ts` ("speaks MCP over stdio and runs the spec coverage check") expects `spec:coverage` to pass. It will pass once tasks 37 to 41 close the remaining criteria.

**Files written or changed**
- `infra/connect/remote-turn.ts` (new): the turn Lambda. It exports `createHandler({ fetch, env })`, `handler` and the zod schemas for the event and the answer. It also exports `encodeState`, `decodeState`, `speakable` and `nextFor`. It imports `step`, `startState` and `toRemoteMessage` from the domain and holds no copy of the script. Nothing is deployed and nothing calls AWS or the network.
- `src/domain/remote-retrieval.ts`: `toRemoteMessage` is pulled out of `remoteQueue` and exported, with no behavior change.
- `tsconfig.json`: `infra/connect` added to `include`.
- `tests/unit/connect-remote-turn.test.ts` (new): 54 tests against a fake fetch and sample Connect events.
- `tests/unit/remote-retrieval.test.ts`: one new test, `[RR 14.10]`.
- `.kiro/specs/remote-retrieval/tasks.md`: tasks 26 to 36 and their sub-tasks ticked.

**Test counts**
- `npm test`: 359 passed, 1 failed (the MCP test above), 360 total.
- Playwright: 24 passed, 1 skipped.

**Spec coverage**
`Spec coverage: 226 of 243 requirements named by tests, 4 checked on the real-service path.` The criteria still without a test are RR 15.1 to 15.4, 15.6, 15.7 and 16.1 to 16.7, which belong to tasks 37 to 41. I named 16.8 here, with a test that the Lambda file has no secret or phone number and reads its settings from the environment.

**Spec changes**
I did not change `requirements.md`, `design.md` or `README.md`. I did not need any new Connect behavior, so "Sources looked up" is unchanged. `toRemoteMessage` takes a small structural type, `RemoteMessageInput`, instead of the full `Message`. This lets the Lambda build it from the `GET /api/messages` response. The design says only that the Lambda and `remoteQueue` share one mapping, so no spec text needed to change.

**Choices the design left open**
- Without a Lambda-side fallback prompt, an ignored key (for example `#` while the code is asked) would answer with an empty prompt. So the Lambda has three short fallback prompts for the `code`, `menu` and `goodbye` cases.
- On a phone I drop the script's own "Goodbye." and "No invoice heard." prompts in the invoice step. The call then ends with "Invoices by phone are not ready. Use the app."
- A code turn with a saved state that is not in the `ask-code` phase is a failure. This stops keyed code digits from being read as menu keys such as `9 9`.
- A network error or non-2xx answer from an effect becomes `effect-failed`, as the design table says. A response that fails its schema, or any error while reading the message list, fails the whole turn.That hook output matches what I reported: RR 15.1 to 15.4, 15.6, 15.7 and 16.1 to 16.7 have no test yet. They belong to tasks 37 to 41, the next session, so I'm leaving them alone as instructed.
```
