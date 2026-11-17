import type { Job, Urgency, WeeklyHours } from './types';

/** Time-zone helpers built on Intl so the server and browser agree without a date library. */

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number;
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      weekday: 'short',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

export function wallClock(instant: Date, timeZone: string): WallClock {
  const parts = Object.fromEntries(formatterFor(timeZone).formatToParts(instant).map((p) => [p.type, p.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    weekday: WEEKDAYS[parts.weekday ?? 'Sun'] ?? 0,
  };
}

/** The UTC instant at which the given local wall time occurs in `timeZone`. */
export function zonedInstant(
  date: { year: number; month: number; day: number },
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const guess = Date.UTC(date.year, date.month - 1, date.day, hour, minute);
  let instant = guess;
  for (let i = 0; i < 2; i++) {
    const seen = wallClock(new Date(instant), timeZone);
    const seenAsUtc = Date.UTC(seen.year, seen.month - 1, seen.day, seen.hour, seen.minute);
    instant += guess - seenAsUtc;
  }
  return new Date(instant);
}

function parseClock(hhmm: string): { hour: number; minute: number } {
  const [h, m] = hhmm.split(':').map(Number);
  return { hour: h ?? 0, minute: m ?? 0 };
}

export interface Slot {
  start: string;
  end: string;
}

export interface SlotRequest {
  now: Date;
  timeZone: string;
  hours: WeeklyHours;
  slotMinutes: number;
  booked: ReadonlyArray<Pick<Job, 'start' | 'end'>>;
  urgency: Urgency;
  /** How many slots to offer. */
  limit?: number;
  /** Minimum notice before the first slot, in minutes. */
  leadMinutes?: number;
  /** How many days ahead to search. */
  horizonDays?: number;
}

/**
 * Open appointment slots inside opening hours that do not overlap booked jobs.
 * Emergencies are offered today's next slot; everything else starts tomorrow.
 */
export function openSlots(req: SlotRequest): Slot[] {
  const limit = req.limit ?? 6;
  const lead = (req.leadMinutes ?? 60) * 60_000;
  const horizon = req.horizonDays ?? 14;
  const earliest = req.now.getTime() + lead;
  const today = wallClock(req.now, req.timeZone);
  const busy = req.booked.map((b) => [Date.parse(b.start), Date.parse(b.end)] as const);
  const slots: Slot[] = [];
  const firstDay = req.urgency === 'emergency' ? 0 : 1;

  for (let offset = firstDay; offset <= horizon && slots.length < limit; offset++) {
    const noonUtc = Date.UTC(today.year, today.month - 1, today.day + offset, 12);
    const day = wallClock(new Date(noonUtc), 'UTC');
    const hours = req.hours[day.weekday];
    if (!hours) continue;
    const open = parseClock(hours.open);
    const close = parseClock(hours.close);
    const dayStart = zonedInstant(day, open.hour, open.minute, req.timeZone).getTime();
    const dayEnd = zonedInstant(day, close.hour, close.minute, req.timeZone).getTime();
    for (let start = dayStart; start + req.slotMinutes * 60_000 <= dayEnd; start += req.slotMinutes * 60_000) {
      const end = start + req.slotMinutes * 60_000;
      if (start < earliest) continue;
      if (busy.some(([bs, be]) => start < be && end > bs)) continue;
      slots.push({ start: new Date(start).toISOString(), end: new Date(end).toISOString() });
      if (slots.length >= limit) break;
    }
  }
  return slots;
}

export function slotIsOpen(slot: Slot, req: Omit<SlotRequest, 'limit'>): boolean {
  return openSlots({ ...req, limit: 500 }).some((s) => s.start === slot.start && s.end === slot.end);
}
