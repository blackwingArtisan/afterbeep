import type { Business, LineKind, LineUnit, PastInvoice, PastInvoiceLine } from '../domain/types';

/**
 * Demo data. Every person, address, phone number and email here is invented. Phone numbers use the
 * 555-01xx range reserved for fiction.
 */

export const demoBusiness: Business = {
  id: 'biz_hollow_creek',
  name: 'Hollow Creek Plumbing & Appliance',
  ownerName: 'Morgan Vale',
  trade: 'plumbing and appliance repair',
  phone: '(614) 555-0142',
  email: 'office@hollowcreek.example.com',
  address: { line1: '1428 Elm Street', city: 'Columbus', state: 'OH', zip: '43215' },
  timezone: 'America/New_York',
  hours: [
    null,
    { open: '08:00', close: '17:00' },
    { open: '08:00', close: '17:00' },
    { open: '08:00', close: '17:00' },
    { open: '08:00', close: '17:00' },
    { open: '08:00', close: '17:00' },
    { open: '09:00', close: '13:00' },
  ],
  slotMinutes: 120,
  taxRateOverrideMilli: null,
  laborTaxable: false,
  greeting:
    "You've reached Hollow Creek Plumbing and Appliance. Morgan is elbow-deep in a job right now. " +
    "Leave your name, address and what's going on after the beep, and you'll get a text with times we can come out.",
};

type Row = [description: string, kind: LineKind, quantity: number, unit: LineUnit, dollars: number, taxable: boolean];

const labor = (hours: number): Row => ['Labor', 'labor', hours, 'hour', 85, false];
const trip: Row = ['Trip charge', 'fee', 1, 'flat', 45, false];

const history: Array<[date: string, customer: string, rows: Row[]]> = [
  ['2026-07-02', 'Iris Thornbury', [trip, ['Dryer belt', 'part', 1, 'each', 49.5, true], labor(1)]],
  ['2026-07-09', 'Calvin Moss', [trip, ['Water heater element', 'part', 2, 'each', 89, true], labor(1.5)]],
  ['2026-07-17', 'Ada Blackwood', [trip, ['Wax ring', 'part', 1, 'each', 12, true], ['Toilet flapper', 'part', 1, 'each', 18, true], labor(1)]],
  ['2026-07-28', 'Felix Grimsby', [trip, ['Drum motor', 'part', 1, 'each', 319, true], labor(2)]],
  ['2026-08-06', 'Nora Whitlock', [trip, ['Dryer belt', 'part', 1, 'each', 50, true], ['Dryer heating element', 'part', 1, 'each', 129, true], labor(1.5)]],
  ['2026-08-14', 'Owen Ravensworth', [trip, ['Anode rod', 'part', 1, 'each', 62.5, true], labor(1)]],
  ['2026-08-22', 'Lena Hollis', [['Water heater install', 'part', 1, 'each', 1240, true], ['Haul-away fee', 'fee', 1, 'flat', 60, false], labor(3)]],
  ['2026-09-03', 'Silas Crane', [trip, ['Washer lid switch', 'part', 1, 'each', 38, true], labor(1)]],
  ['2026-09-11', 'Mabel Ashford', [trip, ['Faucet cartridge', 'part', 2, 'each', 12.5, true], ['Supply line', 'part', 2, 'each', 16, true], labor(1)]],
  ['2026-09-24', 'Jonah Pike', [trip, ['Dryer belt', 'part', 1, 'each', 52, true], labor(1)]],
  ['2026-10-02', 'Vera Lockhart', [trip, ['Garbage disposal, 1/2 HP', 'part', 1, 'each', 189, true], labor(1.5)]],
  ['2026-10-15', 'Theo Barrow', [trip, ['Drum motor', 'part', 1, 'each', 339, true], ['Dryer belt', 'part', 1, 'each', 50, true], labor(2)]],
  ['2026-10-23', 'Ruth Gallow', [trip, ['Dryer heating element', 'part', 1, 'each', 129, true], labor(1)]],
  ['2026-11-04', 'Elias Fenn', [trip, ['Dishwasher drain pump', 'part', 1, 'each', 142, true], ['Supply line', 'part', 1, 'each', 16, true], labor(1.5)]],
  ['2026-11-12', 'Clara Dunmore', [trip, ['Anode rod', 'part', 1, 'each', 65, true], ['Water heater element', 'part', 1, 'each', 89, true], labor(2)]],
];

