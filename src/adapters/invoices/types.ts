import type { Business, Invoice } from '../../domain/types';

export interface SentInvoice {
  provider: string;
  providerRef: string | null;
  /** Where the customer views and pays the invoice. */
  customerUrl: string;
}

export interface InvoiceProvider {
  readonly name: string;
  /**
   * Sends an invoice whose totals were already computed and approved. Implementations must not
   * recompute prices; they must refuse to send if the provider's total differs from `invoice.totals`.
   */
  send(invoice: Invoice, business: Business): Promise<SentInvoice>;
}

export class InvoiceProviderError extends Error {}
