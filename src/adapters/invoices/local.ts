import { formatCents } from '../../domain/money';
import { toE164 } from '../../domain/voicemail-rules';
import type { Business, Invoice } from '../../domain/types';
import type { Store } from '../store/types';
import type { InvoiceProvider } from './types';

/**
 * Local invoice provider: the invoice is served by AfterBeep's own customer page (/i/:id) and the
 * text that would carry the link goes to the outbox.
 */
export class LocalInvoiceProvider implements InvoiceProvider {
  readonly name = 'local';
  constructor(
    private readonly store: Store,
    private readonly clock: () => Date,
    private readonly newId: () => string,
    private readonly publicBaseUrl: string,
  ) {}

  async send(invoice: Invoice, business: Business) {
    const path = `/i/${invoice.id}`;
    const firstName = invoice.customer.name.split(' ')[0] ?? invoice.customer.name;
    const body =
      `Hi ${firstName}, here is invoice ${invoice.number} from ${business.name} for ${formatCents(invoice.totals.totalCents)}. ` +
      `View and pay: ${this.publicBaseUrl}${path}`;
    this.store.update((db) => {
      db.outbox.push({
        id: this.newId(),
        kind: 'invoice',
        to: invoice.customer.email ?? toE164(invoice.customer.phone) ?? invoice.customer.phone,
        body,
        linkPath: path,
        createdAt: this.clock().toISOString(),
        provider: this.name,
      });
    });
    return { provider: this.name, providerRef: invoice.id, customerUrl: path };
  }
}
