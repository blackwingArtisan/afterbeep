/**
 * Caller masking for the public demo line. A real caller's number never leaves AWS: the call gate
 * swaps it for a stand-in before anything is stored, and the voicemail Lambda swaps every phone
 * number the caller speaks before the transcript reaches Bedrock or the AfterBeep server.
 *
 * A stand-in is one of the 100 fictional numbers (555) 555-0100 to 0199. The same caller always
 * gets the same stand-in (a keyed hash), so the repeat-call cooldown and the graveyard still work,
 * and nobody can turn a stand-in back into the real number.
 */
import { createHmac } from 'node:crypto';
import { spokenDigitsToText } from '../../src/domain/spoken-numbers';

/** Area code and exchange of every stand-in, written without the plus so no file holds a full number. */
const MASK_DIGITS = '1555555';
const MASK_LABEL = 'afterbeep-caller-mask';

/** True when a number is already a stand-in, so masking twice changes nothing. */
export function isMasked(number: string): boolean {
  const digits = number.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
  return new RegExp(`^${MASK_DIGITS.slice(1)}01\\d\\d$`).test(digits);
}

/** The stand-in for a caller ID. A withheld or unreadable caller ID gets the stand-in for "withheld". */
export function maskPhone(number: string | undefined, salt: string): string {
  const raw = number ?? '';
  if (isMasked(raw)) return `+1${raw.replace(/\D/g, '').slice(-10)}`;
  const digits = raw.replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
  const hash = createHmac('sha256', `${MASK_LABEL}:${salt}`).update(digits || 'withheld').digest();
  const bucket = hash.readUInt32BE(0) % 100;
  return `+${MASK_DIGITS}01${String(bucket).padStart(2, '0')}`;
}

/** The stand-in as it reads in a transcript, "(555) 555-01NN", which masking leaves alone. */
function spokenStandIn(masked: string): string {
  const d = masked.replace(/\D/g, '').slice(1);
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

/**
 * Replaces every phone number in a transcript (digits or spoken digit words, seven digits or more)
 * with a stand-in. The caller's own number maps to the same stand-in as their caller ID.
 */
export function maskTranscript(transcript: string, salt: string): string {
  const normalised = spokenDigitsToText(transcript);
  return normalised.replace(/(?:\+?1[\s.,-]{0,2})?\(?\d{3}\)?[\s.,-]{0,2}\d{3}[\s.,-]{0,2}\d{4}\b|\b\d{3}[\s.,-]{0,2}\d{4}\b|\b\d{7,}\b/g, (match) =>
    isMasked(match) ? match : spokenStandIn(maskPhone(match, salt)),
  );
}
