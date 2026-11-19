# Kiro session 5: build the remote code check and routes (tasks 9 to 14)

- Tool: kiro-cli 3.5.0, v3 engine, non-interactive, agent `afterbeep-builder`
- Trusted tools: `fs_read`, `fs_write`, `run_command`, and the `@aws-docs`, `@context7` and `@afterbeep` MCP servers (not `--trust-all-tools`)
- Duration: 5 min 15 s; exit code 0; credits used: 5.38

## Prompt

```text
Implement tasks 9 to 14 of .kiro/specs/remote-retrieval/tasks.md (the remote code check, erasing, the remote service and its three routes, and their tests), following requirements.md and design.md in the same folder and the steering files. Tasks 1 to 8 are done in src/domain/remote-retrieval.ts.

Rules:
- Only these tasks. Do not start the client or Connect tasks.
- Reuse the existing texting rules, message status route and invoice draft route; read src/server/app.ts, src/server/services/ and the existing API tests in tests/unit/server-api.test.ts first and follow their patterns.
- The demo remote code 427 goes in the seed. It must never appear in any API response.
- Every test title names its criteria, such as [RR 2.3].
- When done, run `npm run typecheck` and `npx vitest run` with run_command and fix anything that fails, including tests that already existed.
- Tick tasks 9 to 14 (and their sub-tasks) in tasks.md once their tests pass.
- Do not run git commands; the developer commits.

Finish with a short summary: the files you wrote or changed, the test counts, and anything in the spec you had to change.
```

## Session output

Kiro's narration and tool calls as printed by kiro-cli. Tool status lines and client log lines are removed; nothing else is edited.

```text
[tool] Read File
[tool] Read File
[tool] Read File
[tool] Run Command
[tool] Run Command
[tool] Run Command
[tool] Run Command
[tool] Run Command
[tool] Run Command
[tool] Run Command
macOS sed failed; fix by hand.
[tool] Run Command
[tool] Run Command
[tool] Run Command
[tool] Run Command
[tool] Run Command
Tasks 9 to 14 are done, and the spec needed no changes. `npm run typecheck` is clean and `npx vitest run` passes 292 of 292 tests, with no existing tests failing. That is 18 files, up from 16, and the two new files hold 34 tests. I ticked tasks 9 to 14 and their sub-tasks in `tasks.md`.

**New files**
- `src/domain/remote-code.ts` has `checkRemoteCode`, a constant-time compare and `publicBusiness`, which strips the code from API output.
- `src/server/services/remote.ts` has `verifyRemoteCode`, `remoteTextBack` and `eraseMessage`.
- `tests/unit/remote-code.test.ts` has 10 tests.
- `tests/unit/server-remote.test.ts` has 24 tests, including the task 14 test that the remote call needs no other new route.

**Changed files**
- `src/domain/types.ts` adds `Business.remoteCode` and `Message.erasedAt`.
- `src/adapters/store/types.ts` adds `Db.remoteFailures`, which is optional so older saved data still loads.
- `src/server/seed.ts` sets the demo code to 427.
- `src/server/app.ts` adds the three `/api/remote/*` routes behind a gate. The gate lets a request through only when the simulator is on or the bearer secret is valid. Without the secret it answers 401, or 404 if no secret is configured.
- `src/server/app.ts` also strips the code from `GET /api/business` and the greeting `PUT`, and hides erased messages from `GET /api/messages` and its `newCount`.
- `src/server/services/voicemail.ts` now exports `textBack` and `textBackNumber`, so the remote text uses the existing text-back path instead of a copy.
- `src/domain/graveyard.ts` skips erased hang-ups. This was not in the tasks.

**Your call:**
- **Lockout timing:** the lock lasts until 15 minutes after the fifth failure. A plain sliding window would lift it early, when the oldest failure aged out.
- **Test for 4.3:** it checks that a called-back message is never queued, so the script never marks it heard. It does not exercise a driver, since none exists yet.
- **Not coded:** `remoteCode` is a required type but may be missing in old stored data, in which case every code is wrong. There is no code-change setting yet.
```
