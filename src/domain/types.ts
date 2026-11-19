/** Shared domain types. All money is integer cents. All timestamps are ISO-8601 strings in UTC. */

export type Cents = number;
export type Urgency = 'emergency' | 'soon' | 'routine';

export interface OpeningHours {
  /** 24-hour local wall time, e.g. "08:00". */
  open: string;
  close: string;
}

/** Index 0 = Sunday ... 6 = Saturday. `null` means closed. */
export type WeeklyHours = [
  OpeningHours | null,
  OpeningHours | null,
  OpeningHours | null,
  OpeningHours | null,
  OpeningHours | null,
  OpeningHours | null,
  OpeningHours | null,
];

export interface Address {
  line1: string;
  city: string;
  state: string;
  zip: string;
}

export interface Business {
  id: string;
  name: string;
  ownerName: string;
  trade: string;
  phone: string;
  email: string;
  address: Address;
  timezone: string;
  hours: WeeklyHours;
  slotMinutes: number;
  /** Sales tax as thousandths of a percent (5.75% = 5750). `null` uses the state base rate. */
  taxRateOverrideMilli: number | null;
  laborTaxable: boolean;
  greeting: string;
}

export interface VoicemailExtraction {
  callerName: string | null;
  callbackNumber: string | null;
  address: string | null;
  job: string;
  jobCategory: JobCategory;
  urgency: Urgency;
  summary: string;
  /** Which extractor produced this result. */
  source: 'rules' | 'bedrock';
  /** The language the caller spoke, when it is not English. The job and summary are always in English. */
  language?: 'es';
  /** Why a model extractor's answer was not used and the rules answered instead (for logs and the eval). */
  fallbackReason?: string;
}

export type JobCategory =
  | 'water-heater'
  | 'leak'
  | 'drain'
  | 'appliance'
  | 'heating'
  | 'cooling'
  | 'roofing'
  | 'electrical'
  | 'general';

/** Whether the owner has dealt with the message. Booking is tracked separately through `jobId`. */
export type MessageStatus = 'new' | 'heard' | 'called-back';

export interface Message {
  id: string;
  receivedAt: string;
  /** Caller ID in E.164 form. */
  from: string;
  durationSec: number;
  transcript: string;
  extraction: VoicemailExtraction;
  status: MessageStatus;
  bookingToken: string;
  textedAt: string | null;
  /** Why no booking link was texted (an empty message, or the caller was texted moments ago). */
  noTextReason: string | null;
  /** True when the text provider refused the text-back; the owner can retry it. */
  textFailed?: boolean;
  /** True for a hang-up or empty message, which is filed without a text. These can end up in the graveyard. */
  hangUp?: boolean;
  /** When the owner raised this call from the graveyard with one booking-link text. */
  raisedAt?: string | null;
  /** The phone platform's contact ID (Amazon Connect), so a retried webhook is filed only once. */
  contactId?: string;
  jobId: string | null;
}

export type JobStatus = 'scheduled' | 'done' | 'invoiced';

export interface Job {
  id: string;
  messageId: string | null;
  customerName: string;
  phone: string;
  email: string | null;
  address: string | null;
  description: string;
  urgency: Urgency;
  start: string;
  end: string;
  status: JobStatus;
  invoiceId: string | null;
  /** What the owner quoted for the visit, if anything. "Kept this week" uses it until the job is invoiced. */
  quotedCents?: Cents | null;
}

export type OutboxKind = 'sms' | 'invoice';

export interface OutboxItem {
  id: string;
  kind: OutboxKind;
  to: string;
  body: string;
  /** Site-relative link included in the message, if any. */
  linkPath: string | null;
  createdAt: string;
  provider: string;
}

export type LineUnit = 'each' | 'hour' | 'flat';
export type LineKind = 'part' | 'labor' | 'fee';

export interface PastInvoiceLine {
  description: string;
  kind: LineKind;
  quantity: number;
  unit: LineUnit;
  unitPriceCents: Cents;
  taxable: boolean;
}

export interface PastInvoice {
  id: string;
  number: string;
  date: string;
  customerName: string;
  lines: PastInvoiceLine[];
}

export interface InvoiceLine {
  id: string;
  description: string;
  kind: LineKind;
  /** Up to two decimal places, e.g. 1.5 hours. */
  quantity: number;
  unit: LineUnit;
  unitPriceCents: Cents;
  taxable: boolean;
  /** Where the unit price came from. */
  priceSource: 'spoken' | 'price-book' | 'owner';
  /** The words this line was built from. */
  heard: string;
  /** Other readings of the spoken price, in cents (for ambiguous phrases like "twelve fifty"). */
  alternativesCents: Cents[];
  /** Set when the owner explicitly confirmed this exact unit price despite a price-book warning. */
  confirmedPriceCents: Cents | null;
  /** Set when the owner explicitly confirmed an unusually large quantity. */
  confirmedQuantity: number | null;
  /** Numbers heard in this phrase that the parser could not place as a quantity or a price. */
  unplacedNumbers: string[];
  /** A short explanation shown under the line, e.g. how an ambiguous price was read. */
  note: string | null;
}

export interface InvoiceTotals {
  subtotalCents: Cents;
  taxableCents: Cents;
  taxRateMilli: number;
  taxCents: Cents;
  totalCents: Cents;
}

export interface Customer {
  name: string;
  phone: string;
  email: string | null;
  address: string | null;
}

export type InvoiceStatus = 'sent' | 'paid' | 'void';

export interface Invoice {
  id: string;
  number: string;
  jobId: string | null;
  title: string;
  customer: Customer;
  lines: InvoiceLine[];
  totals: InvoiceTotals;
  status: InvoiceStatus;
  createdAt: string;
  /** The invoice date, YYYY-MM-DD in the business's time zone. Older invoices may lack it. */
  issueDate?: string;
  /** YYYY-MM-DD, 14 days after the invoice date. */
  dueDate: string;
  provider: string;
  providerRef: string | null;
  /** Public link the customer opens (site-relative for the local provider, absolute for Stripe). */
  customerUrl: string;
}
