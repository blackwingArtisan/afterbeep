import { TranscriptionError } from '../../adapters/transcriber/types';
import { openSlots } from '../../domain/slots';
import type { Message, VoicemailExtraction } from '../../domain/types';
import { toE164 } from '../../domain/voicemail-rules';
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
  const opening = firstOpening ? ` First opening: ${firstOpening}.` : '';
  return `${hi} Sorry I missed your call about your ${job}. Pick a time that works for you: ${url}${opening}`;
}

/**
 * The missed-call pipeline: transcribe, extract, file the message, text the caller a booking link.
 * The caller is always texted, even when extraction is partial.
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

  const { business, jobs } = deps.store.read();
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
    jobId: null,
  };
  deps.store.update((db) => {
    db.messages.push(message);
  });

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
  const to = (extraction.callbackNumber && toE164(extraction.callbackNumber)) || callerId;
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
