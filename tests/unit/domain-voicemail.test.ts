import { describe, expect, it } from 'vitest';
import { openSlots, slotIsOpen, wallClock, zonedInstant } from '../../src/domain/slots';
import {
  classifyJob,
  classifyUrgency,
  emptyMessageReason,
  extractAddress,
  extractCallback,
  extractName,
  extractWithRules,
  toE164,
} from '../../src/domain/voicemail-rules';
import { demoBusiness, simulatorScripts } from '../../src/server/seed';

const sample = (id: string) => simulatorScripts.find((s) => s.id === id)!;
const extract = (id: string) => extractWithRules(sample(id).transcript, { callerId: sample(id).from, defaultAreaCode: '614' });

describe('rule-based voicemail extraction', () => {
  it('reads the burst water heater emergency', () => {
    expect(extract('burst-heater')).toMatchObject({
      callerName: 'Priya Natarajan',
      callbackNumber: '(614) 555-0134',
      address: '88 Hollow Pine Road',
      jobCategory: 'water-heater',
      urgency: 'emergency',
    });
    expect(extract('burst-heater').job).toBe('Water heater: burst, flooding');
  });

  it('reads an apartment unit and a "soon" request', () => {
    expect(extract('clogged-sink')).toMatchObject({
      callerName: 'Edith Marsh',
      callbackNumber: '(614) 555-0121',
      address: '3 Raven Court, Unit 2B',
      jobCategory: 'drain',
      job: 'Clogged drain: backing up',
      urgency: 'soon',
    });
  });

  it('prefers the spoken callback number over caller ID and reads spoken house numbers', () => {
    expect(extract('slow-dryer')).toMatchObject({
      callerName: 'Gus Lindqvist',
      callbackNumber: '(614) 555-0179',
      address: '19 Cobweb Lane',
      jobCategory: 'appliance',
      job: 'Dryer: not heating',
      urgency: 'routine',
    });
  });

  it('falls back to caller ID and a generic job when the caller says little', () => {
    const result = extractWithRules('Hi, um, call me back please.', { callerId: '+16145550100', defaultAreaCode: '614' });
    expect(result).toMatchObject({ callerName: null, callbackNumber: '(614) 555-0100', address: null, jobCategory: 'general' });
    expect(result.summary).toContain('Unknown caller');
  });

  it.each([
    ['my name is jo baker and the toilet is running', 'Jo Baker'],
    ["it's about my dryer", null],
    ['Hey this is Sam', 'Sam'],
  ])('names from "%s"', (text, name) => {
    expect(extractName(text)).toBe(name);
  });

  it('fills in a local number with the business area code', () => {
    expect(extractCallback('reach me at 555-0150', '614')).toBe('(614) 555-0150');
    expect(toE164('(614) 555-0150')).toBe('+16145550150');
  });

  it('ignores text without a street suffix', () => {
    expect(extractAddress('I have 2 dogs and a cat')).toBeNull();
  });

  it.each([
    ['The upstairs toilet keeps running.', 'Toilet: keeps running'],
    ['Our toilet is clogged and overflowing.', 'Toilet: clogged, overflowing'],
    ['The kitchen faucet is dripping all night.', 'Faucet'],
    ['The bathroom faucet is leaking under the sink.', 'Faucet: leaking'],
    ['The garbage disposal is backed up.', 'Clogged drain: backing up'],
    ['My dishwasher won\'t drain.', "Dishwasher: won't run"],
  ])('labels the job in "%s"', (text, job) => {
    expect(classifyJob(text).job).toBe(job);
  });

  it('treats "no rush" as routine even with "this week"', () => {
    expect(classifyUrgency('no rush, sometime this week')).toBe('routine');
    expect(classifyUrgency('I smell gas in the basement')).toBe('emergency');
  });
});

