# Requirements: Remote retrieval

## Introduction
Old answering machines let the owner call in from anywhere, key in a remote code and hear the messages. AfterBeep brings that back. The owner calls their own AfterBeep number from the truck, enters a 3-digit remote code, hears each new message, texts a caller the booking link, erases a message or skips to the next one with the keypad, and then says an invoice out loud. The spoken invoice becomes a draft in the existing voice-invoicing flow. Nothing is sent without the owner's approval of the exact total. This spec covers the call script (a pure state machine), the remote code and its lockout, the keypad simulation at `/machine/remote`, and the Amazon Connect keypad flow. It reuses texting and message status from the missed-call-booking spec (MC) and the draft and send gate from the voice-invoicing spec (VI).

Out of scope: deploying the Connect flow, the Lambda that drives the state machine from the phone, and saving drafts on the server so a phone call can leave one behind. The Connect flow is written and checked by a test, not deployed.

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
13.6 THE SYSTEM SHALL state in `infra/connect/README.md` that the flow is written and checked but not deployed.
