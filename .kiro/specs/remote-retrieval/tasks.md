# Tasks: Remote retrieval

Each task is one commit and leaves `npm run check` and `npm run test:e2e` passing. Every test title names its criteria, such as `[RR 2.3]`. Test titles may name `RR` ids before task 24; that task turns the coverage check on once every criterion has a test.

## The call script (`src/domain/remote-retrieval.ts`)
- [x] 1. Types, prompt table and queue order: `Key`, `RemoteMessage`, `RemoteState`, `RemoteEvent`, `RemoteEffect`, `Prompt`, `startState`, and `remoteQueue(messages)` (new, not erased, not a hang-up, emergency then soon then routine, oldest first) (Req 3.2, 3.3, 9.2, 10.2, 10.3)
  - [x] 1.1 Unit tests in `tests/unit/remote-retrieval.test.ts`: queue order and filtering, every prompt under 30 words, every effect survives a JSON round trip (Req 3.2, 3.3, 9.2, 10.2)
- [x] 2. `step` for the code phases: opening prompt naming the business, digits, auto-check on the third digit, `*` clears, other keys ignored, wrong code with three tries, goodbye, silence once then hang-up (Req 1.1-1.7, 9.1, 9.3, 10.1, 10.4)
  - [x] 2.1 Unit tests: each row of the code-phase table, and no message data in any prompt or state before `code-checked` (Req 1.8)
- [x] 3. `step` for the announcements: "You have N new messages" with singular and zero forms, position, urgency, caller name or "an unknown caller", job, the key list, `*` repeats, an empty queue goes to the invoice prompt (Req 3.1, 3.4-3.7)
- [x] 4. `step` for play, skip and stray keys: key 1 emits `play-message` and `mark-heard`, announcing alone emits neither, `#` moves on or asks for the invoice, unknown keys and message silence (Req 4.1, 4.2, 4.4, 7.1-7.4)
- [x] 5. `step` for texting: key 2 emits `text-booking-link` for the current message only, one prompt per outcome, no second effect while one is pending (Req 5.1-5.7, 10.6)
- [x] 6. `step` for erasing: 9 asks, a second 9 emits `erase-message` and moves on, any other key keeps the message (Req 6.1-6.3)
- [x] 7. `step` for the invoice and for failures: "After the beep, say your invoice." with `start-invoice`, words emit `draft-invoice` and the draft prompt then `hang-up`, empty words make no draft, `effect-failed` keeps the message, no prompt speaks an amount (Req 8.1, 8.4, 8.5, 8.6, 12.8)
- [x] 8. Seeded random-key run: the script never throws, never emits after `ended`, and gives the same output for the same input (Req 10.1, 10.3, 10.5)

## Code, messages and routes
- [x] 9. `Business.remoteCode` and `db.remoteFailures`, the demo code 427 in the seed, and the pure `checkRemoteCode(db, digits, now)` in `src/domain/remote-code.ts`: constant-time compare, five wrong codes in 15 minutes lock it, a right code clears the count, expiry after 15 minutes (Req 2.1, 2.2, 2.4, 2.6)
  - [x] 9.1 Unit tests in `tests/unit/remote-code.test.ts` with an injected `now`, including a right code during lockout (Req 2.4, 2.6)
- [x] 10. `erasedAt` on `Message`; the inbox, the new count and `remoteQueue` skip erased messages; kept figures and the booked job are untouched (Req 6.4, 6.5)
  - [x] 10.1 Unit tests: an erased message leaves the count and the inbox, and a kept scenario gives the same figures before and after (Req 6.4, 6.5)
- [x] 11. `src/server/services/remote.ts` `verifyRemoteCode` and `POST /api/remote/code`: zod body, queue returned only on `ok`, `locked` answer, the code removed from `GET /api/business` and every response, routes closed unless the simulator is on or the bearer secret is valid (Req 2.3, 2.5, 2.7, 11.1, 11.5, 11.6)
  - [x] 11.1 API tests in `tests/unit/server-remote.test.ts`: right and wrong code, lockout, a malformed body, simulator off with and without the secret, the code absent from every response (Req 2.3, 2.5, 2.7, 11.1, 11.6)
