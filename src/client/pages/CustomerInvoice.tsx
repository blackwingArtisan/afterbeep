import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { formatCents, formatQuantity, formatRateMilli, lineAmountCents } from '../../domain/money';
import { api, ApiError, type PublicInvoice } from '../api';
import { BrandMark } from '../components/Brand';
import { useTitle } from '../lib/machine';

export default function CustomerInvoice() {
  const { id = '' } = useParams();
  const [data, setData] = useState<PublicInvoice | null>(null);
  const [error, setError] = useState<string | null>(null);
  useTitle(data ? `Invoice ${data.invoice.number}` : 'Invoice');

  useEffect(() => {
    api
      .invoice(id)
      .then(setData)
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Invoice not found'));
  }, [id]);

  if (error) return <div className="caller-page empty">{error}</div>;
  if (!data) return <div className="caller-page empty">Loading...</div>;
  const { invoice, business } = data;
  const created = new Date(invoice.createdAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const due = new Date(`${invoice.dueDate}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  return (
    <div className="caller-page">
      <article className="paper customer-invoice" data-testid="customer-invoice">
        <header className="paper-head">
          <div>
            <div className="paper-biz">{business.name}</div>
            <div className="paper-small">
              {business.address.line1}, {business.address.city}, {business.address.state} {business.address.zip}
              <br />
              {business.phone} · {business.email}
            </div>
          </div>
          <div className="paper-stamp ok">{invoice.status === 'paid' ? 'Paid' : 'Due'}</div>
        </header>
        <div className="paper-meta">
          <div>
            <span className="label">Invoice</span>
            <div>{invoice.number}</div>
          </div>
          <div>
            <span className="label">Date</span>
            <div>{created}</div>
          </div>
          <div>
            <span className="label">Due</span>
            <div>{due}</div>
          </div>
          <div>
            <span className="label">Bill to</span>
            <div>{invoice.customer.name}</div>
          </div>
        </div>
        <h1 className="paper-job">{invoice.title}</h1>
        <ul className="lines">
          {invoice.lines.map((l) => (
            <li key={l.id} className="line">
              <div className="line-top">
                <div>
                  <div className="line-desc">{l.description}</div>
                  <div className="line-math">
                    {formatQuantity(l.quantity)} x {formatCents(l.unitPriceCents)}
                    {l.unit === 'hour' ? ' per hour' : ''}
                  </div>
                </div>
                <div className="line-amt">{formatCents(lineAmountCents(l.quantity, l.unitPriceCents))}</div>
              </div>
            </li>
          ))}
        </ul>
        <dl className="totals">
          <div>
            <dt>Subtotal</dt>
            <dd>{formatCents(invoice.totals.subtotalCents)}</dd>
          </div>
          <div>
            <dt>Sales tax ({formatRateMilli(invoice.totals.taxRateMilli)})</dt>
            <dd>{formatCents(invoice.totals.taxCents)}</dd>
          </div>
          <div className="grand">
            <dt>Amount due</dt>
            <dd data-testid="amount-due">{formatCents(invoice.totals.totalCents)}</dd>
          </div>
        </dl>
        <button className="btn btn-primary approve" type="button" disabled title="Card payment opens on Stripe when the Stripe adapter is on">
          Pay {formatCents(invoice.totals.totalCents)}
        </button>
        <p className="faint approve-note">
          Demo invoice. With the Stripe adapter switched on, this button opens Stripe's hosted payment page.
        </p>
      </article>
      <p className="caller-foot faint">
        <BrandMark className="brand-mark inline-mark" /> Invoicing by AfterBeep
      </p>
    </div>
  );
}
