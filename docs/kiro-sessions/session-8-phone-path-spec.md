# Kiro session 8: extend the remote-retrieval spec for the phone path

- Tool: kiro-cli 3.5.0, v3 engine, non-interactive, agent `afterbeep-builder`
- Trusted tools: `fs_read`, `fs_write`, `run_command`, and the `@aws-docs`, `@context7` and `@afterbeep` MCP servers (not `--trust-all-tools`)
- Duration: 6 min 43 s; exit code 0; credits used: 11.59 (kiroween2026 balance 194.84 before, 206.43 after)
- The `aws-docs` MCP server loaded; Kiro searched and read the Connect pages listed under "Sources looked up" in design.md.

## Prompt

```text
Extend the remote-retrieval spec in .kiro/specs/remote-retrieval/ (requirements.md, design.md and tasks.md) for the next piece: the Lambda function that the Amazon Connect flow infra/connect/remote-retrieval-flow.json calls on every turn, and how a real call reaches that flow. Do not write any code in this step; only edit the three spec files. Keep every existing criterion and task as it is; add new ones after them.

Decided by the owner, so write it as requirements, not as an open question:
- The owner reaches the remote menu by calling the business's own AfterBeep number from the owner's own phone. When the caller ID matches the owner's number, the voicemail flow (infra/connect/contact-flow.json) hands the call to the remote-retrieval flow, which asks for the 3-digit code. Every other caller gets the voicemail flow exactly as today. There is no second number.
- Caller ID only routes the call. It can be faked, so the 3-digit code stays the only gate (keep the existing security note and lockout).

Scope for the new criteria (prefix RR, continuing the numbering, for example 14.1, and a 15 for the way in if that reads better):
- The turn Lambda lives in infra/connect/ and is written and tested with mocks, not deployed. It must reuse the pure step() from src/domain/remote-retrieval.ts, so the browser keypad and the phone share one call script.
- It carries the RemoteState between turns in a way the Connect documentation supports for a stateless Lambda (for example returning the state in its flat string-map answer and storing it as a contact attribute that the next turn passes back). Check the documented size limits for Lambda answers and contact attributes, and keep message data that must not leave the server out of the attributes where you can.
- It carries out the effects through the existing server routes (/api/remote/code, /api/remote/messages/:id/text, /api/remote/messages/:id/erase, and the existing message status route for mark-heard) with the bearer webhook secret, and answers Connect with flat prompt and next strings that the flow already routes on (menu, invoice, goodbye).
- Say what play-message means on a phone (for example speaking the transcript), what happens at the invoice step on a phone today, the 8-second Lambda limit, and that any failure (server down, timeout, bad answer) gives a spoken failure prompt and never throws.
- Changes to the flows: the caller-ID check in the voicemail flow and whatever the remote flow needs to pass the state back. The owner's number must not be hard-coded in a tracked file; use a placeholder or a setting.
- infra/connect/README.md must record the decision above (caller ID plus code, no second number) and say the Lambda is written and tested with mocks but not deployed.
- Tests: Vitest unit tests with a mocked fetch and sample Connect events, plus parse tests for any flow change. Every test title names its criteria, such as [RR 14.2]. npm run spec:coverage counts every RR criterion, so each new criterion needs a test or a real reason it is checked elsewhere.

Before writing design.md, look up with the aws-docs MCP server: the event Amazon Connect sends to a Lambda function from a flow and the answer format it accepts, the limits on that answer and on contact attributes, the UpdateContactAttributes and TransferToFlow (or equivalent) flow-language actions, and how a flow compares the caller's number. List what you looked up under "Sources looked up" in design.md, and remove the entry-point and phone-draft items from "Open questions" only where the new design answers them.

In tasks.md, add small unchecked tasks numbered from 26, each naming its criteria, in two groups headed for two build sessions: first the Lambda and its unit tests; then the flow changes, the README, and closing spec coverage. Finish with a short summary: the new criteria count, the tasks, and what you looked up.
```

## Session output

Kiro's narration and tool calls as printed by kiro-cli. Tool status lines and client log lines are removed; nothing else is edited.