- [x] 12. `remoteTextBack` and `POST /api/remote/messages/:id/text`, reusing `sendText` and the 10-minute cooldown; outcomes sent, opted-out, texted-recently, no-number, refused (Req 5.1-5.7, 11.2, 11.7)
  - [x] 12.1 API tests: each outcome, STOP honoured, the time recorded on the message, an unknown id gives 404, the text goes to the message's own number only (Req 5.2-5.7, 11.2, 11.7)
- [x] 13. `eraseMessage` and `POST /api/remote/messages/:id/erase` (Req 6.4, 6.6, 11.3, 11.7)
  - [x] 13.1 API tests: erase hides the message from `/api/messages`, a second erase and an unknown id give 404 (Req 6.4, 6.6, 11.3, 11.7)
- [x] 14. API test that the remote call needs no other new route: mark heard through the existing status route (a called-back message keeps its status in the driver's rule) and draft through the existing invoice draft route, with nothing sent (Req 4.1, 4.3, 8.2, 8.3, 11.4)

## The keypad simulation
- [x] 15. `dtmf(key)` in `src/client/lib/sound.ts` with an exported frequency table, and a unit test of the table for all twelve keys (Req 12.6)
- [x] 16. `Keypad` component: twelve keys, each at least 56 px square, physical keyboard keys `0`-`9`, `*` and `#` (Req 12.2, 12.3, 12.12)
- [x] 17. `Remote` page: reducer around `step`, prompt transcript, spoken prompts through `speak()` where available, silence timers of 10 and 20 seconds, effect runner for the five server effects with results fed back, and a failure prompt on error (Req 12.4, 12.5, 12.7, 12.8)
- [x] 18. Route `/machine/remote`, a Remote key in the machine navigation, the demo code shown in demo mode, and the header's new-message count refreshed when the call ends (Req 12.1, 12.10, 12.11)
- [x] 19. Invoice step: dictation or typed words, then a link to `/machine/invoice` carrying the words in router state; `VoiceInvoice` fills its text box from that state and still needs the owner's approval of the exact total (Req 8.2, 8.3, 12.9)
- [x] 20. Playwright `tests/e2e/remote.spec.ts`: open Remote from the navigation, key 4-2-7, hear the count, press 1, 2, `#`, erase with 9 9, reach the invoice prompt, type the slip script, open the draft and see it on hold with nothing sent; a wrong code three times ends the call (Req 1.1-1.6, 3.1, 4.1, 5.7, 6.2, 8.1, 8.3, 12.1-12.4, 12.9)

## The Amazon Connect flow
- [x] 21. Read the `Compare` and `MessageParticipant` flow-language pages with the `aws-docs` server and add them to "Sources looked up" in `design.md` (Req 13.1)
- [x] 22. `infra/connect/remote-retrieval-flow.json` with the code input, the menu and the Lambda hand-off, and `tests/unit/connect-remote-flow.test.ts` that parses it (Req 13.1-13.5)
  - [x] 22.1 The test checks the version and start action, unique identifiers, no dangling transition, `StoreInput: "True"` with a maximum length of 3, one `Equals` condition each for 1, 2, 9 and `#`, the error transitions on every keypad input, and that `427` appears nowhere in the file (Req 13.1-13.5)
- [x] 23. `infra/connect/README.md`: describe the remote flow, the two ways in, and say it is written and checked but not deployed (Req 13.6)
  - [x] 23.1 A unit test that the README says the flow is not deployed (Req 13.6)

## Wrap-up
- [x] 24. Turn on the RR prefix in `scripts/spec-coverage.ts` (`RR: 'remote-retrieval'`, the test regexp and the header comment) and run `npm run spec:coverage` until every RR criterion is named by a test (Req 1-13)
- [x] 25. Update `structure.md` with the new files, the README counts of specs, criteria and tests, the `#demo` steering file with the remote call, and `KIRO-LOG.md` with this spec (no criteria)

## The phone path (requirements 14 to 16)
Tasks 26 to 41 were added after tasks 1 to 25. Each is one commit and leaves `npm run check` and `npm run test:e2e` passing. Tests use a fake `fetch` and sample Connect events; nothing calls AWS, and the Lambda is not deployed. Test titles name their criteria, for example `[RR 14.2]`. Look up any Connect behavior the design does not cover with the `aws-docs` server before relying on it, and add it to "Sources looked up".

### Build session A: the turn Lambda and its unit tests
- [x] 26. Pull `toRemoteMessage(message)` out of `remoteQueue` in `src/domain/remote-retrieval.ts` and export it; `remoteQueue` calls it; no behavior change (Req 14.10, 3.2, 3.3)
  - [x] 26.1 Unit test in `tests/unit/remote-retrieval.test.ts`: `toRemoteMessage` returns what `remoteQueue` returned for the same message, and the existing queue tests still pass (Req 14.10)
- [x] 27. Add `infra/connect` to the `include` list of `tsconfig.json`; create `infra/connect/remote-turn.ts` with `createHandler({ fetch, env })`, the exported `handler`, and the zod schemas for the Connect event and the answer (Req 14.1, 14.2, 14.12, 16.8)
  - [x] 27.1 Unit tests in `tests/unit/connect-remote-turn.test.ts` with a helper that builds sample Connect events: a valid event parses, a missing step or an unknown step is a failure answer, the file imports `step` and `startState` from `src/domain/remote-retrieval` and has no copy of the script (Req 14.1, 14.2)
- [x] 28. State encoding: compact JSON in base64url without padding, decode with a schema, the 16,000-character limit, and `businessName` left out of the saved state (Req 14.7, 14.8, 14.9)
  - [x] 28.1 Unit tests: a round trip; the encoded string uses only letters, digits, `-` and `_`; a state built from a queue with transcripts, names, jobs and a code holds none of them; a state over the limit gives the failure answer (Req 14.7, 14.8, 14.9)
- [x] 29. Prompt text and the answer: `speakable(texts)` that keeps letters, digits, spaces and `. , ? ! ' -` and cuts at a word boundary at 2,500 characters, `nextFor(state)` for `code`, `menu` and `goodbye`, and the flat `{ prompt, next, state }` answer (Req 14.18, 14.19)
  - [x] 29.1 Unit tests: markup and emoji in a transcript are removed, a 4,000-character transcript is cut at a word, `next` for each phase, every answer value is a string (Req 14.18, 14.19)
- [x] 30. The turn core: turn name to events (code digits, `Timeout` and short digits as silence, key, key `other` as `0` or `#` by phase, silence), the loop of at most six steps with each effect run once, and the first `code` turn that starts from `startState` and drops the opening prompt (Req 14.3, 14.4, 14.5, 14.6, 14.24)
  - [x] 30.1 Unit tests: first code turn, three digits, `Timeout`, two digits, `other` while the code is asked and on a message, silence, and a test that a long random key sequence never runs more than six steps or one effect twice per turn (Req 14.3 to 14.6, 14.24)
  - [x] 30.2 Unit test that one scripted call through `handler` gives the same prompts as `step` driven directly (Req 14.1)
- [x] 31. The server client: requests with the bearer secret to `AFTERBEEP_URL`, a 5-second budget per turn that aborts the requests still running, and a zod schema for each response (Req 14.12, 14.21)
  - [x] 31.1 Unit tests: every request carries `Authorization: Bearer` and the right path and method, a response that fails its schema is a failure answer, a fetch that never answers is aborted and the failure answer arrives inside the budget (fake timers) (Req 14.12, 14.21, 14.22)
- [x] 32. Rebuild the queue from `GET /api/messages` with `toRemoteMessage`, drop erased ids, keep the index on the same message, and fail when the current message is gone (Req 14.10, 14.11)
  - [x] 32.1 Unit tests: the queue is rebuilt in the saved order, an id erased earlier in the call is dropped and the index follows, a missing current message is a failure answer, no request is made in the code phases (Req 14.10, 14.11)
- [x] 33. Effects: `verify-code`, `play-message`, `mark-heard`, `text-booking-link` and `erase-message` as in the design table, with results fed back as events (Req 14.13, 14.14, 14.15, 14.16, 14.17, 14.26)
  - [x] 33.1 Unit tests: the code goes to `/api/remote/code` and appears in no state, answer or log; ok, wrong and locked answers; the transcript is spoken before the keys prompt; `mark-heard` posts only for a `new` message and its failure does not end the call; each text outcome; a failed text gives `effect-failed`; erase 404 counts as done and another failure gives `effect-failed`; the same turn run twice sends a second text that the server refuses and an erase that counts as done (Req 14.13 to 14.17, 14.26)
- [x] 34. The invoice step on a phone: drop the invoice prompt and the recording effect, say "Invoices by phone are not ready. Use the app.", feed `invoice-heard` with no words, and answer `goodbye` (Req 14.20, 14.25)
  - [x] 34.1 Unit tests: after the last message and with no messages the call ends with that sentence, no request goes to `/api/invoices/draft`, the answer has `next` `goodbye`, and every prompt the Lambda adds is under 30 words with no name or claim to be a person (Req 14.20, 14.25)
- [x] 35. The failure answer and the log rules: one catch around the turn that returns "Something went wrong. Goodbye." with `next` `goodbye` and an ended state, and a logger that writes only the turn, the phase and the kind of failure (Req 14.22, 14.23)
  - [x] 35.1 Unit tests: a throwing fetch, a garbage state, a bad event and a thrown error each give the failure answer and `handler` never rejects; a spy on `console` sees no digit, transcript, secret or encoded state in any turn, including failures (Req 14.22, 14.23)
- [x] 36. Caller ID only routes: a Lambda test that passes the `caller` parameter of the owner and of a stranger and sees identical requests and answers (Req 15.5)

### Build session B: the flows, the README and spec coverage
- [x] 37. Voicemail flow: add `check-owner` (`Compare` on `$.CustomerEndpoint.Address`, one `Equals` condition with `REPLACE_WITH_OWNER_NUMBER`) as the new `StartAction` and `to-remote` (`TransferToFlow` with `REPLACE_WITH_REMOTE_FLOW_ID`); the default, `NoMatchingCondition` and the transfer error all go to `save-caller`; edit no existing action (Req 15.1, 15.2, 15.3, 15.4, 15.6)
  - [x] 37.1 `tests/unit/connect-voicemail-flow.test.ts`: the flow parses with unique identifiers and no dangling transition; it starts at `check-owner` and the compare comes before `save-caller` and `record`; the one condition and the transfer use the placeholders; every other path reaches `save-caller`; the old actions are unchanged from a copy of their expected shape; no `+` followed by digits, no 555 number and no flow id appears in the file (Req 15.1 to 15.4, 15.6)
- [x] 38. Remote flow: a `save-state` action (`UpdateContactAttributes`, `remoteState` = `$.External.state`, error to `went-wrong`) between each turn action and `route`; the new `turn-star` and the `*` condition on `menu` (Req 16.1, 16.2, 16.4)
  - [x] 38.1 Additions to `tests/unit/connect-remote-flow.test.ts`: all nine turn actions lead to `save-state` and `save-state` leads to `route`; `save-state` has an error transition to `went-wrong`; `menu` has one `Equals` condition each for 1, 2, 9, `#` and `*`, and `turn-star` sends the key `*`; the existing 13.x tests still pass (Req 16.1, 16.2, 16.4, 16.5)
- [x] 39. Remote flow: the `code` condition on `route` and `ask-code-again` (stored input, 3 digits, 10-second limit, 5-second inter-digit limit, error transitions) going to `turn-code` (Req 16.3, 16.5)
  - [x] 39.1 Tests: `route` has a `code` condition that reaches `ask-code-again`; it has `StoreInput: "True"`, a maximum length of 3, an inter-digit limit, and `InputTimeLimitExceeded` and `NoMatchingError` transitions; neither flow file contains `427` (Req 16.3, 16.5)
- [x] 40. `infra/connect/README.md`: record the decision (caller ID plus the 3-digit code, no second number, caller ID only routes), replace "Two ways to reach it, not decided yet", say the Lambda is written and tested with mocks but not deployed and neither flow is imported, list the placeholders and the Lambda's environment, say the remote flow must be an inbound flow, ask for flow logging off on the remote flow, and describe the bundling of `remote-turn.ts` (Req 15.7, 16.6, 16.7, 13.6)
  - [x] 40.1 README test in `tests/unit/connect-remote-flow.test.ts`: the text names the caller-ID-plus-code decision and "no second number", says the Lambda is not deployed and the flows are not imported, names the three placeholders, and says the remote flow must be an inbound flow; it no longer contains "not decided yet" (Req 15.7, 16.6, 16.7, 13.6)
  - [x] 40.2 Test that no file in `infra/connect/` holds a phone number, a webhook secret or an ARN with a real account id (Req 16.8, 15.4)
- [x] 41. Close spec coverage: run `npm run spec:coverage` and give every criterion 14.1 to 16.8 a test or a reason in `CHECKED_ELSEWHERE`; none is expected to need one, since every criterion has a test above. Update `structure.md`, the README counts of specs and criteria, and `KIRO-LOG.md` (no criteria) (Req 14 to 16)
