# Requirements: Remote retrieval

## Introduction
Old answering machines let the owner call in from anywhere, key in a remote code and hear the messages. AfterBeep brings that back. The owner calls their own AfterBeep number from the truck, enters a 3-digit remote code, hears each new message, texts a caller the booking link, erases a message or skips to the next one with the keypad, and then says an invoice out loud. The spoken invoice becomes a draft in the existing voice-invoicing flow. Nothing is sent without the owner's approval of the exact total. This spec covers the call script (a pure state machine), the remote code and its lockout, the keypad simulation at `/machine/remote`, and the Amazon Connect keypad flow. It reuses texting and message status from the missed-call-booking spec (MC) and the draft and send gate from the voice-invoicing spec (VI).

Out of scope: deploying the Connect flows and the Lambda, and saving drafts on the server so a phone call can leave one behind. The Connect flow is written and checked by a test, not deployed. Requirements 14 to 16 extend this spec with the turn Lambda that drives the state machine from the phone and the way a real call reaches the remote flow; the Lambda is written and tested with mocks, not deployed.

## Glossary
- **Remote code**: the 3-digit code the owner keys in to reach their messages. It is 427 in the demo business.
- **Remote call**: one call from the owner to their own AfterBeep number, from the first prompt to hang-up.
- **Queue**: the new messages read out on a remote call, in the order they are read.
- **Current message**: the message the machine has announced and is waiting on.
- **Prompt**: one sentence the machine says, as plain data with an id and text.
- **Effect**: a plain-data instruction from the state machine that the caller carries out, such as playing a message or texting a booking link.
- **Key**: one of `0`-`9`, `*` or `#` on the keypad.
- **Lockout**: refusing every code check for a period after too many wrong codes.

## Requirement 1: Answer and ask for the remote code
**User story:** As an owner, I want the machine to ask for my code before it says anything, so that nobody else can hear my callers.

1.1 WHEN a remote call connects THE SYSTEM SHALL say it is the machine for the business and ask for the 3-digit remote code.
1.2 WHEN the third digit is keyed THE SYSTEM SHALL check the code at once, without waiting for a terminating key.
1.3 WHEN the owner presses `*` while keying the code THE SYSTEM SHALL clear the digits and ask again.
1.4 WHEN a key other than `0`-`9` or `*` is pressed while the code is asked THE SYSTEM SHALL ignore it.
1.5 IF the code is wrong THEN THE SYSTEM SHALL say so and ask again, with at most three tries on one call.
1.6 IF the third try is wrong THEN THE SYSTEM SHALL say goodbye and hang up without reading any message.
1.7 IF no key arrives for 10 seconds while the code is asked THEN THE SYSTEM SHALL ask once more, and IF the second wait also passes THEN THE SYSTEM SHALL hang up.
1.8 THE SYSTEM SHALL reveal no message, caller name, number or count before the code is accepted.

## Requirement 2: The remote code on the server
**User story:** As an owner, I want a short code that is still hard to guess, so that I can key it with one hand.

2.1 THE SYSTEM SHALL keep the remote code as a 3-digit setting of the business, and the demo business SHALL use 427.
2.2 THE SYSTEM SHALL compare a keyed code with the saved code in constant time.
2.3 THE SYSTEM SHALL never include the remote code in any API response, including the business record.
2.4 IF five wrong codes are keyed within 15 minutes, on one call or several, THEN THE SYSTEM SHALL refuse every code check, including a correct one, until 15 minutes after the fifth failure.
2.5 WHEN a code check is refused by the lockout THE SYSTEM SHALL answer that the machine is locked, and the call script SHALL say so and hang up.
2.6 WHEN a correct code is accepted THE SYSTEM SHALL clear the count of wrong codes.
2.7 THE SYSTEM SHALL accept remote requests only while the call simulator is on or when the request carries the valid phone webhook secret.

## Requirement 3: Announce the new messages
**User story:** As an owner, I want to hear what is waiting, most urgent first, so that I can decide what to do before I get out of the truck.

3.1 WHEN the code is accepted THE SYSTEM SHALL say "You have N new messages.", using "You have 1 new message." for one and "You have no new messages." for none.
3.2 THE SYSTEM SHALL count only messages that are new, not erased and not hang-ups.
3.3 THE SYSTEM SHALL read emergencies first, then soon, then routine, and the oldest first within each.
3.4 WHEN a message is announced THE SYSTEM SHALL say its position, its urgency when it is an emergency or soon, the caller's name or "an unknown caller", and the job.
3.5 WHEN a message is announced THE SYSTEM SHALL then say the keys: 1 to play, 2 to text back, 9 to erase, pound for next.
3.6 IF there are no new messages THEN THE SYSTEM SHALL go straight to asking for the invoice.
3.7 WHEN the owner presses `*` on a message THE SYSTEM SHALL repeat the announcement and the keys.

