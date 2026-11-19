# Design: Remote retrieval

## Overview
The call script is one pure function in `src/domain/remote-retrieval.ts`: `step(state, event) -> { state, prompts, effects }`. It does no I/O, reads no clock and draws no random number. A *driver* feeds it events (key presses, effect results, silence) and carries out the effects it returns. There are two drivers: the browser keypad at `/machine/remote`, which is built and tested, and an Amazon Connect flow plus Lambda, which is written but not deployed. Both use the same script.

```
keypad / phone key ──► driver ──► step(state, event) ──► { state', prompts[], effects[] }
                         ▲                                      │
                         │   effect result as an event          ▼
                         └──── driver carries out effects: verify-code, play-message,
                               mark-heard, text-booking-link, erase-message, start-invoice,
                               draft-invoice, hang-up
```

Existing services do the work. Marking heard uses `POST /api/messages/:id/status`. The spoken invoice goes to `POST /api/invoices/draft`. Only three things need a new route: checking the code (it must stay on the server), texting from the remote call (it needs the opt-out and 10-minute rules), and erasing.

## Sources looked up
Looked up with the `aws-docs` MCP server before writing this design. Only what these pages say is relied on below.

| Page | What it gave this design |
|---|---|
| [Get customer input](https://docs.aws.amazon.com/connect/latest/adminguide/get-customer-input.html) | The block accepts only single digits `0`-`9`, `#` and `*`, and multi-digit entry needs Store customer input. The DTMF timeout is 1 to 180 seconds and, on voice, is the wait for the first digit. Conditions compare the input to a number, and the flow-language example uses `Equals` conditions and the errors `InputTimeLimitExceeded`, `NoMatchingCondition` and `NoMatchingError`. Used in 13.3 and 13.4. |
| [Store customer input](https://docs.aws.amazon.com/connect/latest/adminguide/store-customer-input.html) | Stores the digits in the *Stored customer input* system attribute. Has a maximum-digits property, a timeout before the first entry and a timeout between entries (1 to 20 seconds, default 5), and an optional terminating keypress. By default `*` deletes the digits entered so far. On no input the block takes its Success branch and the attribute holds `Timeout`. Used in 1.2, 1.3, 1.7 and 13.2. |
| [GetParticipantInput (flow language)](https://docs.aws.amazon.com/connect/latest/devguide/participant-actions-getparticipantinput.html) | The parameters `Text`, `SSML`, `InputTimeLimitSeconds`, `StoreInput`, `InputValidation.CustomValidation.MaximumLength` and `DTMFConfiguration` (`InputTerminationSequence`, `DisableCancelKey`, `InterdigitTimeLimitSeconds`, 1 to 20). With `StoreInput` true there are no conditions; with it false only `Equals` on a single character `0`-`9`, `*` or `#` is allowed. `NoMatchingError` must always be defined, `NoMatchingCondition` only when `StoreInput` is false, and the action is voice-only. Used in 13.2 to 13.4. |
| [InvokeLambdaFunction (flow language)](https://docs.aws.amazon.com/connect/latest/devguide/interactions-invokelambdafunction.html) | Parameters `LambdaFunctionARN`, `InvocationTimeLimitSeconds` (an integer of 8 or less), `InvocationType`, `LambdaInvocationAttributes` and `ResponseValidation` (`STRING_MAP` or `JSON`). Results are read from `$.External`. The only error is `NoMatchingError`. Used in 13.5. |
| Search result for the Lambda timeout | A synchronous Lambda call from a flow may run at most 8 seconds. The state machine step is a table lookup and one store read, so this is not a constraint. |

Not looked up: the `Compare` and `MessageParticipant` flow-language actions. The flow written in task 12 reuses the shapes already in `contact-flow.json` for `MessageParticipant`, and task 12 reads the `Compare` page before using it.

## Components
| Component | File | Responsibility |
|---|---|---|
| Call script | `src/domain/remote-retrieval.ts` | `step`, state and event types, prompt text, effect types, `startState` |
| Queue order | `src/domain/remote-retrieval.ts` | `remoteQueue(messages)`: new, not erased, not a hang-up, urgency then age |
| Code check | `src/domain/remote-code.ts` | Pure `checkRemoteCode(db, digits, now)` returning `ok`, `wrong` or `locked`, and the new failure list |
| Remote service | `src/server/services/remote.ts` | `verifyRemoteCode`, `remoteTextBack`, `eraseMessage` |
| Routes | `src/server/app.ts` | `POST /api/remote/code`, `POST /api/remote/messages/:id/text`, `POST /api/remote/messages/:id/erase` |
| DTMF tones | `src/client/lib/sound.ts` | `dtmf(key)` plays the keypad's two-tone pair |
| Remote screen | `src/client/pages/Remote.tsx` | Keypad, prompt transcript, effect driver |
| Keypad | `src/client/components/Keypad.tsx` | Twelve keys, big targets, keyboard input |
| Connect flow | `infra/connect/remote-retrieval-flow.json` | Keypad input for the code and the menu, hands each turn to a Lambda |

## Data models
```ts
type Key = '0'|'1'|'2'|'3'|'4'|'5'|'6'|'7'|'8'|'9'|'*'|'#';

/** What the script needs to know about a message. Nothing else leaves the server. */
interface RemoteMessage {
  id: string;
  urgency: Urgency;                 // 'emergency' | 'soon' | 'routine'
  callerName: string | null;
  job: string;
  transcript: string;
  canText: boolean;                 // has a callback number
}

type Phase =
  | 'ringing'            // before the call is answered
  | 'ask-code' | 'checking-code'
  | 'message'            // announced, waiting for a key
  | 'confirm-erase'      // 9 pressed once
  | 'ask-invoice'        // after the beep, waiting for the spoken invoice
  | 'ended';

interface RemoteState {
  phase: Phase;
  businessName: string;
  digits: string;                   // code digits so far
  wrongCodes: number;               // this call, 0 to 3
  silences: number;                 // in a row at this prompt, reset by any key
  queue: RemoteMessage[];           // set when the code is accepted
  index: number;                    // current message
  pending: 'text' | null;           // a text-booking-link effect is out and its result has not come back
}

type RemoteEvent =
  | { type: 'call-answered' }
  | { type: 'key'; key: Key }
  | { type: 'silence' }                                             // driver's timer fired
  | { type: 'code-checked'; result: 'ok'; messages: RemoteMessage[] }
  | { type: 'code-checked'; result: 'wrong' | 'locked' }
  | { type: 'text-result'; outcome: 'sent' | 'opted-out' | 'texted-recently' | 'no-number' | 'refused' | 'failed' }
  | { type: 'effect-failed'; effect: RemoteEffect['type'] }
  | { type: 'invoice-heard'; speech: string }
  | { type: 'hung-up' };

type RemoteEffect =
  | { type: 'verify-code'; code: string }
  | { type: 'play-message'; messageId: string; transcript: string }
  | { type: 'mark-heard'; messageId: string }
  | { type: 'text-booking-link'; messageId: string }
  | { type: 'erase-message'; messageId: string }
  | { type: 'start-invoice' }                                       // beep, then listen
  | { type: 'draft-invoice'; speech: string }
  | { type: 'hang-up' };

interface Prompt { id: PromptId; text: string }                    // text is what is spoken
interface Step { state: RemoteState; prompts: Prompt[]; effects: RemoteEffect[] }
```
`RemoteState` holds the queue so the script stays pure. The queue arrives in the `code-checked` event, so nothing about a message is in the state before the code is accepted (1.8).

## The call script
`step` is a table keyed by `phase`, then by event. Anything not in the table is a no-op that returns the same state, no prompts and no effects (10.4). Once `phase` is `ended`, every event is a no-op (10.5).

| Phase | Event | Next phase | Prompts and effects |
|---|---|---|---|
| (start) | `call-answered` | `ask-code` | Opening prompt naming the business (1.1, 9.3) |
| `ask-code` | key `0`-`9`, fewer than 3 digits | `ask-code` | Digit added, nothing said |
| `ask-code` | key `0`-`9`, third digit | `checking-code` | Effect `verify-code` (1.2) |
| `ask-code` | key `*` | `ask-code` | Digits cleared, ask again (1.3) |
| `ask-code` | key `#` | `ask-code` | Ignored (1.4) |
| `ask-code` | `silence`, first | `ask-code` | Ask again (1.7) |
| `ask-code` | `silence`, second | `ended` | Goodbye, effect `hang-up` (1.7) |
| `checking-code` | `code-checked` ok | `message`, or `ask-invoice` if the queue is empty | "You have N new messages." and the first announcement, or "no new messages" and the invoice prompt (3.1, 3.6) |
| `checking-code` | `code-checked` wrong, tries left | `ask-code` | "That code is not right." and ask again (1.5) |
| `checking-code` | `code-checked` wrong, third | `ended` | Goodbye, `hang-up` (1.6) |
| `checking-code` | `code-checked` locked | `ended` | "The machine is locked. Try again later.", `hang-up` (2.5) |
| `message` | key `1` | `message` | Effects `play-message`, `mark-heard`; then the keys again (4.1, 4.4) |
| `message` | key `2` | `message` | Effect `text-booking-link` (5.1); the prompt waits for `text-result` |
| `message` | `text-result` | `message` | One prompt per outcome (5.3 to 5.7) |
| `message` | key `9` | `confirm-erase` | "Press 9 again to erase it. Any other key keeps it." (6.1) |
| `message` | key `#`, not last | `message` | Announce the next message (7.1) |
| `message` | key `#`, last | `ask-invoice` | "After the beep, say your invoice." and effect `start-invoice` (7.2, 8.1) |
| `message` | key `*` | `message` | Announcement and keys again (3.7) |
| `message` | other key | `message` | "That key does nothing here." and the keys (7.3) |
| `message` | `silence`, first / second | `message` / `ended` | Keys again / goodbye and `hang-up` (7.4) |
| `confirm-erase` | key `9` | next `message`, or `ask-invoice` after the last | Effect `erase-message`, "Erased." and the next announcement (6.2) |
| `confirm-erase` | any other key | `message` | "Kept." and the keys (6.3) |
| `ask-invoice` | `invoice-heard`, words | `ended` | Effect `draft-invoice`, draft prompt, `hang-up` (8.2, 8.4) |
| `ask-invoice` | `invoice-heard`, empty | `ended` | "No invoice heard.", `hang-up` (8.5) |
| any | `effect-failed` | same | "Something went wrong." and the keys again (12.8) |
| any | `hung-up` | `ended` | Nothing |

Choices that need a reason:
- **Erase asks twice.** The brief says 9 erases. A stray press while driving would delete a customer's message, and erasing cannot be undone from the keypad. A second 9 is one extra press. Old machines erased at once; this one trades a press for safety (6.1).
- **Erase is a soft delete.** The message gets `erasedAt`. It leaves the inbox, the count and the queue, but its booked job and the "Kept this week" figures stay true (6.4, 6.5). `MessageStatus` is unchanged, so the existing screens keep working.
- **One effect per press.** Key 2 emits `text-booking-link` once and the script then waits for `text-result`; a second 2 before the result is a no-op because `pending` is `'text'` (10.6).
- **Marking heard never lowers a status.** `mark-heard` is carried out only when the status is `new`, so a message already called back is not demoted (4.3). The check is in the driver's call to the existing status route, and the script emits the effect only for messages whose `RemoteMessage` was in the queue as new.
- **Hang-ups are not in the queue.** The inbox's seven-segment counter counts every new message; the remote count skips hang-ups, because a hang-up has nothing to hear (3.2).
- **Order.** Emergency, soon, routine, oldest first within each, matching the inbox's "Call back now" strip (3.3).
- **No amounts spoken.** The script never says a price or total. The owner sees the exact total on the confirm screen (8.6).

### Prompts
Prompt text lives in one table in the domain file. Examples:
- Opening: "This is the answering machine for Hollow Creek Plumbing and Appliance. Enter your three-digit remote code."
- Count: "You have 3 new messages."
- Announcement: "Message 1 of 3. Emergency. From Priya Shah. Burst water heater. Press 1 to play, 2 to text back, 9 to erase, pound for next."
- Invoice: "After the beep, say your invoice."
- Draft: "Got it. Your invoice is a draft. Nothing goes out until you approve the total."

Every prompt is checked by a test for length (9.2) and for words that claim a person or a name (9.1).

## Remote code
- `Business.remoteCode: string` holds 3 digits, `'427'` in the seed (2.1). `GET /api/business` and every other response drop the field (2.3). A test serializes each route's response and searches it for the code.
- `db.remoteFailures: string[]` holds the ISO times of recent wrong codes. `checkRemoteCode` drops entries older than 15 minutes, answers `locked` when five remain, answers `ok` or `wrong` otherwise, and returns the new list. A correct code clears the list (2.4, 2.6). The failure list is per business, not per caller ID, because caller ID can be faked and 1,000 codes are few.
- The comparison pads both strings to the same length and uses `timingSafeEqual`, as the webhook secret already does (2.2).
- With a 5 failures per 15 minutes limit, trying all 1,000 codes takes at most about 50 hours. This is a trade-off for a code that must be keyed one-handed; a longer code would be safer and is a setting away.

## Server routes
All three sit under `/api/remote`, run only while the simulator is on or the request carries the valid bearer secret used by the other hooks (2.7), validate the body with zod, and call one function in `src/server/services/remote.ts` (11.5).

| Route | Body | Answer | Errors |
|---|---|---|---|
| `POST /api/remote/code` | `{ code: string }` (exactly 3 digits) | `{ result: 'ok', messages: RemoteMessage[] }`, `{ result: 'wrong' }` or `{ result: 'locked' }` | 400 `invalid-request` |
| `POST /api/remote/messages/:id/text` | none | `{ outcome }`, one of `sent`, `opted-out`, `texted-recently`, `no-number`, `refused` | 404 `not-found` |
| `POST /api/remote/messages/:id/erase` | none | `{ erased: true }` | 404 `not-found` for unknown or already erased |

`remoteTextBack` reuses `sendText` from `texting.ts`, which already throws `OptedOutError`, and the same 10-minute cooldown constant as `receiveVoicemail`. It sets `textedAt` on success and records `textFailed` and the reason on a refusal, like `textBack` does today. It does not duplicate the opt-out or cooldown logic.

## The keypad simulation
- `Remote.tsx` holds a `RemoteState` in a reducer and a transcript of prompts. A key press calls `step`, appends the prompts, and the effect runner carries out each effect: `verify-code` posts to `/api/remote/code`, `play-message` speaks the transcript, `mark-heard` posts to the existing status route, `text-booking-link` and `erase-message` post to the new routes, `start-invoice` plays `beep()` and starts dictation (or shows a text box where dictation is unavailable), and `draft-invoice` shows a link to `/machine/invoice` carrying the words in router state. Each result goes back in as an event (12.7).
- `VoiceInvoice.tsx` reads `speech` from router state and fills its text box. It still calls the existing draft route, so the parser, price book and holds are unchanged (8.2, 12.9). It sends nothing until the owner approves the exact total (8.3).
- Spoken prompts use `speak()` from `src/client/lib/speech.ts`. The transcript always shows the text (12.4, 12.5).
- `dtmf(key)` in `sound.ts` plays the standard pair for 120 ms with the existing `tone` helper. Rows are 697, 770, 852 and 941 Hz; columns are 1209, 1336 and 1477 Hz; `*` is 941+1209, `0` is 941+1336 and `#` is 941+1477. It is silent when `AudioContext` is missing (12.6).
- Silence timers (10 seconds for the code, 20 seconds on a message) live in the driver and send `silence` events. The script counts them, so the logic is still tested without timers (1.7, 7.4).
- The Remote key joins `KEYS` in `Machine.tsx`. Keys are 56 pixels or more square (12.12). In demo mode (`/api/health` already reports `demo`) the screen prints the code (12.10).
- The existing `GET /api/messages` response already carries `newCount`; the layout reloads it when the call ends (12.11). `GET /messages` and the inbox filter out messages with `erasedAt`.

## The Amazon Connect flow
`infra/connect/remote-retrieval-flow.json` is a thin keypad front end. All decisions stay in the state machine; the flow only collects keys and speaks what the Lambda returns.

```
greet-and-ask-code   GetParticipantInput { Text: opening prompt, StoreInput: "True",
                       InputValidation.CustomValidation.MaximumLength: "3",
                       InputTimeLimitSeconds: "10", DTMFConfiguration.InterdigitTimeLimitSeconds: "5" }
  └─► turn-code        InvokeLambdaFunction { attributes: step=code, digits=$.StoredCustomerInput, caller }
        └─► route       branches on $.External.next: menu | invoice | goodbye
menu                 GetParticipantInput { Text: $.External.prompt, StoreInput: "False",
                       InputTimeLimitSeconds: "20" }  conditions Equals 1, 2, 9, #
  ├─ "1" ─► turn-1 ─► route      (one InvokeLambdaFunction per key, key attribute set statically)
  ├─ "2" ─► turn-2 ─► route
  ├─ "9" ─► turn-9 ─► route
  ├─ "#" ─► turn-pound ─► route
  └─ errors InputTimeLimitExceeded ─► turn-silence ─► route;  NoMatchingCondition, NoMatchingError ─► turn-other ─► route
invoice              record the spoken invoice (the same recording action the voicemail flow uses)
goodbye              MessageParticipant { Text: $.External.prompt } ─► DisconnectParticipant
```
- The flow contains no code and no list of messages. The Lambda keeps the `RemoteState` between turns and calls the three routes; it is not written here (13.5).
- Each `InvokeLambdaFunction` sets `InvocationTimeLimitSeconds` to 8 or less and `ResponseValidation.ResponseType` to `STRING_MAP`, so the Lambda answers with flat `prompt` and `next` strings.
- Keys other than 1, 2, 9 and `#` land in the `NoMatchingCondition` error, which sends the key `other` to the script.
- Entry point: how the owner reaches this flow instead of the voicemail flow (a second number, or a key pressed during the greeting) is not decided here; `infra/connect/README.md` lists both options and says nothing is deployed (13.6).
- The test `tests/unit/connect-remote-flow.test.ts` parses the file and checks: `Version`, `StartAction`, unique `Identifier`s, every `NextAction` target exists, the code input has `StoreInput: "True"` and `MaximumLength: "3"`, the menu has one `Equals` condition each for 1, 2, 9 and `#`, every `GetParticipantInput` has a `NoMatchingError` transition, and the text `427` appears nowhere in the file (13.1 to 13.5).

## Security and honesty
- The code check is server-side, so the client bundle never holds the code. The remote routes are closed unless the simulator is on or the bearer secret is valid, because the owner screens have no login yet (2.7).
- Texting from the keypad goes through `sendText`, so STOP is honoured and the 10-minute rule holds (5.3, 5.4). The owner can text only a number that is on a message they are listening to (5.2); the route takes a message id, never a number.
- Nothing about a message leaves the server before the code is accepted (1.8).
- Caller ID is not used to authenticate the owner. It can be faked, so the code is the only gate.
- The machine says it is a machine in the opening prompt and has no name (9.1, 9.3).

## Testing strategy
- **Unit, `tests/unit/remote-retrieval.test.ts`:** every row of the table above; the queue order and count; singular, plural and zero counts; wrong-code limits; silence handling; one effect per press; no-ops after the call ended; every prompt under 30 words and free of human-name claims; a JSON round trip of every effect; a property-style run of a long random key sequence (seeded) that checks the script never throws and never emits an effect after `ended`.
- **Unit, `tests/unit/remote-code.test.ts`:** `checkRemoteCode` for ok, wrong, five failures, expiry after 15 minutes, a correct code during lockout, and clearing on success, all with an injected `now`.
- **Unit, `tests/unit/connect-remote-flow.test.ts`:** the flow file as listed above.
- **API, `tests/unit/server-remote.test.ts`:** the three routes with `app.request`: right and wrong code, lockout, the code absent from `/api/business` and every remote response, a refused request when the simulator is off and no secret is sent, text outcomes (sent, STOP, recent, no number, provider refusal), erase hides the message from `/api/messages` and keeps the job and `kept` figures, and 404s.
- **End to end, `tests/e2e/remote.spec.ts`:** open `/machine/remote` from the navigation, key 4-2-7 on the keypad, read "You have N new messages", press 1, 2 and `#`, check the outbox for the booking text and the message status, erase one with 9 9, reach the invoice prompt, type the slip script, open the draft and see it on hold with nothing sent.
- **Coverage:** `scripts/spec-coverage.ts` adds the prefix `RR` for the `remote-retrieval` spec. No RR criterion is listed as checked elsewhere; the Connect flow is checked by its parse test.

## Open questions
- How the owner reaches the remote flow on a real number (second number or a key during the greeting).
- The phone path has no place to keep a draft invoice, because the existing draft route returns a draft without saving it. Making a phone call leave a draft behind needs a stored draft, which belongs in a later spec.
- A 3-digit code is what the brief asks for. The lockout makes guessing slow but not impossible; the owner's choice of a longer code is a later setting.
