import Stripe from 'stripe';
import { formatRateMilli, lineAmountCents } from '../../domain/money';
import type { Business, Invoice } from '../../domain/types';
import { InvoiceProviderError, type InvoiceProvider } from './types';

export interface StripeInvoiceOptions {
  /** A test-mode secret key (sk_test_...). Live keys are refused. */
  secretKey: string;
  daysUntilDue?: number;
}

/**
 * Stripe Invoicing. Every line is sent as a fixed amount AfterBeep computed, and sales tax is its own
 * line, so Stripe never recalculates anything. After finalizing, the Stripe total must equal the
 * approved total or the invoice is voided and nothing is sent.
 */
export class StripeInvoiceProvider implements InvoiceProvider {
  readonly name = 'stripe';
  private readonly stripe: Stripe;

  constructor(private readonly options: StripeInvoiceOptions) {
    if (!options.secretKey.startsWith('sk_test_')) {
      throw new InvoiceProviderError('AfterBeep only runs Stripe in test mode from this build');
    }
    this.stripe = new Stripe(options.secretKey);
  }

  async send(invoice: Invoice, business: Business) {
    const customer = await this.stripe.customers.create({
      name: invoice.customer.name,
      email: invoice.customer.email ?? undefined,
      phone: invoice.customer.phone,
      metadata: { afterbeepInvoiceId: invoice.id },
    });

    const draft = await this.stripe.invoices.create({
      customer: customer.id,
      collection_method: 'send_invoice',
      days_until_due: this.options.daysUntilDue ?? 14,
      auto_advance: false,
      description: `${invoice.title} - ${business.name}`,
      metadata: { afterbeepInvoiceId: invoice.id, afterbeepNumber: invoice.number },
    });
    if (!draft.id) throw new InvoiceProviderError('Stripe did not return an invoice id');

    for (const line of invoice.lines) {
      await this.stripe.invoiceItems.create({
        customer: customer.id,
        invoice: draft.id,
        currency: 'usd',
        amount: lineAmountCents(line.quantity, line.unitPriceCents),
        description: `${line.description} (${line.quantity} x ${(line.unitPriceCents / 100).toFixed(2)})`,
      });
    }
    if (invoice.totals.taxCents > 0) {
      await this.stripe.invoiceItems.create({
        customer: customer.id,
        invoice: draft.id,
        currency: 'usd',
        amount: invoice.totals.taxCents,
        description: `Sales tax ${formatRateMilli(invoice.totals.taxRateMilli)}`,
      });
    }

    const finalized = await this.stripe.invoices.finalizeInvoice(draft.id);
    if (finalized.total !== invoice.totals.totalCents) {
      await this.stripe.invoices.voidInvoice(draft.id);
      throw new InvoiceProviderError(
        `Stripe total ${finalized.total} did not match the approved total ${invoice.totals.totalCents}; invoice voided`,
      );
    }
    const sent = await this.stripe.invoices.sendInvoice(draft.id);
    return { provider: this.name, providerRef: sent.id ?? draft.id, customerUrl: sent.hosted_invoice_url ?? '' };
  }
}