## Requirement 4: Play a message (key 1)
**User story:** As an owner, I want to hear the caller in full, so that I get the details the summary left out.

4.1 WHEN the owner presses 1 THE SYSTEM SHALL play the current message's transcript and mark it heard.
4.2 WHEN a message is announced but not played THE SYSTEM SHALL leave its status as it was.
4.3 IF the current message is already called back THEN THE SYSTEM SHALL keep that status when it is played.
4.4 WHEN a message has been played THE SYSTEM SHALL say the keys again.

## Requirement 5: Text the caller the booking link (key 2)
**User story:** As an owner, I want one key to send a caller my open times, so that I can book a job without picking up the phone.

5.1 WHEN the owner presses 2 THE SYSTEM SHALL text the booking link to the current message's callback number, through the same texting path as the text-back.
5.2 THE SYSTEM SHALL text only the callback number on the current message.
5.3 IF the callback number replied STOP THEN THE SYSTEM SHALL send nothing and say the caller asked not to be texted.
5.4 IF the callback number was texted in the last 10 minutes THEN THE SYSTEM SHALL send nothing and say the caller was texted a moment ago.
5.5 IF the message has no callback number THEN THE SYSTEM SHALL send nothing and say there is no number to text.
5.6 IF the text provider refuses the text THEN THE SYSTEM SHALL keep the message, record the reason as the text-back does, and say the text did not go out.
5.7 WHEN a text goes out THE SYSTEM SHALL record the time on the message, say it was texted, and stay on the current message.

## Requirement 6: Erase a message (key 9)
**User story:** As an owner, I want to clear a message I am done with, without erasing one by a stray keypress.

6.1 WHEN the owner presses 9 on a message THE SYSTEM SHALL ask the owner to press 9 again to erase it, and say any other key keeps it.
6.2 WHEN the owner presses 9 a second time THE SYSTEM SHALL erase the message, say it is erased and move on to the next message.
6.3 WHEN the owner presses any other key after the question THE SYSTEM SHALL keep the message, say it is kept and say the keys again.
6.4 WHEN a message is erased THE SYSTEM SHALL record when, and SHALL hide it from the inbox, the new-message count and later remote calls.
6.5 WHEN a message is erased THE SYSTEM SHALL keep its booked job and the "Kept this week" figures.
6.6 IF the message to erase is unknown or already erased THEN THE SYSTEM SHALL refuse with a not-found error and change nothing.

## Requirement 7: Skip, repeat and silence (#, other keys)
**User story:** As an owner, I want to move through the messages quickly and never get stuck on a wrong key.

7.1 WHEN the owner presses `#` on a message THE SYSTEM SHALL move to the next message without changing any status.
7.2 WHEN the owner presses `#` on the last message THE SYSTEM SHALL ask for the invoice.
7.3 WHEN the owner presses a key that has no meaning at that point THE SYSTEM SHALL say so and say the keys again.
7.4 IF no key arrives for 20 seconds on a message THEN THE SYSTEM SHALL say the keys again once, and IF the next wait also passes THEN THE SYSTEM SHALL say goodbye and hang up with every message left as it was.

## Requirement 8: Say the invoice
**User story:** As an owner, I want to bill the job right after I hear my messages, so that I do not have to type it at midnight.

8.1 WHEN the last message is done THE SYSTEM SHALL say "After the beep, say your invoice." and then beep.
8.2 WHEN the owner's spoken invoice arrives THE SYSTEM SHALL hand its words to the existing voice-invoicing draft, with the same parser, price book and holds (VI 1 to 3).
8.3 THE SYSTEM SHALL NOT send an invoice from a remote call; sending SHALL still require the owner's approval of the exact total (VI 4.4).
8.4 WHEN the spoken invoice is handed over THE SYSTEM SHALL say it is a draft and that nothing goes out until the owner approves the total, and hang up.
8.5 IF no invoice words arrive THEN THE SYSTEM SHALL say no invoice was heard, make no draft and hang up.
8.6 THE SYSTEM SHALL NOT say any amount it worked out; totals appear only on the confirm screen.

## Requirement 9: An honest machine
**User story:** As a caller or owner, I want the machine to sound like a machine, so that nobody is fooled.

9.1 THE SYSTEM SHALL never give the machine a human name or say it is a person.
9.2 THE SYSTEM SHALL keep every prompt under 30 words.
9.3 THE SYSTEM SHALL use the business's name in the opening prompt and no other invented wording about the business.

