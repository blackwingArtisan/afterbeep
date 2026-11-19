# Requirements: Missed-call booking

## Introduction
When a one-person trade business cannot answer the phone, AfterBeep answers, records the caller, reads the message, and texts the caller a link to book a visit. The owner sees each message as a cassette in an inbox. This spec covers the pipeline from a recorded voicemail to a booked job, the local call simulator, and the outbox.

## Glossary
- **Owner**: the tradesperson who uses AfterBeep.
- **Caller**: the person who called the owner and left a message.
- **Message**: one recorded voicemail with its transcript and extracted details.
- **Extraction**: caller name, callback number, address, job, job category, urgency and a one-line summary.
- **Booking link**: a unique, unguessable URL texted to the caller.
- **Slot**: a fixed-length appointment window inside the owner's opening hours.

## Requirement 1: Answer and record
**User story:** As an owner, I want missed calls answered and recorded, so that no job is lost while I am working.

1.1 WHEN a call reaches the AfterBeep line THE SYSTEM SHALL play the owner's greeting followed by a beep and record the caller.
1.2 WHEN the phone platform reports a finished recording THE SYSTEM SHALL accept it only with a valid shared secret on the webhook.
1.3 IF the webhook secret is not configured THEN THE SYSTEM SHALL refuse webhook calls with a "not configured" error.
1.4 THE SYSTEM SHALL reject a caller ID that is not a valid US phone number.

## Requirement 2: Transcribe
**User story:** As an owner, I want every message written down, so that I can read it between jobs.

2.1 WHEN a recording arrives with the real transcriber selected THE SYSTEM SHALL transcribe it with Amazon Transcribe.
2.2 WHEN a message arrives with a transcript already produced on the device THE SYSTEM SHALL use that transcript.
2.3 IF transcription fails or times out THEN THE SYSTEM SHALL return a transcription error and SHALL NOT create a message.

## Requirement 3: Extract the details
**User story:** As an owner, I want the name, number, address, job and urgency pulled out, so that I can triage without listening.

3.1 WHEN a transcript is available THE SYSTEM SHALL extract caller name, callback number, address, job, job category, urgency and a summary.
3.2 WHEN the caller says a callback number THE SYSTEM SHALL prefer it over the caller ID; IF no number is said THEN THE SYSTEM SHALL use the caller ID.
3.3 WHEN the caller describes active water, gas, sparks, smoke or no heat THE SYSTEM SHALL mark the message as an emergency.
3.4 WHEN the caller asks for today, tomorrow or as soon as possible THE SYSTEM SHALL mark the message as soon, unless they also say there is no rush.
3.5 WHILE the Bedrock extractor is selected, IF the model output fails schema validation or the call fails THEN THE SYSTEM SHALL fall back to the rule-based extractor.
3.6 THE SYSTEM SHALL never invent an address or phone number that the caller did not say.
3.7 WHEN the caller says the furnace, boiler or heat pump has quit, stopped or gone out, or that the heat went out THE SYSTEM SHALL mark the message as an emergency.
3.8 WHEN a heating, cooling, hot-water or pipe problem comes with freezing weather, or with a baby, an elderly person or someone medically fragile in the house THE SYSTEM SHALL mark the message as an emergency.
3.9 WHEN the caller has no hot water or a leaking water heater and nothing more serious THE SYSTEM SHALL mark the message as soon.

## Requirement 4: Text the caller back
**User story:** As a caller, I want a quick text back with a way to book, so that I do not call the next plumber.

4.1 WHEN a message is filed THE SYSTEM SHALL send one text to the callback number containing the business name, the owner's first name, the job and a booking link.
4.2 WHEN the message is an emergency THE SYSTEM SHALL say the owner will call back and still include the booking link.
4.3 WHEN the message is not an emergency THE SYSTEM SHALL include the first open slot in the text.
4.4 THE SYSTEM SHALL text the caller even when the extraction is partial.
4.5 THE SYSTEM SHALL record the time the text was sent on the message.
4.6 IF a message has no caller name, no address, no recognised job and fewer than four meaningful words THEN THE SYSTEM SHALL file it without a text and record why.
4.7 IF the callback number was texted in the last 10 minutes THEN THE SYSTEM SHALL file the new message without another text and record why.
4.8 IF the text provider refuses the text-back THEN THE SYSTEM SHALL keep the message, record the reason, mark it retryable and let the owner retry the text.

