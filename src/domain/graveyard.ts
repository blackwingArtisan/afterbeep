import { isOptedOut } from './texting';
import type { Cents, Message } from './types';
import { toE164 } from './voicemail-rules';

/** A hang-up is dead once it is a day old with nobody calling back, and stays raisable for 30 days. */
export const GRAVEYARD_MIN_AGE_HOURS = 24;
export const GRAVEYARD_MAX_AGE_DAYS = 30;

export interface Ghost {
  id: string;
  from: string;
  receivedAt: string;
}

export interface RaisedCall extends Ghost {
  raisedAt: string;
  booked: boolean;
}

export interface GraveyardView {
  ghosts: Ghost[];
  raised: RaisedCall[];
  /** The owner's typical job, from past invoices, and what the ghosts are worth at that price. */
  typicalJobCents: Cents;
  mightWinBackCents: Cents;
}

export interface RaiseResult {
  raised: number;
  failed: Array<{ id: string; from: string; reason: string }>;
  graveyard: GraveyardView;
}

const ghostOf = (m: Message): Ghost => ({ id: m.id, from: m.from, receivedAt: m.receivedAt });

/**
 * The graveyard: hang-ups and empty messages between a day and 30 days old that nobody followed up.
 * A call is left out once it was texted, booked, called back or raised, and so is any number that
 * has since been texted or booked, because that caller already got through, and any number that
 * replied STOP. One ghost per number, the latest call. Newest first.
 */
export function graveyard(db: { messages: readonly Message[]; optOuts?: readonly string[] }, now: Date): Ghost[] {
  const newest = now.getTime() - GRAVEYARD_MIN_AGE_HOURS * 3_600_000;
  const oldest = now.getTime() - GRAVEYARD_MAX_AGE_DAYS * 86_400_000;
  const reached = new Set(
    db.messages.filter((m) => m.textedAt !== null || m.jobId !== null || m.status === 'called-back').map((m) => (m.extraction.callbackNumber && toE164(m.extraction.callbackNumber)) || m.from),
  );
  const byNumber = new Map<string, Message>();
  for (const m of db.messages) {
    const at = Date.parse(m.receivedAt);
    if (!m.hangUp || m.erasedAt || m.raisedAt || at > newest || at < oldest) continue;
    if (reached.has(m.from) || isOptedOut(db, m.from)) continue;
    const kept = byNumber.get(m.from);
    if (!kept || kept.receivedAt < m.receivedAt) byNumber.set(m.from, m);
  }
  return [...byNumber.values()].sort((a, b) => b.receivedAt.localeCompare(a.receivedAt)).map(ghostOf);
}