## Requirement 10: A pure call script
**User story:** As a maintainer, I want the call script to be plain logic, so that every branch can be tested without a phone.

10.1 THE SYSTEM SHALL compute each step of a remote call as a pure function from a state and an event to a new state, prompts and effects, with the same inputs always giving the same output.
10.2 THE SYSTEM SHALL express every effect as plain data that survives a JSON round trip.
10.3 THE SYSTEM SHALL read no clock, no random number and no outside service while computing a step.
10.4 WHEN an event makes no sense in the current state THE SYSTEM SHALL leave the state unchanged and emit no effect.
10.5 WHEN a remote call has ended THE SYSTEM SHALL ignore every later event.
10.6 THE SYSTEM SHALL emit each effect once per key press, so a press cannot text or erase twice.

## Requirement 11: Server routes
**User story:** As a client of the machine, I want a few narrow routes, so that each effect has one place to run.

11.1 THE SYSTEM SHALL offer a route that takes a keyed code, validates it, and answers `ok`, `locked`, or `ok` with the queue of new messages.
11.2 THE SYSTEM SHALL offer a route that texts the booking link for one message and answers with what happened: sent, opted out, texted recently, no number, or refused.
11.3 THE SYSTEM SHALL offer a route that erases one message.
11.4 THE SYSTEM SHALL mark a message heard through the existing message status route and make a draft through the existing invoice draft route, with no new route for either.
11.5 THE SYSTEM SHALL validate every request body with a schema and call one service function per route.
11.6 IF a request body fails its schema THEN THE SYSTEM SHALL answer with an invalid-request error and change nothing.
11.7 IF the message in a route is unknown THEN THE SYSTEM SHALL answer with a not-found error.

## Requirement 12: The keypad simulation
**User story:** As an owner or a judge, I want to try a remote call in the browser, so that I can see it work without a phone line.

12.1 THE SYSTEM SHALL offer a Remote screen at `/machine/remote`, reachable from the machine navigation.
12.2 THE SYSTEM SHALL show a keypad with `0`-`9`, `*` and `#`, and each press SHALL be fed to the call script as a key.
12.3 THE SYSTEM SHALL also accept the same keys from the computer keyboard.
12.4 THE SYSTEM SHALL show each prompt as text, in order, as the machine says it.
12.5 WHERE the browser can speak THE SYSTEM SHALL speak each prompt, and WHERE it cannot THE SYSTEM SHALL still show the text.
12.6 WHEN a key is pressed THE SYSTEM SHALL play that key's standard keypad tone, and SHALL stay silent where audio is unavailable.
12.7 THE SYSTEM SHALL carry out each effect against the server routes and feed the result back to the call script.
12.8 IF an effect fails THEN THE SYSTEM SHALL say something went wrong and stay on the current message.
12.9 WHEN the machine asks for the invoice THE SYSTEM SHALL take the owner's words by dictation or typing, and offer to open the draft on the invoice screen with those words filled in.
12.10 WHILE demo mode is on THE SYSTEM SHALL show the demo remote code on the screen.
12.11 WHEN the call ends THE SYSTEM SHALL refresh the new-message count in the machine header.
12.12 THE SYSTEM SHALL make every keypad key at least 56 pixels square so it works one-handed on a phone.

## Requirement 13: The Amazon Connect keypad flow
**User story:** As a maintainer, I want the phone version written down and checked, so that moving to a real number is wiring, not design.

13.1 THE SYSTEM SHALL include `infra/connect/remote-retrieval-flow.json` as valid Amazon Connect flow language with a start action, unique identifiers and no transition to an action that does not exist.
13.2 THE SYSTEM SHALL ask for the remote code in that flow with a stored keypad input limited to three digits and an inter-digit time limit.
13.3 THE SYSTEM SHALL read the 1, 2, 9 and `#` keys in that flow with one equals condition for each key.
13.4 THE SYSTEM SHALL give every keypad input in that flow a no-matching-error transition, a timeout transition and a no-matching-condition transition where conditions are used.
13.5 THE SYSTEM SHALL keep the remote code out of that flow; the flow passes the keyed digits to a Lambda function that answers with the next prompt.
13.6 THE SYSTEM SHALL state in `infra/connect/README.md` whether the flow is deployed, and how it is created from the file.

## Extension: the phone path
Requirements 14 to 16 were added after requirements 1 to 13. They cover the Lambda function that the remote retrieval flow calls on every turn, and how a real call reaches that flow. Two decisions by the owner apply to all three:
- The owner reaches the remote menu by calling the business's own AfterBeep number from the owner's own phone. When the caller ID matches the owner's number, the voicemail flow hands the call to the remote retrieval flow, which asks for the 3-digit code. Every other caller gets the voicemail flow as before. There is no second number.
- Caller ID only routes the call. It can be faked, so the 3-digit code stays the only gate, with the lockout from requirement 2.

