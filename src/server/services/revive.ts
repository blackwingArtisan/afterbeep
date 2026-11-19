import { GRAVEYARD_MAX_AGE_DAYS, graveyard, type GraveyardView, type RaiseResult } from '../../domain/graveyard';
import { typicalJobCents } from '../../domain/kept';
import type { Deps } from './deps';
import { failureReason } from './voicemail';

export function graveyardView(deps: Deps): GraveyardView {
  const db = deps.store.read();
  const now = deps.clock();
  const ghosts = graveyard(db, now);
  const oldest = now.getTime() - GRAVEYARD_MAX_AGE_DAYS * 86_400_000;
  const raised = db.messages
    .filter((m) => m.raisedAt && Date.parse(m.raisedAt) >= oldest)
    .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))
    .map((m) => ({ id: m.id, from: m.from, receivedAt: m.receivedAt, raisedAt: m.raisedAt!, booked: m.jobId !== null }));
  const typical = typicalJobCents(db.pastInvoices);
  return { ghosts, raised, typicalJobCents: typical, mightWinBackCents: typical * ghosts.length };
}

function raiseBody(ownerFirstName: string, businessName: string, receivedAt: string, timeZone: string, url: string): string {
  const day = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'long' }).format(new Date(receivedAt));
  return `Hi, it's ${ownerFirstName} at ${businessName}. Sorry I missed your call on ${day}. If you still need a hand, pick a time here: ${url}`;
}

/**
 * Raise the dead: one owner press texts every caller in the graveyard one booking link. Nothing is
 * texted without the press, and a raised call is never texted again. A refused text leaves that call
 * in the graveyard with the reason.
 */
export async function raiseTheDead(deps: Deps): Promise<RaiseResult> {
  const db = deps.store.read();
  const { business } = db;
  const ownerFirstName = business.ownerName.split(' ')[0]!;
  let raised = 0;
  const failed: RaiseResult['failed'] = [];
  for (const ghost of graveyard(db, deps.clock())) {
    const message = db.messages.find((m) => m.id === ghost.id)!;
    const linkPath = `/book/${message.bookingToken}`;
    try {
      await deps.adapters.sms.send({
        to: ghost.from,
        linkPath,
        body: raiseBody(ownerFirstName, business.name, ghost.receivedAt, business.timezone, `${deps.publicBaseUrl}${linkPath}`),
      });
    } catch (error) {
      failed.push({ ...ghost, reason: failureReason(error) });
      continue;
    }
    const at = deps.clock().toISOString();
    deps.store.update((d) => {
      const stored = d.messages.find((m) => m.id === ghost.id)!;
      stored.raisedAt = at;
      stored.textedAt = at;
      stored.noTextReason = null;
    });
    raised++;
  }
  return { raised, failed, graveyard: graveyardView(deps) };
}
