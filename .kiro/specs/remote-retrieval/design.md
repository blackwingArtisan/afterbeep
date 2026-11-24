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
| [Compare (flow language)](https://docs.aws.amazon.com/connect/latest/devguide/flow-control-actions-compare.html) | Parameter `ComparisonValue`, a single JSONPath identifier. The compared value is the result that conditions test; the only error is `NoMatchingCondition`. Available in every flow type. Conditions use `Operator` and `Operands` (`Equals` takes one string). Used for the `route` action in 13.3 and 13.4. |
| [MessageParticipant (flow language)](https://docs.aws.amazon.com/connect/latest/devguide/participant-actions-messageparticipant.html) | Parameters `Text`, `SSML`, `PromptId` or `Media`, only one of the first three; `Text` may be dynamic, such as `$.External.prompt`. No conditions; the only error is `NoMatchingError`. `SSML` and `PromptId` are voice only. Used to speak the Lambda's prompt in 13.5. |
| Search result for the Lambda timeout | A synchronous Lambda call from a flow may run at most 8 seconds. The state machine step is a table lookup and one store read, so this is not a constraint. |

The `aws-docs` server was not reachable in the session that wrote the flow (task 21), so the Compare and MessageParticipant pages were read from their Markdown versions on docs.aws.amazon.com. The same pages are what the server serves. The `$.StoredCustomerInput` path for stored digits comes from the Store customer input page above and is the one point the parse test cannot check.

### Added for the turn Lambda and the way in (requirements 14 to 16)
Looked up with the `aws-docs` MCP server (`read_documentation` and `search_documentation`) before writing the sections below.

| Page | What it gave this design |
|---|---|
| [Grant Connect access to your Lambda functions](https://docs.aws.amazon.com/connect/latest/adminguide/connect-lambda-functions.html) | The event a flow sends: `Details.ContactData` (with `Attributes`, `ContactId`, `CustomerEndpoint.Address`, `InitiationMethod` and more) and `Details.Parameters` (the invocation attributes the flow set), plus `Name`. The answer is a STRING_MAP (a flat object of string pairs) or JSON, chosen in the flow; it must be under 64 KB of UTF-8, and the page says values may include "only alphanumeric, dash, and underscore characters", although its own example returns `"$1000"` (see Open questions). A flow that cannot reach Lambda, gets an exception, an answer it does not understand or a timeout takes the Error branch. A failed synchronous call is retried up to three times within 8 seconds. A sequence of Lambda calls with no prompt between them is limited to 20 seconds. `$.External.<key>` always holds the answer of the latest call, so a value needed later must be stored as an attribute or passed as a parameter. Used in 14.2, 14.7, 14.18, 14.21 and 14.26. |
| [Flow block: AWS Lambda function](https://docs.aws.amazon.com/connect/latest/adminguide/invoke-lambda-function-block.html) | Synchronous timeout up to 8 seconds, asynchronous up to 60; STRING_MAP is a flat object of string pairs. Used in 14.21. |
| [InvokeLambdaFunction (flow language)](https://docs.aws.amazon.com/connect/latest/devguide/interactions-invokelambdafunction.html) | Re-read for this extension: `InvocationTimeLimitSeconds` is an integer from 1 to 8, `LambdaInvocationAttributes` may be static or dynamic, the answer lands under `$.External`, and `NoMatchingError` is the only error. Used in 14.2 and 16.1. |
| [Flow block: Set contact attributes](https://docs.aws.amazon.com/connect/latest/adminguide/set-contact-attributes.html) | Contact attributes may total 32 KB, and above that the contact takes the Error branch. Attributes set on the current contact reach later Lambdas, other flows and the contact record. Flow attributes (64 KB) and persisted flow attributes (128 KB, Amazon Connect Customer instances only) are kept out of the contact record but reach a Lambda only if passed as a parameter. Attribute keys must not contain `$` or `.`. Used in 14.8, 14.9 and 16.1. |
| [UpdateContactAttributes (flow language)](https://docs.aws.amazon.com/connect/latest/devguide/contact-actions-updatecontactattributes.html) | `Attributes` keys and values may be static or dynamic, `TargetContact` is `Current` or `Related`, all attributes are set or none, no conditions, `NoMatchingError` is the only error. The existing voicemail flow already uses it. Used in 16.1 and 16.2. |
| [TransferToFlow (flow language)](https://docs.aws.amazon.com/connect/latest/devguide/flow-control-actions-transfertoflow.html) | `ContactFlowId` must be fully static or a single JSONPath; execution jumps to the start of the other flow; no conditions; `NoMatchingError` is the only error; available in inbound and transfer flows only. Used in 15.2, 15.3 and 15.7. |
| [Flow block: Check contact attributes](https://docs.aws.amazon.com/connect/latest/adminguide/check-contact-attributes.html), with [Compare (flow language)](https://docs.aws.amazon.com/connect/latest/devguide/flow-control-actions-compare.html) | A flow compares a value with an Equals condition (also Starts With, Contains and others); matching is case-sensitive; `NoMatchingCondition` is the only error. Used in 15.2 and 15.3. |
| [List of contact attributes](https://docs.aws.amazon.com/connect/latest/adminguide/connect-attrib-list.html) | The caller's number is the system attribute "Customer address or number", `$.CustomerEndpoint.Address`, and in a Lambda it arrives as `CustomerEndpoint`. The table gives no number format. The Lambda page's sample event shows `"+1234567890"`, and the search result for E.164 relates to dialing; neither says an inbound Address is always E.164 (see Open questions). Used in 15.2. |
| Search result for [Play prompt](https://docs.aws.amazon.com/connect/latest/adminguide/play.html) | The summary says text-to-speech takes 3,000 billed characters (6,000 total). Only the search summary was read, not the page. Used in 14.19. |

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
- Entry point: how the owner reaches this flow is decided in "The phone path" below (caller ID routes, the code gates, no second number; requirements 15 and 16). `infra/connect/README.md` says nothing is deployed (13.6, 16.7).
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

## The phone path
This section covers requirements 14 to 16. The pure `step` stays the only call script; the phone adds a driver (the turn Lambda) and two flow changes.

```
owner's phone ─► AfterBeep number ─► voicemail flow
  check-owner  Compare $.CustomerEndpoint.Address  Equals REPLACE_WITH_OWNER_NUMBER
    ├─ equal ─► to-remote  TransferToFlow REPLACE_WITH_REMOTE_FLOW_ID ─► remote retrieval flow
    └─ anything else, or an error ─► save-caller ─► record ─► greeting ─► ... (unchanged)

remote retrieval flow, one turn:
  ask-code / menu / ask-code-again ─► turn-* (InvokeLambdaFunction, STRING_MAP, 8 s)
     ─► save-state (UpdateContactAttributes: remoteState = $.External.state)
     ─► route (Compare $.External.next): code | menu | invoice | goodbye
```

### Components added
| Component | File | Responsibility |
|---|---|---|
| Message mapping | `src/domain/remote-retrieval.ts` | `toRemoteMessage(message)`, pulled out of `remoteQueue` so the Lambda and the queue use one mapping (14.10) |
| Turn Lambda | `infra/connect/remote-turn.ts` | `handler`, built by `createHandler({ fetch, env, now })` so tests can inject a fake `fetch` |
| Voicemail flow | `infra/connect/contact-flow.json` | New first action `check-owner`, then `to-remote` |
| Remote flow | `infra/connect/remote-retrieval-flow.json` | `save-state`, the `code` branch, the `*` key |
| Tests | `tests/unit/connect-remote-turn.test.ts`, `tests/unit/connect-voicemail-flow.test.ts`, additions to `tests/unit/connect-remote-flow.test.ts` | Mocked `fetch` and sample Connect events; flow parse tests |

### The event and the answer
The Lambda reads this from the event, validated with zod (14.2):
```ts
{ Details: {
    ContactData: { ContactId: string; Attributes?: Record<string, string> },   // Attributes.remoteState
    Parameters: { step: 'code' | 'key' | 'silence' | 'invoice'; key?: string; digits?: string; caller?: string; contactId?: string }
  } }
```
It answers a flat string map (14.18):
```ts
{ prompt: string; next: 'code' | 'menu' | 'invoice' | 'goodbye'; state: string }
```
`next` is `invoice` only for a future driver that can take a recorded invoice; the Lambda does not answer it today (14.20). The flow already routes on it, so no flow change is needed later for that branch.

### Carrying the state between turns
Lambda is stateless and Connect gives a flow no per-call memory of its own, so the state travels in the contact:
1. The Lambda answers `state`.
2. The flow's `save-state` action copies `$.External.state` into the user-defined contact attribute `remoteState` (16.1). It must run before the next Lambda call, because `$.External` is overwritten by each call.
3. On the next turn Connect sends every user-defined attribute in `Details.ContactData.Attributes`, so the Lambda reads `remoteState` back with no extra parameter and no AWS SDK call (14.2).

Why this and not the alternatives:
- **Lambda calls `UpdateContactAttributes` through the Connect API.** Needs the AWS SDK, IAM permission and one more network call inside the 8 seconds. The flow action does the same job for free.
- **Persisted flow attributes.** They keep data out of the contact record, which is attractive, but the page says they exist only in Amazon Connect Customer instances and reach a Lambda only if passed as a parameter, and the flow-language action that sets them was not looked up. Attributes are documented for every instance. Revisit if the contact record turns out to matter (see Open questions).
- **A session store (DynamoDB or the AfterBeep server).** Works, but adds a store and cleanup rules for a call that lasts a few minutes. Not needed while the state is small.

Limits and what they mean here:
| Limit | Source | What the design does |
|---|---|---|
| Lambda answer under 64 KB | Lambda guide | The answer is a few thousand characters at most (14.9, 14.19) |
| All attributes of a contact total 32 KB, else the Error branch | Set contact attributes page | The Lambda refuses a state over 16,000 characters, half of that, to leave room for `afterbeepCaller` and the rest (14.9). My estimate: about 60 characters per queued message, so 100 messages is about 6,000 characters. The id format was not checked |
| Synchronous call at most 8 seconds, retried up to 3 times within that | Lambda guide, flow language | A 5-second budget per turn (14.21); effects safe to repeat (14.26) |
| Text-to-speech 3,000 billed characters | Play prompt search summary | Spoken text cut at 2,500 characters (14.19) |
| STRING_MAP values: letters, digits, `-`, `_` | Lambda guide | `state` uses exactly that alphabet (base64url, no padding); `prompt` is limited to a small set of plain marks (14.19). Whether `prompt` is accepted with spaces is an open question |

Message data that must not leave the server stays out of the attribute (14.8). The attribute is a contact attribute, so it is part of the contact record. It holds only ids, urgency, a can-text flag, the phase and counters. Caller names, jobs and transcripts are fetched from the server on each turn (14.10) and spoken, never stored in Connect. The remote code is never stored at all: the digits arrive as a Lambda parameter, go to the server and are dropped. One thing outside this design's control: if flow logging is on for the remote flow, Connect writes attribute and parameter values to CloudWatch. The README says to leave flow logging off for that flow (16.7).

An encoded state looks like `eyJwIjoibWVzc2FnZSIs...`: `{"v":1,"p":"message","w":0,"s":0,"i":1,"k":null,"q":[["id1","e",1],["id2","s",0]]}` in base64url. `businessName` is not stored; the opening prompt is the only prompt that uses it and the flow speaks that one (14.3).

### One turn
```
turn(event)
  1  read step, key, digits, saved state; validate (14.2)
  2  state := saved state, or for step=code with none: startState('') then call-answered, prompts dropped (14.3)
  3  if phase in message | confirm-erase | ask-invoice: GET /api/messages, rebuild queue, drop erased ids (14.10, 14.11)
  4  events := digits -> keys (or silence) | key | silence | invoice-heard with no words (14.4 to 14.6, 14.20)
  5  for each event, at most 6 steps (14.24):
        r := step(state, event); collect r.prompts; state := r.state
        for each effect in r.effects, once:  run it (table below); a result becomes the next event
  6  answer { prompt: speakable(texts), next: nextFor(state), state: encode(state) }
  any throw, timeout or bad answer anywhere above -> the failure answer (14.22)
```
`step` is called with the same state and event types as the browser, so a key sequence gives the same prompts on both drivers. A test runs one scripted call through `handler` and through `step` directly and compares the prompts (14.1).

### Effects on a phone
| Effect | What the Lambda does | Result fed back |
|---|---|---|
| `verify-code` | `POST /api/remote/code { code }` (14.13) | `code-checked` ok with messages, wrong, or locked; a failed request gives `effect-failed` |
| `play-message` | Put the transcript at the front of the turn's spoken text (14.14) | none |
| `mark-heard` | If the message is `new` in the list read in step 3, `POST /api/messages/:id/status { status: 'heard' }` (14.15) | none; a failure is ignored. This differs from the browser, which shows "something went wrong", because the transcript was already spoken and the message simply stays new |
| `text-booking-link` | `POST /api/remote/messages/:id/text` (14.16) | `text-result` with the outcome, or `effect-failed` |
| `erase-message` | `POST /api/remote/messages/:id/erase`; a 404 counts as done (14.17) | none, or `effect-failed` on any other failure |
| `start-invoice` | Not carried out; see below | none |
| `draft-invoice` | Never emitted on a phone today, because no words arrive | none |
| `hang-up` | Nothing; the answer's `next` is `goodbye`, and the flow disconnects | none |

Right after `verify-code` succeeds, the code is a local variable and nothing else (14.13). The lockout is the server's (2.4), so a Lambda that is called again by a retry or by a second call cannot get around it.

Step 3 needs the list of messages in the turn's own memory, not in the state. `GET /api/messages` is the route the browser's mark-heard rule already uses, and the status route is the existing one (11.4), so the phone adds no new server route. The route sits outside `/api/remote/*`, so the bearer secret is sent but not required by it today.

When a message was erased earlier in this same call, its id is no longer in the list. The Lambda drops it from the queue and moves the index so that it still points at the same message (14.10). If the message the index points at is gone, for example erased in the app during the call, the turn fails and the call ends politely (14.11). That is rare enough not to need a smarter recovery.

### The prompt and the next branch
The spoken text of a turn is the transcript (if `play-message` ran) followed by the step's prompts, joined with a space. Characters outside letters, digits, spaces and `. , ? ! ' -` are removed, because caller transcripts are untrusted text and the Lambda guide limits what a STRING_MAP value may hold (14.19).

| Phase after the turn | `next` | Why |
|---|---|---|
| `ask-code` | `code` | Wrong code, silence or a failed check: ask again with the Lambda's prompt (16.3) |
| `message`, `confirm-erase` | `menu` | The menu speaks `$.External.prompt` and reads one key |
| `ended` | `goodbye` | The goodbye block speaks `$.External.prompt` and disconnects |
| `ask-invoice` | `goodbye` after the phone rule below | Never leaves a call waiting for an invoice that cannot be taken |
| `checking-code` | not reachable | `verify-code` is resolved inside the same turn |

### The invoice step on a phone today
Nothing on the phone side can turn the owner's speech into words yet: the flow has no transcription of what the owner says after the beep, and the existing draft route (`POST /api/invoices/draft`) returns a draft without saving it, so there is nowhere for a draft to wait for the app. So when the script reaches `ask-invoice` (after the last message, or at once when there are none), the Lambda does not say "After the beep, say your invoice." and does not start a recording. It feeds `invoice-heard` with no words and says "Invoices by phone are not ready. Use the app." The script's own `no-invoice` prompt ("No invoice heard.") is dropped for the phone, because it would mislead. The call ends with `next` `goodbye`, no draft is made and nothing is sent (14.20, 8.3). The invoice branch and the recording actions stay in the flow for the day a later spec adds transcription and stored drafts; they are unreachable until the Lambda answers `invoice`.

### Failure
Every turn runs inside one catch that returns the failure answer: "Something went wrong. Goodbye.", `next` `goodbye`, and an ended state (14.22). That covers a bad event, bad state, an oversize state, a server that is down, a timeout (each request is aborted when the 5-second budget runs out, 14.21), a response that fails its schema, and a bug. The flow has its own `went-wrong` message for the case where Connect itself cannot get an answer (the Error branch), so a Lambda that crashes outright still ends in a spoken apology. One distinction: a failed effect inside a working call (a text that did not go out, an erase that failed) is not a turn failure. The script handles it with `effect-failed` and says so, as in the browser (12.8, 14.16, 14.17).

### Caller ID and security
- The caller's number routes the call and nothing else (15.5). The Lambda ignores the `caller` parameter, and the server never sees it. A faked caller ID gets an attacker only to the code prompt, where the 5-wrong-codes lockout and the 3-tries-per-call limit apply as before (1.5, 1.6, 2.4). The lockout is per business, not per caller, so a faked ID does not reset it.
- An owner whose number is withheld, or who calls from a different phone, gets the voicemail greeting. That is the safe failure: nothing about messages is revealed (1.8).
- The transfer happens before `save-caller` and `record`, so a remote call is never recorded, never gets `afterbeepCaller`, and never reaches the voicemail Lambda (`voicemail-to-webhook.ts`) as a voicemail (15.6).
- The webhook secret is read from `AFTERBEEP_WEBHOOK_SECRET`, sent as a bearer token, and logged nowhere (14.12, 14.23, 16.8). The Lambda writes no digit, transcript, name or job to a log (14.23).
- The two placeholders keep the owner's number and the flow id out of git (15.4).
- Nobody can reach the Lambda except Connect: the Connect console adds a resource permission for `connect.amazonaws.com` when the function is added to the instance (Lambda guide). Even so the Lambda trusts nothing in the event beyond its schema.

### The voicemail flow change
`contact-flow.json` gets a new `StartAction` `check-owner` (a `Compare` on `$.CustomerEndpoint.Address` with one `Equals` condition whose operand is `REPLACE_WITH_OWNER_NUMBER`) and a `to-remote` action (`TransferToFlow`, `ContactFlowId` `REPLACE_WITH_REMOTE_FLOW_ID`). The `Compare` default and its `NoMatchingCondition` error and the `to-remote` error all go to `save-caller`, so every path other than a match is today's flow (15.3). The existing actions are not edited. The comparison is exact and case-sensitive, so the owner's number is written the way Connect reports it, probably E.164 such as `+15555550100` (see Open questions). Sample numbers in any test use the 555-01xx range, and the tracked files never hold a real one (15.4, 16.8).

### The remote flow change
- Each of the nine turn actions (`turn-code`, `turn-1`, `turn-2`, `turn-9`, `turn-pound`, `turn-star`, `turn-silence`, `turn-other`, `turn-invoice`) goes to `save-state`, then `route` (16.1). `save-state` has an error transition to `went-wrong` (16.2).
- `route` gets a fourth condition, `code`, that leads to `ask-code-again`: a `GetParticipantInput` with `Text` `$.External.prompt`, `StoreInput` `True`, a maximum of 3 digits, the 10-second limit, the 5-second inter-digit limit and the error transitions of 13.4, which then goes to `turn-code` (16.3). The original `ask-code` keeps its static opening prompt.
- `menu` gets an `Equals` condition for `*` that goes to the new `turn-star` with the key `*` (16.4). Without it, `*` would fall into `NoMatchingCondition` and be sent as `other`, so the repeat key (3.7) would answer "That key does nothing here." on a phone.
- The `invoice` branch, `say-invoice-prompt`, `record-invoice`, `listen-invoice` and `turn-invoice` stay as they are.
- `tests/unit/connect-remote-flow.test.ts` keeps its checks (13.1 to 13.5, 16.5) and adds checks for 16.1 to 16.4.

### Documentation
`infra/connect/README.md` replaces "Two ways to reach it, not decided yet" with the decision: the owner calls the business's own number, the voicemail flow recognises the owner's number and transfers, the 3-digit code is the gate, no second number, caller ID only routes (16.6). It says the Lambda is written and tested with mocks but not deployed, and that neither flow has been imported (16.7). It lists the placeholders (`REPLACE_WITH_OWNER_NUMBER`, `REPLACE_WITH_REMOTE_FLOW_ID`, `REPLACE_WITH_REMOTE_TURN_LAMBDA_ARN`), the Lambda's environment (`AFTERBEEP_URL`, `AFTERBEEP_WEBHOOK_SECRET`), that the remote flow must be an inbound flow (15.7), that the function must be added to the Connect instance, and that the Lambda is bundled with its import of `src/domain/remote-retrieval.ts` (the existing Lambdas are plain `.mjs` files and import nothing from `src`; a bundling step is needed, and `template.yaml` is not changed in this extension).

### Testing strategy for the phone path
- **Unit, `tests/unit/connect-remote-turn.test.ts`**, with a fake `fetch` that records requests and answers from a table, and sample Connect events built by a helper:
  - 14.1: a scripted call through `handler` matches the prompts of `step` driven directly; the file imports from `src/domain/remote-retrieval` and defines no `phase` switch.
  - 14.2 to 14.6: event parsing, the first code turn, `Timeout` and short digits, key `other` in both phases, silence.
  - 14.7 to 14.9: the state alphabet, the content (a test that serializes the state and searches it for the transcript, caller name, job, code and secret), and the oversize failure.
  - 14.10, 14.11: queue rebuild, an id erased earlier, the current id missing.
  - 14.12 to 14.17: each effect's request (method, path, bearer header), a schema failure, mark-heard only for `new`, a not-found erase.
  - 14.18, 14.19: answer shape, `next` for each phase, character filtering of a transcript with markup in it, the 2,500-character cut.
  - 14.20: the invoice step says the phone rule, makes no request to the draft route and ends the call.
  - 14.21, 14.22: a fetch that never answers is aborted and the failure answer comes back inside the budget (fake timers); a throwing fetch, a garbage state and a bad event each give the failure answer and nothing throws.
  - 14.23: a spy on `console` sees no digit, transcript, secret or state.
  - 14.24, 14.26: one request per effect; the same turn run twice gives a refused second text and a counted erase.
  - 14.25: every prompt the Lambda adds is under 30 words and free of a name or a claim to be a person.
- **Unit, `tests/unit/connect-voicemail-flow.test.ts`:** the voicemail flow parses, starts at `check-owner`, has one `Equals` condition with the placeholder, transfers with the second placeholder, sends every other path to `save-caller`, leaves the old actions as they were, and holds no phone number or flow id (15.2 to 15.4, 15.6, 16.8).
- **Unit, additions to `tests/unit/connect-remote-flow.test.ts`:** 16.1 to 16.5.
- **Unit, README test:** the README states the decision and the not-deployed status (15.5, 15.7, 16.6, 16.7).
- **Server side of 15.5:** the Lambda test passes a `caller` that matches nothing and one that matches the owner and checks that the requests are identical; the existing lockout tests (2.4) cover the server.
- **Not tested:** a real Connect instance, a real phone, flow logging and real caller-ID formats. The README says so.

## Open questions
- **Which characters Connect accepts in a STRING_MAP value.** The Lambda guide says only alphanumeric, dash and underscore, but its example answer contains `$`, and `prompt` needs spaces and marks to be spoken. The design keeps `state` strictly inside that alphabet and `prompt` to plain marks. If Connect rejects `prompt` on a first real test, the fallback is `ResponseType` `JSON` with the same flat keys; the flow would change in one field per turn action.
- **The caller number's format.** The docs show `+1234567890` in a sample event but do not say an inbound `CustomerEndpoint.Address` is always E.164. The owner's number in the placeholder must be written the way Connect reports it, which only a real call shows. Also unchecked: what number a carrier shows when a call has been forwarded; the design assumes the owner dials the number directly, not through their own forwarding.
- **Where the state should live.** The attribute puts ids and counters in the contact record. If that is a concern, persisted flow attributes (not in the record, 128 KB, Amazon Connect Customer instances only) are the alternative once the flow-language action for them has been looked up.
- **Flow logging.** With logging on, Connect writes attribute and parameter values, including the keyed digits, to CloudWatch. The README asks for it off on the remote flow; nothing enforces that.
- **Taking a spoken invoice by phone.** It needs a transcript of what the owner says after the beep and a stored draft, because the existing draft route returns a draft without saving it. Neither exists, so the phone ends at "Invoices by phone are not ready" (14.20). Both belong in a later spec; this one does not try to answer them.
- **A 3-digit code.** A 3-digit code is what the brief asks for. The lockout makes guessing slow but not impossible; the owner's choice of a longer code is a later setting.
- **A phone call's invoice recording.** The remote flow still has recording actions on the invoice branch that nothing reaches today. If that branch is wired later, the recording needs a storage and retention decision.
