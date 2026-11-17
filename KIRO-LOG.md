# Kiro log

What Kiro was asked to do on this project, what it produced, and what it cost. Every call is listed, including the ones that failed.

## Budget
Two `kiro-cli` calls were allowed for this build, run without `--trust-all-tools` so that Kiro could only use the file tools named on the command line. Both were used.

## Before the calls
The steering files (`.kiro/steering/product.md`, `tech.md`, `structure.md`) and the agent hooks (`.kiro/hooks/*.json`) were written first, so that Kiro would plan against the product rules: code does all arithmetic in integer cents, nothing is sent without the owner's approval, and every outside service sits behind an adapter with a free local default.

## Call 1: write both specs
- **When:** 2026-11-17 03:17 UTC
- **Command:** `kiro-cli chat --no-interactive --trust-tools=fs_read,fs_write "<prompt>"`
- **Prompt (summary):** Read the three steering files and follow them. Write two specs, `missed-call-booking` and `voice-invoicing`, each as `requirements.md` (user stories with numbered EARS acceptance criteria), `design.md` (architecture, components, TypeScript data models, adapter interfaces, error handling, testing strategy) and `tasks.md` (a checklist mapped to requirement numbers).
- **What happened:** Kiro read the steering files and the hooks, made a task plan and composed the requirements. Each write was refused with `tool permission approval is not supported in non-interactive mode. Use --trust-all-tools to auto-approve.` The stream then ended with `The request was throttled by the service (request_id: 62155093-433d-45a7-9a10-b0e02b13ad4e)`. Output from a concurrent Kiro session for a different project was mixed into the same stream.
- **Files produced:** none.
- **Credits shown:** none printed by the CLI.

## Call 2: retry with the v2 agent
- **When:** 2026-11-17, a few minutes after call 1
- **Command:** `kiro-cli --v2 chat --no-interactive --trust-tools=fs_read,fs_write "<prompt>"`
- **Prompt (summary):** The same request, limited to this repository, naming the `fs_write` tool explicitly.
- **What happened:** The service throttled the request at once: `Internal error (code -32603): Encountered an error in the response stream: The request was throttled by the service (request_id: 77a148bc-6619-4436-950f-1a52c196c803)`.
- **Files produced:** none.
- **Credits shown:** none printed by the CLI.

## Result
Neither call wrote a file, so the two specs in `.kiro/specs/` were written by hand in Kiro's spec format, against the same steering files, and then built task by task:

- `.kiro/specs/missed-call-booking/` requirements (EARS), design, tasks
- `.kiro/specs/voice-invoicing/` requirements (EARS), design, tasks

Every task in both `tasks.md` files is checked off and covered by the unit, API and Playwright tests.

## Next time
- Run Kiro interactively, or trust its write tool under the exact name it reports, so that writes can be approved.
- Space calls out to avoid throttling, and give each project its own Kiro session so streams do not mix.

## Kiro pass (kiro-cli v3, workspace trusted)

- **When:** 2026-11-17 04:34 UTC
- **Session:** non-interactive, Kiro IDE. Only the file tools were trusted; `rm` / `git rm` / `node` / `ls` / `find` were not approved, so no file could be deleted and no command could be run.
- **Asked to do:** (1) review the spec against the code and update `tasks.md` / `requirements.md`; (2) replace the hooks in `.kiro/hooks` with valid Kiro hooks; (3) append this log. No application source code was to change.

### Spec review against the code
Read every file under `src/`, the seed, every adapter, the client pages and the tests, and compared behavior to the two specs. Every task already in both `tasks.md` files is checked off and is genuinely implemented and covered by the unit, API and Playwright tests, so no existing check was changed.

Four behaviors exist in the code but were not in the spec, so each got a new EARS criterion in `requirements.md` and a new (already-done) task in `tasks.md`:

1. **Invoice due date.** `sendInvoice` sets `dueDate` to 14 days after the invoice date (`addDays(now, 14)`), the Stripe provider passes `days_until_due: 14`, and `CustomerInvoice.tsx` renders a "Due" date. Not covered by Req 5.2's "date" (the invoice date). Added **voice-invoicing Req 5.6** and task 19.
2. **Invoice title from the job.** `draftInvoice` falls back to `job.description` (before the colon) for the title when the spoken invoice has none; `server-api.test.ts` asserts `draft.title === 'Dryer'`. Req 1.4 only covers a title read from speech. Added **voice-invoicing Req 4.9** and task 18.
3. **Caller confirms or corrects the visit address.** `Booking.tsx` shows the heard address in an editable field, `POST /api/book/:token` accepts an `address`, and `bookSlot` uses it over the extracted address. Req 5.1 only says "show the address." Added **missed-call Req 5.9** and task 19.
4. **No open slots fallback.** `Booking.tsx` tells the caller to call the business and shows the phone when no slot is open in the 14-day window. Added **missed-call Req 5.10** and task 20.

### Hooks (`.kiro/hooks/`)
The three pre-existing hook files already used Kiro's v1 JSON hook format (`version: "v1"`, PascalCase triggers, regex `matcher` for file events, `action.type` of `command` / `agent`, `timeout` in seconds), confirmed against the current docs at kiro.dev/docs/hooks.md. None was "not in Kiro's format," so none was removed for that reason.

- **`test-on-save.json`** — rewritten to canonical v1. The required hook: a `PostFileSave` command hook that runs `npm test` (the Vitest unit suite) when a file under `src/` or `tests/unit/` is saved.
- **`money-guard.json`** — rewritten to canonical v1. The "one more hook useful for this project": a `PostFileSave` agent hook that fires when `src/domain/{money,tax,invoice-parser,price-book,invoice-draft}.ts` is edited and re-states the integer-cents / code-does-arithmetic rules, asking for a unit test.
- **`typecheck-on-stop.json`** — the task asks for a focused two-hook set, so this third hook was meant to be removed. `rm` and `git rm` both require approval that is unavailable non-interactively, and deleting is hard-to-reverse, so the file was not deleted. It was retired instead with the documented `enabled: false` field ("skip the hook without deleting it"); the active hook set is the two named above. The file is still a valid v1 hook.

### Files changed
- `.kiro/specs/missed-call-booking/requirements.md` — added EARS criteria 5.9 and 5.10.
- `.kiro/specs/missed-call-booking/tasks.md` — added done tasks 19 and 20.
- `.kiro/specs/voice-invoicing/requirements.md` — added EARS criteria 4.9 and 5.6.
- `.kiro/specs/voice-invoicing/tasks.md` — added done tasks 18 and 19.
- `.kiro/hooks/test-on-save.json` — rewritten to canonical v1 (run unit tests when a source file is edited).
- `.kiro/hooks/money-guard.json` — rewritten to canonical v1 (guard the money rules on domain money-code edits).
- `.kiro/hooks/typecheck-on-stop.json` — retired with `enabled: false` (could not be deleted in this session).
- `KIRO-LOG.md` — this section appended.

No application source code under `src/` was changed.
