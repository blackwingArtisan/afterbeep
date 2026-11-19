import type { Business, Invoice, Job, Message, OutboxItem, PastInvoice } from '../../domain/types';

/** The whole persisted state for one business. Small enough to load and save as one document. */
export interface Db {
  version: 1;
  business: Business;
  messages: Message[];
  jobs: Job[];
  outbox: OutboxItem[];
  invoices: Invoice[];
  pastInvoices: PastInvoice[];
  nextInvoiceNumber: number;
  /** Numbers (E.164) that replied STOP. Optional so data saved before texting rules still loads. */
  optOuts?: string[];
  /** ISO times of recent wrong remote codes, for the lockout. Optional so older saved data still loads. */
  remoteFailures?: string[];
}

export interface Store {
  read(): Db;
  /** Applies a change atomically and persists it. Returns whatever the mutator returns. */
  update<T>(mutate: (db: Db) => T): T;
  replace(db: Db): void;
}
