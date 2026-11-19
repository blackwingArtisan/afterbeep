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
- [ ] 9. `Business.remoteCode` and `db.remoteFailures`, the demo code 427 in the seed, and the pure `checkRemoteCode(db, digits, now)` in `src/domain/remote-code.ts`: constant-time compare, five wrong codes in 15 minutes lock it, a right code clears the count, expiry after 15 minutes (Req 2.1, 2.2, 2.4, 2.6)
  - [ ] 9.1 Unit tests in `tests/unit/remote-code.test.ts` with an injected `now`, including a right code during lockout (Req 2.4, 2.6)
- [ ] 10. `erasedAt` on `Message`; the inbox, the new count and `remoteQueue` skip erased messages; kept figures and the booked job are untouched (Req 6.4, 6.5)
  - [ ] 10.1 Unit tests: an erased message leaves the count and the inbox, and a kept scenario gives the same figures before and after (Req 6.4, 6.5)
- [ ] 11. `src/server/services/remote.ts` `verifyRemoteCode` and `POST /api/remote/code`: zod body, queue returned only on `ok`, `locked` answer, the code removed from `GET /api/business` and every response, routes closed unless the simulator is on or the bearer secret is valid (Req 2.3, 2.5, 2.7, 11.1, 11.5, 11.6)
  - [ ] 11.1 API tests in `tests/unit/server-remote.test.ts`: right and wrong code, lockout, a malformed body, simulator off with and without the secret, the code absent from every response (Req 2.3, 2.5, 2.7, 11.1, 11.6)
- [ ] 12. `remoteTextBack` and `POST /api/remote/messages/:id/text`, reusing `sendText` and the 10-minute cooldown; outcomes sent, opted-out, texted-recently, no-number, refused (Req 5.1-5.7, 11.2, 11.7)
  - [ ] 12.1 API tests: each outcome, STOP honoured, the time recorded on the message, an unknown id gives 404, the text goes to the message's own number only (Req 5.2-5.7, 11.2, 11.7)
- [ ] 13. `eraseMessage` and `POST /api/remote/messages/:id/erase` (Req 6.4, 6.6, 11.3, 11.7)
  - [ ] 13.1 API tests: erase hides the message from `/api/messages`, a second erase and an unknown id give 404 (Req 6.4, 6.6, 11.3, 11.7)
- [ ] 14. API test that the remote call needs no other new route: mark heard through the existing status route (a called-back message keeps its status in the driver's rule) and draft through the existing invoice draft route, with nothing sent (Req 4.1, 4.3, 8.2, 8.3, 11.4)

## The keypad simulation
- [ ] 15. `dtmf(key)` in `src/client/lib/sound.ts` with an exported frequency table, and a unit test of the table for all twelve keys (Req 12.6)
- [ ] 16. `Keypad` component: twelve keys, each at least 56 px square, physical keyboard keys `0`-`9`, `*` and `#` (Req 12.2, 12.3, 12.12)
- [ ] 17. `Remote` page: reducer around `step`, prompt transcript, spoken prompts through `speak()` where available, silence timers of 10 and 20 seconds, effect runner for the five server effects with results fed back, and a failure prompt on error (Req 12.4, 12.5, 12.7, 12.8)
- [ ] 18. Route `/machine/remote`, a Remote key in the machine navigation, the demo code shown in demo mode, and the header's new-message count refreshed when the call ends (Req 12.1, 12.10, 12.11)
- [ ] 19. Invoice step: dictation or typed words, then a link to `/machine/invoice` carrying the words in router state; `VoiceInvoice` fills its text box from that state and still needs the owner's approval of the exact total (Req 8.2, 8.3, 12.9)
- [ ] 20. Playwright `tests/e2e/remote.spec.ts`: open Remote from the navigation, key 4-2-7, hear the count, press 1, 2, `#`, erase with 9 9, reach the invoice prompt, type the slip script, open the draft and see it on hold with nothing sent; a wrong code three times ends the call (Req 1.1-1.6, 3.1, 4.1, 5.7, 6.2, 8.1, 8.3, 12.1-12.4, 12.9)

## The Amazon Connect flow
- [ ] 21. Read the `Compare` and `MessageParticipant` flow-language pages with the `aws-docs` server and add them to "Sources looked up" in `design.md` (Req 13.1)
- [ ] 22. `infra/connect/remote-retrieval-flow.json` with the code input, the menu and the Lambda hand-off, and `tests/unit/connect-remote-flow.test.ts` that parses it (Req 13.1-13.5)
  - [ ] 22.1 The test checks the version and start action, unique identifiers, no dangling transition, `StoreInput: "True"` with a maximum length of 3, one `Equals` condition each for 1, 2, 9 and `#`, the error transitions on every keypad input, and that `427` appears nowhere in the file (Req 13.1-13.5)
- [ ] 23. `infra/connect/README.md`: describe the remote flow, the two ways in, and say it is written and checked but not deployed (Req 13.6)
  - [ ] 23.1 A unit test that the README says the flow is not deployed (Req 13.6)

## Wrap-up
- [ ] 24. Turn on the RR prefix in `scripts/spec-coverage.ts` (`RR: 'remote-retrieval'`, the test regexp and the header comment) and run `npm run spec:coverage` until every RR criterion is named by a test (Req 1-13)
- [ ] 25. Update `structure.md` with the new files, the README counts of specs, criteria and tests, the `#demo` steering file with the remote call, and `KIRO-LOG.md` with this spec (no criteria)
