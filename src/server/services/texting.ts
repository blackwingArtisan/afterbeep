import type { SmsMessage } from '../../adapters/sms/types';
import { isOptedOut, keywordReply, normalizeNumber, textKeyword, type TextKeyword } from '../../domain/texting';
import type { Deps } from './deps';

/** Raised instead of sending to a number that replied STOP. */
export class OptedOutError extends Error {
  constructor(readonly to: string) {
    super('this number replied STOP');
  }
}

/** Every text the machine starts goes through here, so an opted-out number is never texted. */
export async function sendText(deps: Deps, message: SmsMessage) {
  if (isOptedOut(deps.store.read(), message.to)) throw new OptedOutError(message.to);
  return deps.adapters.sms.send(message);
}

export interface InboundText {
  from: string;
  body: string;
}

export interface InboundResult {
  keyword: TextKeyword | null;
  replied: boolean;
}

/**
 * Handles a text a caller sent back. STOP opts the number out and START opts it back in, each with
 * one confirmation; HELP gets the business name and phone. Any other reply is left for the owner.
 */
export async function receiveText(deps: Deps, text: InboundText): Promise<InboundResult> {
  const keyword = textKeyword(text.body);
  if (!keyword) return { keyword: null, replied: false };
  const from = normalizeNumber(text.from);
  deps.store.update((db) => {
    const optOuts = new Set(db.optOuts ?? []);
    if (keyword === 'stop') optOuts.add(from);
    if (keyword === 'start') optOuts.delete(from);
    db.optOuts = [...optOuts];
  });
  // The confirmation is the one text an opted-out number still gets, so it bypasses sendText.
  await deps.adapters.sms.send({ to: from, linkPath: null, body: keywordReply(keyword, deps.store.read().business) });
  return { keyword, replied: true };
}
