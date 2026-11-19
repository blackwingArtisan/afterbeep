import { checkRemoteCode } from '../../domain/remote-code';
import { remoteQueue, type RemoteMessage, type TextOutcome } from '../../domain/remote-retrieval';
import { isOptedOut } from '../../domain/texting';
import { ServiceError, type Deps } from './deps';
import { TEXT_BACK_COOLDOWN_MINUTES, textBack, textBackNumber } from './voicemail';

export type CodeAnswer = { result: 'ok'; messages: RemoteMessage[] } | { result: 'wrong' } | { result: 'locked' };

export type RemoteTextOutcome = Exclude<TextOutcome, 'failed'>;

/** Checks a keyed code. The queue is returned only when the code is right (RR 1.8, 11.1). */
export function verifyRemoteCode(deps: Deps, code: string): CodeAnswer {
  const check = deps.store.update((db) => {
    const outcome = checkRemoteCode(db, code, deps.clock());
    db.remoteFailures = outcome.failures;
    return outcome;
  });
  if (check.result === 'ok') return { result: 'ok', messages: remoteQueue(deps.store.read().messages) };
  return { result: check.result };
}

function findMessage(deps: Deps, id: string) {
  const message = deps.store.read().messages.find((m) => m.id === id && !m.erasedAt);
  if (!message) throw new ServiceError(404, 'not-found', 'No such message');
  return message;
}

/**
 * Texts the booking link for one message, to that message's own number only. The route takes an id,
 * never a number, and goes through the same opt-out and 10-minute rules as the text-back.
 */
export async function remoteTextBack(deps: Deps, id: string): Promise<{ outcome: RemoteTextOutcome }> {
  const message = findMessage(deps, id);
  const db = deps.store.read();
  const to = textBackNumber(message.extraction, message.from);
  if (!to) return { outcome: 'no-number' };
  if (isOptedOut(db, to)) return { outcome: 'opted-out' };
  const cooldownStart = deps.clock().getTime() - TEXT_BACK_COOLDOWN_MINUTES * 60_000;
  const recently = db.messages.some(
    (m) => m.textedAt !== null && Date.parse(m.textedAt) >= cooldownStart && textBackNumber(m.extraction, m.from) === to,
  );
  if (recently) return { outcome: 'texted-recently' };
  const after = await textBack(deps, message);
  if (after.textFailed) return { outcome: 'refused' };
  if (after.noTextReason !== null) return { outcome: 'opted-out' };
  return { outcome: 'sent' };
}

/** Erases a message from the inbox. Its booked job and the "Kept this week" figures stay (RR 6.4, 6.5). */
export function eraseMessage(deps: Deps, id: string): { erased: true } {
  const at = deps.clock().toISOString();
  deps.store.update((db) => {
    const message = db.messages.find((m) => m.id === id && !m.erasedAt);
    if (!message) throw new ServiceError(404, 'not-found', 'No such message');
    message.erasedAt = at;
  });
  return { erased: true };
}
