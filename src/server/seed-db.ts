import { localAdapters } from '../adapters';
import { MemoryStore } from '../adapters/store/local';
import type { Db } from '../adapters/store/types';
import { zonedInstant, wallClock } from '../domain/slots';
import { demoBusiness, FIRST_NEW_INVOICE_NUMBER, pastInvoices, sampleVoicemails } from './seed';
import { bookingView, bookSlot } from './services/booking';
import { receiveVoicemail } from './services/voicemail';

export function emptyDb(): Db {
  return {
    version: 1,
    business: structuredClone(demoBusiness),
    messages: [],
    jobs: [],
    outbox: [],
    invoices: [],
    pastInvoices: structuredClone(pastInvoices),
    nextInvoiceNumber: FIRST_NEW_INVOICE_NUMBER,
  };
}

/** Morgan quoted Priya's burst water heater at Thumbtack's typical emergency plumbing price. */
export const PRIYA_QUOTE_CENTS = 37_700;

/**
 * Last week's hang-ups: five callers who rang, said nothing useful and never heard back. They are
 * older than the seven-day "Kept this week" window, so they wait in the graveyard to be raised.
 */
export const GRAVEYARD_SEED = [
  { from: '+16145550142', daysAgo: 8, hour: 11, transcript: 'Hello? Hello? Anyone there?' },
  { from: '+16145550116', daysAgo: 9, hour: 15, transcript: 'Hi, is this the plumber? Okay.' },
  { from: '+16145550193', daysAgo: 10, hour: 9, transcript: 'Yeah, hi, um. I will call back.' },
  { from: '+16145550127', daysAgo: 11, hour: 13, transcript: 'Hello?' },
  { from: '+16145550168', daysAgo: 12, hour: 17, transcript: 'Um, sorry, wrong button.' },
] as const;

/**
 * The demo state, the start of "Morgan's Tuesday": three voicemails that came in over the last few
 * hours (run through the real pipeline with local adapters, so their text-backs are in the outbox),
 * the emergency caller already booked from her text at a $377 quote, and one finished job ready to
 * invoice. "Demo the whole story" adds the fourth call, the second booking and the $35 catch.
 */
export async function seedDb(now: Date, newId: () => string, publicBaseUrl: string): Promise<Db> {
  const store = new MemoryStore(emptyDb());
  const today = wallClock(now, demoBusiness.timezone);
  for (const ghost of GRAVEYARD_SEED) {
    const day = { ...today, day: today.day - ghost.daysAgo };
    const at = zonedInstant(day, ghost.hour, 20, demoBusiness.timezone);
    const clock = () => at;
    const deps = { store, adapters: localAdapters({ store, clock, newId, publicBaseUrl }), clock, newId, publicBaseUrl };
    const message = await receiveVoicemail(deps, { from: ghost.from, transcript: ghost.transcript, durationSec: 4 });
    // The owner heard the silence at the time and moved on; nobody called back.
    store.update((db) => {
      db.messages.find((m) => m.id === message.id)!.status = 'heard';
    });
  }
  const minutesAgo = [190, 95, 25];
  for (const [i, sample] of sampleVoicemails.entries()) {
    const at = new Date(now.getTime() - minutesAgo[i]! * 60_000);
    const clock = () => at;
    const deps = { store, adapters: localAdapters({ store, clock, newId, publicBaseUrl }), clock, newId, publicBaseUrl };
    const message = await receiveVoicemail(deps, { from: sample.from, transcript: sample.transcript, durationSec: sample.durationSec });
    // The emergency caller tapped the first open time in her text a few minutes later.
    if (message.extraction.urgency === 'emergency' && message.textedAt) {
      const later = new Date(at.getTime() + 4 * 60_000);
      const bookDeps = { ...deps, clock: () => later, adapters: localAdapters({ store, clock: () => later, newId, publicBaseUrl }) };
      const [first] = bookingView(bookDeps, message.bookingToken).slots;
      if (first) {
        const job = await bookSlot(bookDeps, message.bookingToken, first, null);
        store.update((db) => {
          const booked = db.jobs.find((j) => j.id === job.id);
          if (booked) booked.quotedCents = PRIYA_QUOTE_CENTS;
        });
      }
    }
  }
  store.update((db) => {
    db.jobs.push({
      id: newId(),
      messageId: null,
      customerName: 'Wendell Ashgrove',
      phone: '(614) 555-0115',
      email: 'wendell.ashgrove@example.com',
      address: '560 Thistle Row',
      description: 'Dryer: not heating',
      urgency: 'soon',
      start: zonedInstant(today, 8, 0, demoBusiness.timezone).toISOString(),
      end: zonedInstant(today, 10, 0, demoBusiness.timezone).toISOString(),
      status: 'done',
      invoiceId: null,
    });
  });
  return store.read();
}