```text
I'll start by reading the existing spec files and the two flows.
[tool] Read File
[tool] Read File
[tool] Read File
[tool] List Directory
[tool] Read File
[tool] Read File
[tool] Read File
[tool] Read File
[tool] Grep Search
The aws-docs server is available, so I'll load its tools before writing the design.
[tool] Tool Load
[tool] Tool Load
Now the lookups, in parallel: Lambda invocation from a flow, flow-language actions, and limits.
[tool] @aws-docs/read_documentation
[tool] @aws-docs/read_documentation
[tool] @aws-docs/read_documentation
[tool] @aws-docs/read_documentation
[tool] @aws-docs/search_documentation
[tool] @aws-docs/search_documentation
[tool] @aws-docs/read_documentation
[tool] @aws-docs/read_documentation
[tool] @aws-docs/read_documentation
[tool] @aws-docs/search_documentation
[tool] @aws-docs/read_documentation
[tool] @aws-docs/read_documentation
[tool] @aws-docs/read_documentation
[tool] @aws-docs/read_documentation
Next I'll check which server routes exist, since that decides how the Lambda can rebuild a queue without keeping message text in Connect.
[tool] Grep Search
[tool] Code Intelligence
[tool] Read File
[tool] Grep Search
[tool] Grep Search
[tool] Grep Search
[tool] Read File
[tool] Grep Search
[tool] Grep Search
[tool] Read File
[tool] Grep Search
[tool] @aws-docs/search_documentation
[tool] Replace in File
[tool] Append to File
[tool] status: Pending
[tool] status: Pending
Now the design: first the sources, then the new sections, then fix the two items that the design now answers.
[tool] Replace in File
[tool] status: Pending
[tool] Replace in File
[tool] status: Pending
[tool] Replace in File
[tool] status: Pending
Now the tasks, in two build-session groups.
[tool] Append to File
[tool] status: Pending
I extended the three spec files and wrote no code. `npm run spec:coverage` will fail until the tests in tasks 26 to 40 exist, because the script counts all 41 new criteria, and I did not run it. If every commit must pass `npm run check`, land the spec together with the first build session or temporarily list the new IDs in `CHECKED_ELSEWHERE`.

## What changed
- **`requirements.md`:** I added 41 criteria and kept every existing criterion as it was. Requirement 14 has 26 criteria for the turn Lambda. Requirement 15 has 7 for the way in. Requirement 16 has 8 for the flow changes, the README and the placeholder rules. I also edited the intro's "Out of scope" sentence, since the Lambda is now in scope.
- **`design.md`:** I added a "Sources looked up" subsection and a "The phone path" section. I reduced "Open questions" to what is still undecided.
- **`tasks.md`:** I added unchecked tasks 26 to 41 in two groups. Session A, tasks 26 to 36, is the Lambda and its unit tests. Session B, tasks 37 to 41, is the flow changes, the README and closing spec coverage. Each task names its criteria, and every new criterion has a planned test.

## Where I went beyond your brief
- **Existing routes only.** The Lambda rebuilds the queue from `GET /api/messages` and the existing status route, so there is no new server route. For that I extract `toRemoteMessage` from `remoteQueue` in the domain file (task 26, no behavior change).
- **What the saved state holds.** The state attribute holds only ids, urgency, a can-text flag, the phase and counters. Transcripts, names and jobs are fetched each turn and never stored in Connect. The remote code is never stored.
- **A missing `*` branch.** The existing menu has no `*` condition, so `*` would reach the script as `other` and answer "That key does nothing here" instead of repeating the message. I added the `*` branch to the flow (16.4).
- **A missing retry path for wrong codes.** The existing `route` has no branch for asking the code again after a wrong code. I added a `code` branch with its own input action (16.3).
- **Invoice step on a phone.** Nothing on the phone can turn the owner's speech into words, and the draft route doesn't save drafts. So the call says "Invoices by phone are not ready. Use the app." and ends. No recording is started and no draft is made.
- **Mark-heard failures.** On a phone, a failed mark-heard is ignored rather than spoken as an error, because the transcript has already been read out.

## What I looked up (aws-docs)
- The Lambda-from-a-flow guide:
  - the event shape: `Details.ContactData`, `Details.Parameters`, and user attributes arriving automatically;
  - a 64 KB answer limit;
  - up to 3 retries within 8 seconds, which is why effects must be safe to repeat;
  - a 20-second limit on chained Lambda calls.
- The Lambda block and `InvokeLambdaFunction`: an 8-second synchronous limit, `$.External`, and STRING_MAP.
- Set contact attributes: a 32 KB limit on contact attributes, 64 KB for flow attributes and 128 KB for persisted flow attributes. The persisted ones exist only in Amazon Connect Customer instances.
- `UpdateContactAttributes` accepts dynamic values.
- `TransferToFlow`: inbound and transfer flows only, with a static or single-JSONPath `ContactFlowId`.
- Compare and Check contact attributes (Equals, case-sensitive).
- The system attribute `$.CustomerEndpoint.Address`.
- I read only a search summary for the 3,000-character text-to-speech limit, not the page, and the design says so.

## Open questions I could not settle from the docs
- **Prompt characters.** The docs say STRING_MAP values may contain only alphanumerics, dash and underscore, but their own example returns `"$1000"`. A spoken prompt needs spaces. If Connect rejects the prompt, the fallback is the `JSON` response type.
- **Caller number format.** The docs show `+1234567890` in a sample event but never say an inbound caller number is always E.164. The owner's number may need a different format.
- **Forwarded-call caller ID.** I assumed the owner dials the number directly, not through their own forwarding. I did not check what caller ID a carrier shows for a forwarded call.
- **Flow logging.** Connect can write the keyed digits to CloudWatch if flow logging is on. The README will ask for it to be off on the remote flow, but nothing enforces that.The hook output confirms what I flagged: `npm run spec:coverage` now reports all 41 new criteria (RR 14.1 to 16.8) as having no test. That is expected, because you limited this step to editing the three spec files and the tests are tasks 26 to 40.

I did not add the IDs to `CHECKED_ELSEWHERE` in `scripts/spec-coverage.ts`. That would be a code change, and none of these criteria is meant to be checked elsewhere.

The check will stay red until the build sessions land the tests. Task 41 closes coverage at the end. If every commit must pass `npm run check`, land this spec change in the same commit as the first build session's tests.
```
