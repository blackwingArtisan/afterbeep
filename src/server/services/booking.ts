import { openSlots, slotIsOpen, type Slot } from '../../domain/slots';
import type { Job, Message } from '../../domain/types';
import { toE164 } from '../../domain/voicemail-rules';
import type { Db } from '../../adapters/store/types';
import { ServiceError, type Deps } from './deps';
import { firstName, formatSlot } from './format';

function findMessage(db: Db, token: string): Message {
  const message = db.messages.find((m) => m.bookingToken === token);
  if (!message) {
    // The caller still needs a way to reach the business, so the business card comes with the error.
    const { name, phone } = db.business;
    throw new ServiceError(404, 'not-found', 'This booking link is not valid', { business: { name, phone } });
  }
  return message;
}

export interface BookingView {
  business: { name: string; ownerName: string; phone: string; timezone: string };
  caller: { name: string | null; job: string; address: string | null; urgency: Message['extraction']['urgency'] };
  slots: Slot[];
  booked: { start: string; end: string } | null;
}

export function bookingView(deps: Deps, token: string): BookingView {
  const db = deps.store.read();
  const message = findMessage(db, token);
  const { business } = db;
  const job = message.jobId ? db.jobs.find((j) => j.id === message.jobId) : undefined;
  return {
    business: { name: business.name, ownerName: business.ownerName, phone: business.phone, timezone: business.timezone },
    caller: {
      name: message.extraction.callerName,
      job: message.extraction.job,
      address: message.extraction.address,
      urgency: message.extraction.urgency,
    },
    slots: job
      ? []
      : openSlots({
          now: deps.clock(),
          timeZone: business.timezone,
          hours: business.hours,
          slotMinutes: business.slotMinutes,
          booked: db.jobs,
          urgency: message.extraction.urgency,
          limit: 8,
        }),
    booked: job ? { start: job.start, end: job.end } : null,
  };
}

export async function bookSlot(deps: Deps, token: string, slot: Slot, address: string | null): Promise<Job> {
  const job = deps.store.update((db) => {
    const message = findMessage(db, token);
    if (message.jobId) throw new ServiceError(409, 'already-booked', 'This visit is already booked');
    const { business } = db;
    const open = slotIsOpen(slot, {
      now: deps.clock(),
      timeZone: business.timezone,
      hours: business.hours,
      slotMinutes: business.slotMinutes,
      booked: db.jobs,
      urgency: message.extraction.urgency,
    });
    if (!open) throw new ServiceError(409, 'slot-taken', 'That time was just taken. Please pick another.');
    const created: Job = {
      id: deps.newId(),
      messageId: message.id,
      customerName: message.extraction.callerName ?? 'Caller',
      phone: message.extraction.callbackNumber ?? message.from,
      email: null,
      address: address?.trim() || message.extraction.address,
      description: message.extraction.job,
      urgency: message.extraction.urgency,
      start: slot.start,
      end: slot.end,
      status: 'scheduled',
      invoiceId: null,
    };
    db.jobs.push(created);
    message.jobId = created.id;
    return created;
  });

  const db = deps.store.read();
  const { business } = db;
  const owner = business.ownerName.split(' ')[0];
  const spanish = db.messages.find((m) => m.id === job.messageId)?.extraction.language === 'es';
  await deps.adapters.sms.send({
    to: toE164(job.phone) ?? job.phone,
    linkPath: null,
    body: spanish
      ? `Listo${job.customerName === 'Caller' ? '' : `, ${firstName(job.customerName)}`}: el ${formatSlot(job.start, job.end, business.timezone, 'es')}, con ` +
        `${business.name}. ${owner} le avisará cuando vaya en camino. Preguntas: ${business.phone}.`
      : `You're booked, ${firstName(job.customerName)}: ${formatSlot(job.start, job.end, business.timezone)} with ` +
        `${business.name}. ${owner} will text when on the way. Questions: ${business.phone}.`,
  });
  return job;
}
