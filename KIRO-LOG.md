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