Extra glossary:
- **Turn**: one call from the Connect flow to the Lambda, caused by one key press, one silence or one keyed code.
- **Turn Lambda**: `infra/connect/remote-turn.ts`, the function that runs one turn of the call script.
- **Saved state**: the call state the Lambda hands back and the flow stores as the contact attribute `remoteState`, so the next turn can pass it back.

## Requirement 14: The turn Lambda
**User story:** As a maintainer, I want one small function that runs the shared call script for each phone turn, so that the phone and the browser keypad behave the same.

14.1 THE SYSTEM SHALL provide the turn Lambda as `infra/connect/remote-turn.ts`, export `handler` from it, and compute every turn with `step` and `startState` from `src/domain/remote-retrieval.ts`, with no second copy of the call script.
14.2 WHEN Amazon Connect invokes the Lambda THE SYSTEM SHALL read the turn name (`code`, `key`, `silence` or `invoice`), the key and the keyed digits from `Details.Parameters`, and the saved state from `Details.ContactData.Attributes.remoteState`, and SHALL validate all of them with a schema.
14.3 WHEN the turn is `code` and no state is saved THE SYSTEM SHALL start a call from `startState`, answer it, drop the opening prompt because the flow already spoke it, and then feed the keyed digits.
14.4 WHEN the keyed digits are not exactly three digits `0`-`9`, including the value `Timeout` that Store customer input leaves after no input, THE SYSTEM SHALL feed a silence event instead of key events.
14.5 WHEN the turn is `key` THE SYSTEM SHALL feed that key, and SHALL feed the key `other` as `0` once the code is accepted and as `#` while the code is asked, so that `other` never adds a code digit and never skips a message.
14.6 WHEN the turn is `silence` THE SYSTEM SHALL feed a silence event to the saved state.
14.7 THE SYSTEM SHALL answer every turn with the new state as `state`, encoded as base64url JSON that uses only letters, digits, `-` and `_`, for the flow to store as the contact attribute `remoteState`.
14.8 THE SYSTEM SHALL put in `state` only the phase, the counters, the index, the pending flag and, for each queued message, its id, urgency and whether it can be texted; it SHALL NOT put in it a transcript, caller name, job, keyed digit, the remote code or the webhook secret.
14.9 IF the encoded state is longer than 16,000 characters THEN THE SYSTEM SHALL treat the turn as a failure (14.22), so the contact's attributes stay well under the 32 KB limit.
14.10 WHEN the saved state is in the message, confirm-erase or ask-invoice phase THE SYSTEM SHALL read `GET /api/messages` and rebuild each queued message with the same mapping that `remoteQueue` uses, drop ids that were erased since the code was accepted, and keep the index on the same message.
14.11 IF the current message is no longer on the server THEN THE SYSTEM SHALL treat the turn as a failure (14.22).
14.12 THE SYSTEM SHALL send every server request to the address in `AFTERBEEP_URL` with `Authorization: Bearer` and the value of `AFTERBEEP_WEBHOOK_SECRET`, and SHALL validate every server response with a schema.
14.13 WHEN the script emits `verify-code` THE SYSTEM SHALL post the code to `/api/remote/code`, feed the answer back as `code-checked`, and keep the code out of the saved state and out of every log.
14.14 WHEN the script emits `play-message` THE SYSTEM SHALL speak that message's transcript first and then the step's prompts, so that "play" on a phone means the caller's words read aloud by the machine.
14.15 WHEN the script emits `mark-heard` THE SYSTEM SHALL post `heard` to the existing `/api/messages/:id/status` route only if the message is still `new` in the list it just read, and a failure of that post SHALL NOT end the call.
14.16 WHEN the script emits `text-booking-link` THE SYSTEM SHALL post to `/api/remote/messages/:id/text` and feed the outcome back as `text-result`, and IF the request fails THEN THE SYSTEM SHALL feed `effect-failed`.
14.17 WHEN the script emits `erase-message` THE SYSTEM SHALL post to `/api/remote/messages/:id/erase`, SHALL count a not-found answer as already erased, and IF any other failure happens THEN THE SYSTEM SHALL feed `effect-failed`.
14.18 THE SYSTEM SHALL answer with flat strings `prompt`, `next` and `state`, and `next` SHALL be `code` while the code is asked, `menu` on a message or an erase question, and `goodbye` once the call has ended or must end.
14.19 THE SYSTEM SHALL join the spoken text of a turn into `prompt`, keep only letters, digits, spaces and the marks `. , ? ! ' -` in it, and cut it at a word boundary at 2,500 characters, below the 3,000 billed characters that one text-to-speech prompt allows.
14.20 WHEN the call reaches the invoice step on a phone THE SYSTEM SHALL say that invoices by phone are not ready and to use the app, feed `invoice-heard` with no words so that no draft is made, answer `next` as `goodbye`, and SHALL NOT say the prompt that asks for an invoice.
14.21 THE SYSTEM SHALL finish a turn within a budget of 5 seconds, abort any server request still running at that point, and so answer inside the 8 seconds that a synchronous Lambda call from a flow allows.
14.22 IF anything fails in a turn, including a bad event, bad saved state, an oversize state, a server that is down, a timeout or a bad server answer, THEN THE SYSTEM SHALL answer "Something went wrong. Goodbye." with `next` `goodbye` and an ended state, and SHALL NOT throw.
14.23 THE SYSTEM SHALL write no keyed digit, transcript, caller name, job, secret or encoded state to any log; a log line SHALL name only the turn, the phase and the kind of failure.
14.24 THE SYSTEM SHALL carry out each effect once per turn and run at most six script steps in a turn.
14.25 THE SYSTEM SHALL keep every prompt that the Lambda adds itself under 30 words, with no human name and no claim to be a person.
14.26 THE SYSTEM SHALL be safe to run twice for one key press, because Connect retries a failed synchronous call up to three times: a repeated text is stopped by the 10-minute rule (5.4) and a repeated erase counts as done (14.17).