## Requirement 5: Book a slot
**User story:** As a caller, I want to pick a time from my phone, so that the visit is booked without phone tag.

5.1 WHEN the caller opens a valid booking link THE SYSTEM SHALL show the business, the job as heard, the address and open slots.
5.2 THE SYSTEM SHALL offer only slots inside opening hours that do not overlap a booked job and start at least one hour from now.
5.3 WHEN the message is an emergency THE SYSTEM SHALL offer slots starting today; otherwise THE SYSTEM SHALL start from tomorrow.
5.4 WHEN the caller confirms an open slot THE SYSTEM SHALL create a scheduled job and link it to the message.
5.5 IF the slot was taken in the meantime THEN THE SYSTEM SHALL refuse the booking and show fresh slots.
5.6 IF the link was already used to book THEN THE SYSTEM SHALL show the existing booking and refuse a second one.
5.7 WHEN a job is booked THE SYSTEM SHALL text the caller a confirmation with the day and time.
5.8 IF the booking link is unknown THEN THE SYSTEM SHALL show a "link expired" page with the business name and a one-tap call button.
5.9 WHEN the caller opens a booking link THE SYSTEM SHALL show the address it heard in a field the caller can confirm or correct, and SHALL make the address the caller confirms the job's address.
5.10 IF no open slot is available in the search window THEN THE SYSTEM SHALL tell the caller to call the business and SHALL show the business phone number.

## Requirement 6: Cassette inbox
**User story:** As an owner, I want my messages to look like tapes on an answering machine, so that I can see what needs me at a glance.

6.1 THE SYSTEM SHALL show the number of unheard messages on a seven-segment counter with a blinking message light.
6.2 THE SYSTEM SHALL show each message as a cassette with name, job, urgency colour, summary, callback number, address, received time and booking status.
6.3 WHEN the owner presses Play THE SYSTEM SHALL read the message aloud and mark it heard.
6.4 THE SYSTEM SHALL offer a one-tap call back link to the callback number.
6.5 THE SYSTEM SHALL list new emergencies first, under a "Call back now" strip with a call button for each, and number tapes in the order the calls arrived.
6.6 THE SYSTEM SHALL show what the machine kept over the last seven days: calls answered, callers texted, callers booked, booked value at the invoiced or typical job price, and misheard amounts the owner corrected before sending.

## Requirement 7: Local call simulator and outbox
**User story:** As an evaluator, I want to run the whole flow on a laptop with no accounts, so that I can see it work.

7.1 THE SYSTEM SHALL provide a call simulator where a caller ID and a message can be given by sample, by voice (Web Speech API) or by typing.
7.2 WHEN the simulator places a call THE SYSTEM SHALL play a ring, the greeting and a beep, then run the same pipeline as a real call.
7.3 WHILE the local SMS adapter is selected THE SYSTEM SHALL write every text to an outbox shown word for word, with its link.
7.4 THE SYSTEM SHALL select every external service by environment variable and default to the free local implementation.
7.5 WHILE demo mode is off THE SYSTEM SHALL refuse simulated calls and the demo reset.
7.6 THE SYSTEM SHALL turn demo mode on by default only while every adapter is local, and SHALL let `AFTERBEEP_DEMO=on|off` override it.
7.7 WHEN an evaluator starts "the whole story" THE SYSTEM SHALL place a sample call on its own, skip the ring and greeting, show the exact text sent, and guide the evaluator through booking as the caller and billing the booked job by voice.
7.8 THE SYSTEM SHALL let the landing page machine play a missed call, show the price check, and open a real booking page.