export const pastInvoices: PastInvoice[] = history.map(([date, customerName, rows], i) => ({
  id: `past_${String(i + 1).padStart(2, '0')}`,
  number: `HC-${1001 + i}`,
  date,
  customerName,
  lines: rows.map(
    ([description, kind, quantity, unit, dollars, taxable]): PastInvoiceLine => ({
      description,
      kind,
      quantity,
      unit,
      unitPriceCents: Math.round(dollars * 100),
      taxable,
    }),
  ),
}));

export const FIRST_NEW_INVOICE_NUMBER = 1001 + history.length;

export interface SampleVoicemail {
  id: string;
  label: string;
  from: string;
  durationSec: number;
  transcript: string;
}

export const sampleVoicemails: SampleVoicemail[] = [
  {
    id: 'burst-heater',
    label: 'Burst water heater (emergency)',
    from: '+16145550134',
    durationSec: 21,
    transcript:
      "Hi, this is Priya Natarajan. My water heater just burst and there's water all over the basement floor. " +
      "I'm at 88 Hollow Pine Road. Please call me back at 614-555-0134 as soon as you can. Thank you.",
  },
  {
    id: 'clogged-sink',
    label: 'Clogged kitchen sink (soon)',
    from: '+16145550121',
    durationSec: 18,
    transcript:
      "Hello, my name is Edith Marsh. Our kitchen sink is clogged and it's backing up into the dishwasher. " +
      "We're at 3 Raven Court, apartment 2B. Today or tomorrow would be great. You can reach me at 614 555 0121.",
  },
  {
    id: 'slow-dryer',
    label: 'Dryer not heating (no rush)',
    from: '+16145550177',
    durationSec: 24,
    transcript:
      "Hey, Gus Lindqvist here. My dryer is taking forever to dry, I think the heating element is out. " +
      "I'm at nineteen Cobweb Lane. No rush, sometime next week works. " +
      'Best number is six one four, five five five, oh one seven nine.',
  },
];

/** Extra scripts for the call simulator, beyond the three seeded voicemails. */
export const simulatorScripts: SampleVoicemail[] = [
  ...sampleVoicemails,
  {
    id: 'no-heat',
    label: 'Furnace out overnight (emergency)',
    from: '+16145550163',
    durationSec: 16,
    transcript:
      "It's Hector Alvarez. Our furnace quit last night and we have no heat, and there's a baby in the house. " +
      '41 Lantern Hill Drive. Call me back at 614-555-0163.',
  },
  {
    id: 'story-dryer',
    label: 'Squealing dryer (the whole story)',
    from: '+16145550152',
    durationSec: 15,
    transcript:
      "Hi, this is June Calloway at 27 Larkspur Lane. My dryer is squealing and it won't spin, I think it's the belt. " +
      'Today or tomorrow would be great. Thanks.',
  },
  {
    id: 'washer-noise',
    label: 'Noisy washer (routine)',
    from: '+16145550188',
    durationSec: 14,
    transcript:
      'Hi, this is Dot Whitaker. The washing machine is making a grinding noise on spin. ' +
      "I'm at 702 Bramble Way. Whenever you have a chance is fine.",
  },
];

export interface SampleInvoiceScript {
  id: string;
  label: string;
  speech: string;
}

export const sampleInvoiceScripts: SampleInvoiceScript[] = [
  {
    id: 'clean',
    label: 'Dryer repair (all prices normal)',
    speech: 'Dryer repair. Drum motor three twenty-nine, taxed. Two hours labor at eighty-five. Trip charge forty-five.',
  },
  {
    id: 'slip',
    label: 'Belt at the wrong price (gets held)',
    speech: 'Dryer belt fifteen, taxed. One hour labor at eighty-five. Trip charge.',
  },
  {
    id: 'ambiguous',
    label: 'Water heater swap ("twelve fifty")',
    speech:
      'Water heater install twelve fifty, taxed. Anode rod sixty-two fifty. Three hours labor at eighty-five. Haul away sixty.',
  },
];
