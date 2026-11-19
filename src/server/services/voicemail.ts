import { TranscriptionError } from '../../adapters/transcriber/types';
import { openSlots } from '../../domain/slots';
import { optOutLine } from '../../domain/texting';
import type { Message, VoicemailExtraction } from '../../domain/types';
import { emptyMessageReason, toE164 } from '../../domain/voicemail-rules';
import { ServiceError, type Deps } from './deps';
import { firstName, formatSlot } from './format';
import { OptedOutError, sendText } from './texting';

export interface IncomingCall {
  /** Caller ID as received from the phone network. */
  from: string;
  transcript?: string;
  audioUri?: string;
  durationSec?: number;
  /** The phone platform's ID for this call (Amazon Connect ContactId), used to ignore retried webhooks. */
  contactId?: string;
}

function textBackBody(
  extraction: VoicemailExtraction,
  owner: string,
  businessName: string,
  url: string,
  firstOpening: string | null,
): string {
  if (extraction.language === 'es') return textBackBodySpanish(extraction, owner, businessName, url, firstOpening);
  const hi = `Hi ${firstName(extraction.callerName)}, it's ${owner} at ${businessName}.`;
  const noun = jobNoun(extraction);
  const about = noun ? ` about your ${noun}` : '';
  if (extraction.urgency === 'emergency') {
    return `${hi} Got your message${about}. I'll call you back the minute I'm off this job. Grab the earliest visit here: ${url} ${optOutLine()}`;
  }
  const opening = firstOpening ? ` The first opening is ${firstOpening}.` : '';
  return `${hi} Sorry I missed your call${about}.${opening} Pick a time that works for you: ${url} ${optOutLine()}`;
}

/** The same text back for a caller who left the message in Spanish. */
function textBackBodySpanish(
  extraction: VoicemailExtraction,
  owner: string,
  businessName: string,
  url: string,
  firstOpening: string | null,
): string {
  const hola = extraction.callerName ? `Hola ${firstName(extraction.callerName)}` : 'Hola';
  const hi = `${hola}, soy ${owner} de ${businessName}.`;
  if (extraction.urgency === 'emergency') {
    return `${hi} Recibí su mensaje. Le llamo en cuanto termine este trabajo. Reserve la primera visita aquí: ${url} ${optOutLine('es')}`;
  }
  const opening = firstOpening ? ` La primera cita libre es el ${firstOpening.replace(/\.$/, '')}.` : '';
  return `${hi} Disculpe que no contesté su llamada.${opening} Elija la hora que le convenga: ${url} ${optOutLine('es')}`;
}

/** What the text calls the job ("your heat", "your water heater", "your dryer"), or null when it is unknown. */
export function jobNoun(extraction: VoicemailExtraction): string | null {
  if (extraction.jobCategory === 'heating') return 'heat';
  if (extraction.jobCategory === 'general') return null;
  return extraction.job.split(':')[0]!.toLowerCase();
}

/** Texts go to the number the caller asked for, or to their caller ID. */
export function textBackNumber(extraction: VoicemailExtraction, callerId: string): string {
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

  const { business, messages } = deps.store.read();
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
    ...(call.contactId ? { contactId: call.contactId } : {}),
  };
  const to = textBackNumber(extraction, callerId);
  const cooldownStart = now.getTime() - TEXT_BACK_COOLDOWN_MINUTES * 60_000;
  const textedRecently = messages.some(
    (m) => m.textedAt !== null && new Date(m.textedAt).getTime() >= cooldownStart && textBackNumber(m.extraction, m.from) === to,
  );
  const empty = emptyMessageReason(text, extraction);
  if (empty) {
    message.extraction = { ...extraction, summary: 'Hang-up or empty message. Nothing to book.' };
    message.hangUp = true;
  }
  message.noTextReason =
    empty ??
    (textedRecently ? `No text sent: this number was already texted in the last ${TEXT_BACK_COOLDOWN_MINUTES} minutes.` : null);
  // Checked again inside the write: a retried webhook can arrive while the first is still transcribing.
  const duplicate = deps.store.update((db) => {
    const filed = call.contactId ? db.messages.find((m) => m.contactId === call.contactId) : undefined;
    if (!filed) db.messages.push(message);
    return filed ?? null;
  });
  if (duplicate) return duplicate;
  if (message.noTextReason) return message;
  return textBack(deps, message);
}

/** Why a text could not be sent, in words the owner can act on. */
export function failureReason(error: unknown): string {
  const detail = error instanceof Error && error.message ? error.message.replace(/\.$/, '') : 'the text provider gave no reason';
  return `Text not sent: ${detail}. Call them back, or retry the text.`;
}

/**
 * Texts the caller their booking link. A provider failure never loses the message: it is filed with
 * the reason and a retry flag, and the owner can retry from the inbox.
 */
export async function textBack(deps: Deps, message: Message): Promise<Message> {
  const { business, jobs } = deps.store.read();
  const extraction = message.extraction;
  const [first] = openSlots({
    now: deps.clock(),
    timeZone: business.timezone,
    hours: business.hours,
    slotMinutes: business.slotMinutes,
    booked: jobs,
    urgency: extraction.urgency,
    limit: 1,
  });
  const linkPath = `/book/${message.bookingToken}`;
  try {
    await sendText(deps, {
      to: textBackNumber(extraction, message.from),
      linkPath,
      body: textBackBody(
        extraction,
        business.ownerName.split(' ')[0]!,
        business.name,
        `${deps.publicBaseUrl}${linkPath}`,
        first ? formatSlot(first.start, first.end, business.timezone, extraction.language) : null,
      ),
    });
  } catch (error) {
    const optedOut = error instanceof OptedOutError;
    const noTextReason = optedOut ? 'Not texted: this number replied STOP. Call them back instead.' : failureReason(error);
    return deps.store.update((db) => {
      const stored = db.messages.find((m) => m.id === message.id)!;
      stored.noTextReason = noTextReason;
      stored.textFailed = !optedOut;
      return { ...stored };
    });
  }

  const textedAt = deps.clock().toISOString();
  return deps.store.update((db) => {
    const stored = db.messages.find((m) => m.id === message.id)!;
    stored.textedAt = textedAt;
    stored.noTextReason = null;
    stored.textFailed = false;
    return { ...stored };
  });
}

/** Retries a text-back that the provider refused. Only failed sends can be retried. */
export async function retryTextBack(deps: Deps, id: string): Promise<Message> {
  const message = deps.store.read().messages.find((m) => m.id === id);
  if (!message) throw new ServiceError(404, 'not-found', 'No such message');
  if (!message.textFailed) throw new ServiceError(409, 'not-retryable', 'This message has no failed text to retry');
  return textBack(deps, message);
}

export function setMessageStatus(deps: Deps, id: string, status: Message['status']): Message {
  return deps.store.update((db) => {
    const message = db.messages.find((m) => m.id === id);
    if (!message) throw new ServiceError(404, 'not-found', 'No such message');
    message.status = status;
    return message;
  });
}