describe('slots', () => {
  const tz = demoBusiness.timezone;
  // Monday 2026-11-16, 14:30 in Columbus (EST, UTC-5).
  const now = new Date('2026-11-16T19:30:00Z');

  it('converts wall time in the business time zone', () => {
    expect(zonedInstant({ year: 2026, month: 11, day: 17 }, 8, 0, tz).toISOString()).toBe('2026-11-17T13:00:00.000Z');
    expect(zonedInstant({ year: 2026, month: 7, day: 1 }, 8, 0, tz).toISOString()).toBe('2026-07-01T12:00:00.000Z');
    expect(wallClock(now, tz)).toMatchObject({ hour: 14, minute: 30, weekday: 1 });
  });

  it('offers tomorrow onward for routine jobs', () => {
    const slots = openSlots({ now, timeZone: tz, hours: demoBusiness.hours, slotMinutes: 120, booked: [], urgency: 'routine', limit: 3 });
    expect(slots.map((s) => s.start)).toEqual(['2026-11-17T13:00:00.000Z', '2026-11-17T15:00:00.000Z', '2026-11-17T17:00:00.000Z']);
  });

  it('offers today for emergencies, after the lead time', () => {
    const [first] = openSlots({ now, timeZone: tz, hours: demoBusiness.hours, slotMinutes: 120, booked: [], urgency: 'emergency' });
    // At 14:30 with an hour of notice, no two-hour slot still fits before 17:00, so the first is tomorrow 08:00.
    expect(first?.start).toBe('2026-11-17T13:00:00.000Z');
    const morning = new Date('2026-11-16T14:00:00Z'); // 09:00 local
    const [early] = openSlots({ now: morning, timeZone: tz, hours: demoBusiness.hours, slotMinutes: 120, booked: [], urgency: 'emergency' });
    expect(early?.start).toBe('2026-11-16T15:00:00.000Z'); // 10:00 local, the first slot after an hour of notice
  });

  it('skips booked time, Saturdays are short and Sundays closed', () => {
    const friday = new Date('2026-11-19T22:00:00Z'); // Thursday 17:00 local
    const booked = [{ start: '2026-11-20T13:00:00.000Z', end: '2026-11-20T15:00:00.000Z' }];
    const slots = openSlots({ now: friday, timeZone: tz, hours: demoBusiness.hours, slotMinutes: 120, booked, urgency: 'routine', limit: 7 });
    expect(slots.map((s) => s.start)).toEqual([
      '2026-11-20T15:00:00.000Z',
      '2026-11-20T17:00:00.000Z',
      '2026-11-20T19:00:00.000Z',
      '2026-11-21T14:00:00.000Z', // Saturday 09:00
      '2026-11-21T16:00:00.000Z', // Saturday 11:00
      '2026-11-23T13:00:00.000Z', // Monday 08:00
      '2026-11-23T15:00:00.000Z',
    ]);
    expect(slotIsOpen({ start: '2026-11-20T13:00:00.000Z', end: '2026-11-20T15:00:00.000Z' }, { now: friday, timeZone: tz, hours: demoBusiness.hours, slotMinutes: 120, booked, urgency: 'routine' })).toBe(false);
  });
});

describe('empty messages', () => {
  const reason = (transcript: string) =>
    emptyMessageReason(transcript, extractWithRules(transcript, { callerId: '+16145550190', defaultAreaCode: '614' }));

  it.each(['uh hello? hello? nobody there', 'Hello? Is anyone there? Okay, bye.', 'um sorry wrong number'])(
    'gets no text-back for "%s"',
    (transcript) => {
      expect(reason(transcript)).toMatch(/^No text sent/);
    },
  );

  it('texts back anyone who asked for something, even with no job keyword', () => {
    expect(reason('Hi, please call me back about getting a quote for some work.')).toBeNull();
    expect(reason('This is Dana, call me back.')).toBeNull();
  });

  it('texts back every sample voicemail', () => {
    for (const s of simulatorScripts) expect(reason(s.transcript)).toBeNull();
  });
});
