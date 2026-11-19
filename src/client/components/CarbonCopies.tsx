import { carbonStamp } from '../../domain/kept';
import { formatCents, invoiceDay, formatQuantity, formatRateMilli, lineAmountCents } from '../../domain/money';
import type { Invoice } from '../../domain/types';

interface Props {
  invoice: Invoice;
  business: { name: string; phone: string } | null;
}

function Copy({ invoice, business, office }: Props & { office: boolean }) {
  const created = invoiceDay(invoice.issueDate ?? invoice.createdAt.slice(0, 10));
  return (
    <section className={`carbon-copy ${office ? 'office' : 'customer'}`} aria-label={office ? 'Office copy' : 'Customer copy'}>
      <header className="carbon-head">
        <div>
          <strong>{business?.name}</strong>
          <div>{business?.phone}</div>
        </div>
        <div className="carbon-meta">
          <span className="carbon-which">{office ? 'Office copy' : 'Customer copy'}</span>
          <span>
            No. {invoice.number} · {created}
          </span>
          <span>Bill to {invoice.customer.name}</span>
        </div>
      </header>
      <table className="carbon-lines">
        <tbody>
          {invoice.lines.map((l) => {
            const stamp = carbonStamp(l);
            return (
              <tr key={l.id}>
                <td>
                  {l.description}
                  <span className="carbon-math">
                    {' '}
                    {formatQuantity(l.quantity)} x {formatCents(l.unitPriceCents)}
                  </span>
                  {office && (
                    <span className={`carbon-stamp ${stamp.tone}`} data-testid="carbon-stamp">
                      {stamp.label}
                      {stamp.detail ? `: ${stamp.detail}` : ''}
                    </span>
                  )}
                </td>
                <td className="carbon-amt">{formatCents(lineAmountCents(l.quantity, l.unitPriceCents))}</td>
              </tr>
            );
          })}
          <tr>
            <td>Sales tax ({formatRateMilli(invoice.totals.taxRateMilli)})</td>
            <td className="carbon-amt">{formatCents(invoice.totals.taxCents)}</td>
          </tr>
          <tr className="carbon-total">
            <td>Total</td>
            <td className="carbon-amt">{formatCents(invoice.totals.totalCents)}</td>
          </tr>
        </tbody>
      </table>
      {office && <p className="carbon-foot">Every price checked against your own past invoices. Code did the math, in whole cents.</p>}
    </section>
  );
}

/**
 * The carbon-copy set, laid out for the printer: a yellow customer copy and a pink office copy that
 * shows what the price check did with each line. Hidden on screen; see the print styles.
 */
export function CarbonCopies({ invoice, business }: Props) {
  return (
    <div className="carbon-set" data-testid="carbon-set">
      <Copy invoice={invoice} business={business} office={false} />
      <Copy invoice={invoice} business={business} office />
    </div>
  );
}
