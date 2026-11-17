import { TranscriptionError } from '../../adapters/transcriber/types';
import { openSlots } from '../../domain/slots';
import type { Message, VoicemailExtraction } from '../../domain/types';
import { emptyMessageReason, toE164 } from '../../domain/voicemail-rules';
import { ServiceError, type Deps } from './deps';
import { firstName, formatSlot } from './format';

export interface IncomingCall {
  /** Caller ID as received from the phone network. */
  from: string;
  transcript?: string;
  audioUri?: string;
  durationSec?: number;
}

function textBackBody(
  extraction: VoicemailExtraction,
  owner: string,
  businessName: string,
  url: string,
  firstOpening: string | null,
): string {
  const hi = `Hi ${firstName(extraction.callerName)}, it's ${owner} at ${businessName}.`;
  const job = extraction.job.split(':')[0]!.toLowerCase();
  if (extraction.urgency === 'emergency') {
    return `${hi} Got your message about your ${job}. I'll call you back the minute I'm off this job. Grab the earliest visit here: ${url}`;
  }
  const opening = firstOpening ? ` The first opening is ${firstOpening}.` : '';
  return `${hi} Sorry I missed your call about your ${job}.${opening} Pick a time that works for you: ${url}`;
}

/** Texts go to the number the caller asked for, or to their caller ID. */
function textBackNumber(extraction: VoicemailExtraction, callerId: string): string {
  return (extraction.callbackNumber && toE164(extraction.callbackNumber)) || callerId;
}

/** A caller who was texted this recently is not texted again; their new message is still filed. */
export const TEXT_BACK_COOLDOWN_MINUTES = 10;

/**
 * The missed-call pipeline: transcribe, extract, file the message, text the caller a booking link.
 * Any caller who said something real is texted, even when extraction is partial. Empty messages and
 * repeat calls within the cooldown are filed without a text.
 */
export async function receiveVoicemail(deps: Deps, call: IncomingCall): Promise<Message> {
  const callerId = toE164(call.from);
  if (!callerId) throw new ServiceError(400, 'bad-caller-id', `Caller ID "${call.from}" is not a US phone number`);

  let text: string;
  try {
    text = (await deps.adapters.transcriber.transcribe({ transcript: call.transcript, audioUri: call.audioUri })).text;
  } catch (error) {
    if (error instanceof TranscriptionError) throw new ServiceError(422, 'transcription-failed', error.message);
    throw error;
  }

  const { business, jobs, messages } = deps.store.read();
  const extraction = await deps.adapters.extractor.extract(text, { callerId, business });
  const now = deps.clock();
  const message: Message = {
    id: deps.newId(),
    receivedAt: now.toISOString(),
    from: callerId,
    durationSec: call.durationSec ?? Math.max(8, Math.round(text.split(/\s+/).length / 2.5)),
    transcript: text,
    extraction,
    status: 'new',
    bookingToken: deps.newId(),
    textedAt: null,
    noTextReason: null,
    jobId: null,
  };
  const to = textBackNumber(extraction, callerId);
  const cooldownStart = now.getTime() - TEXT_BACK_COOLDOWN_MINUTES * 60_000;
  const textedRecently = messages.some(
    (m) => m.textedAt !== null && new Date(m.textedAt).getTime() >= cooldownStart && textBackNumber(m.extraction, m.from) === to,
  );
  const empty = emptyMessageReason(text, extraction);
  if (empty) message.extraction = { ...extraction, summary: 'Hang-up or empty message. Nothing to book.' };
  message.noTextReason =
    empty ??
    (textedRecently ? `No text sent: this number was already texted in the last ${TEXT_BACK_COOLDOWN_MINUTES} minutes.` : null);
  deps.store.update((db) => {
    db.messages.push(message);
  });
  if (message.noTextReason) return message;

  const [first] = openSlots({
    now,
    timeZone: business.timezone,
    hours: business.hours,
    slotMinutes: business.slotMinutes,
    booked: jobs,
    urgency: extraction.urgency,
    limit: 1,
  });
  const linkPath = `/book/${message.bookingToken}`;
  await deps.adapters.sms.send({
    to,
    linkPath,
    body: textBackBody(
      extraction,
      business.ownerName.split(' ')[0]!,
      business.name,
      `${deps.publicBaseUrl}${linkPath}`,
      first ? formatSlot(first.start, first.end, business.timezone) : null,
    ),
  });

  const textedAt = deps.clock().toISOString();
  deps.store.update((db) => {
    const stored = db.messages.find((m) => m.id === message.id);
    if (stored) stored.textedAt = textedAt;
  });
  return { ...message, textedAt };
}

export function setMessageStatus(deps: Deps, id: string, status: Message['status']): Message {
  return deps.store.update((db) => {
    const message = db.messages.find((m) => m.id === id);
    if (!message) throw new ServiceError(404, 'not-found', 'No such message');
    message.status = status;
    return message;
  });
}
