# Kiro session 4: build the call script (tasks 1 to 8)

- Tool: kiro-cli 3.5.0, v3 engine, non-interactive, agent `afterbeep-builder`
- Trusted tools: `fs_read`, `fs_write`, `run_command`, and the `@aws-docs`, `@context7` and `@afterbeep` MCP servers (not `--trust-all-tools`)
- Duration: 5 min 37 s; exit code 0; credits used: 4.96

## Prompt

```text
Implement tasks 1 to 8 of .kiro/specs/remote-retrieval/tasks.md (the call script in src/domain/remote-retrieval.ts and its unit tests in tests/unit/remote-retrieval.test.ts), following requirements.md and design.md in the same folder and the steering files.

Rules:
- Only these tasks. Do not start the server, client or Connect tasks.
- The step function stays pure: no clock, no randomness, no I/O. For task 8, use a small seeded generator inside the test file.
- Every test title names its criteria, such as [RR 2.3].
- When done, run `npm run typecheck` and `npx vitest run` with run_command and fix anything that fails, including tests that already existed.
- Tick tasks 1 to 8 (and their sub-tasks) in tasks.md once their tests pass.
- Do not run git commands; the developer commits.

Finish with a short summary: the files you wrote, the test counts, and anything in the spec you had to change.
```

## Session output

Kiro's narration and tool calls as printed by kiro-cli. Tool status lines and client log lines are removed; nothing else is edited.

```text
[tool] List Directory
[tool] Read File
[tool] Read File
[tool] Read File
[tool] Read File
[tool] Run Command
[tool] Write File
[tool] Replace in File
[tool] Write File
[tool] Replace in File
[tool] Run Command
[tool] Replace in File
[tool] Run Command
[tool] Run Command
Tasks 1 to 8 are done. `npm run typecheck` is clean, and `npx vitest run` passes with 258 tests across 16 files. That includes the 57 new tests, and every existing test still passes.

**Files written**
- `src/domain/remote-retrieval.ts` is new. It holds the types, `startState`, `remoteQueue` and the pure `step`.
- `tests/unit/remote-retrieval.test.ts` is new, with 57 tests. Every title names its RR criteria. The task 8 run uses a mulberry32 generator inside the test file. It drives 8 seeds of 600 events each, replayed twice, plus a run of random keys inside a live call.
- `.kiro/specs/remote-retrieval/tasks.md` has tasks 1 to 8, 1.1 and 2.1 ticked.

**Spec changes**
- **Design:** I added a `'ringing'` phase to `Phase` in `design.md`. The state needs a value before `call-answered`, and the design's table already had a "(start)" row for it.
- **Not in the spec:**
  - The script skips the text effect when the message's `canText` is false and says there is no number. This covers 5.5.
  - Silence while waiting to confirm an erase asks again once, then hangs up without erasing.
  - A failed `verify-code` sends the owner back to ask for the code.
  - While a text is pending, all keys and silence are no-ops, not just a second 2.
- **Message type:** `remoteQueue` takes `Message & { erasedAt? }`, because `erasedAt` doesn't exist on `Message` until task 10.

Two points to check:
- The "[RR 8.6] no prompt says an amount" test first failed on my own fixture. A job text containing "dollars" is read back as the caller said it, so I used a neutral job text. The script reads the job as given, so a caller who says an amount in the job line would hear it repeated.
- I didn't touch `spec-coverage.ts`, since turning on the RR prefix is task 24.
```