## Requirement 15: The way in
**User story:** As an owner, I want to call my own number and reach my messages, so that I do not need a second phone number.

15.1 THE SYSTEM SHALL let the owner reach the remote menu by calling the business's own AfterBeep number from the owner's own phone, and SHALL NOT need a second number.
15.2 WHEN a call starts in the voicemail flow THE SYSTEM SHALL compare the caller's number with the owner's number before it saves the caller or starts recording, and WHEN they are equal THE SYSTEM SHALL transfer the call to the remote retrieval flow.
15.3 IF the caller's number is different, withheld, or the comparison or the transfer fails THEN THE SYSTEM SHALL carry on in the voicemail flow with every existing action unchanged.
15.4 THE SYSTEM SHALL keep the owner's number and the remote flow's identifier out of every tracked file, using the placeholders `REPLACE_WITH_OWNER_NUMBER` and `REPLACE_WITH_REMOTE_FLOW_ID`.
15.5 THE SYSTEM SHALL use caller ID only to route the call, and neither the Lambda nor the server SHALL use it to accept, skip or relax the code check or the lockout (2.4).
15.6 WHEN a call is transferred to the remote flow THE SYSTEM SHALL NOT record it and SHALL NOT post it to the voicemail webhook.
15.7 THE SYSTEM SHALL state in `infra/connect/README.md` that the remote flow must be an inbound flow, because the Transfer to flow action is available only in inbound and transfer flows.

## Requirement 16: Flow changes and the record of the decision
**User story:** As a maintainer, I want the flow changes and the decision written down and checked, so that wiring a real number is a matter of filling in placeholders.

16.1 THE SYSTEM SHALL send every turn action in the remote flow to a `save-state` action that stores `$.External.state` as the contact attribute `remoteState`, and then to the `route` action.
16.2 IF `save-state` fails THEN THE SYSTEM SHALL go to the `went-wrong` message and hang up.
16.3 WHEN the Lambda answers `next` as `code` THE SYSTEM SHALL ask for the code again with `$.External.prompt` as the text, using stored input of at most three digits, the time limits of 13.2 and the error transitions of 13.4, and SHALL send the digits to the code turn.
16.4 THE SYSTEM SHALL read `*` on the menu with its own Equals condition and send the key `*` in its own turn, so that `*` repeats the announcement (3.7) on a phone.
16.5 THE SYSTEM SHALL keep requirements 13.1 to 13.5 true for the changed flow, and the remote code SHALL appear in neither flow file.
16.6 THE SYSTEM SHALL record in `infra/connect/README.md` the decision that the owner is recognised by caller ID plus the 3-digit code, with no second number, and that caller ID only routes the call.
16.7 THE SYSTEM SHALL say in `infra/connect/README.md` whether the turn Lambda and both flows are deployed, what has been tried on a real phone, and which placeholders the deploy fills in.
16.8 THE SYSTEM SHALL keep every new file in `infra/connect/` free of secrets and phone numbers; the Lambda reads its settings from the environment.
