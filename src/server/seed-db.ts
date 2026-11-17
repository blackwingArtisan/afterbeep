import { localAdapters } from '../adapters';
import { MemoryStore } from '../adapters/store/local';
import type { Db } from '../adapters/store/types';
import { zonedInstant, wallClock } from '../domain/slots';
import { demoBusiness, FIRST_NEW_INVOICE_NUMBER, pastInvoices, sampleVoicemails } from './seed';
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

/**
 * The demo state: three voicemails that came in over the last few hours (run through the real
 * pipeline with local adapters, so their text-backs are in the outbox) and one finished job ready to
 * invoice.
 */
export async function seedDb(now: Date, newId: () => string, publicBaseUrl: string): Promise<Db> {
  const store = new MemoryStore(emptyDb());
  const minutesAgo = [190, 95, 25];
  for (const [i, sample] of sampleVoicemails.entries()) {
    const at = new Date(now.getTime() - minutesAgo[i]! * 60_000);
    const clock = () => at;
    await receiveVoicemail(
      { store, adapters: localAdapters({ store, clock, newId, publicBaseUrl }), clock, newId, publicBaseUrl },
      { from: sample.from, transcript: sample.transcript, durationSec: sample.durationSec },
    );
  }
  const today = wallClock(now, demoBusiness.timezone);
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
