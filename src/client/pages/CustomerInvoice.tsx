import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { formatCents, formatQuantity, formatRateMilli, lineAmountCents } from '../../domain/money';
import { api, ApiError, type PublicInvoice } from '../api';
import { BrandMark } from '../components/Brand';
import { GhostIcon, PhoneIcon } from '../components/Icons';
import { Reels } from '../components/Reels';
import { telHref } from '../lib/format';
import { useTitle } from '../lib/machine';

export default function CustomerInvoice() {
  const { id = '' } = useParams();
  const [params] = useSearchParams();
  const story = params.get('story') === '1';
  const [data, setData] = useState<PublicInvoice | null>(null);
  const [paying, setPaying] = useState(false);
  const [justPaid, setJustPaid] = useState(false);
  const [error, setError] = useState<{ business: { name: string; phone: string } | null } | null>(null);
  useTitle(data ? `Invoice ${data.invoice.number}` : 'Invoice');

  useEffect(() => {
    api
      .invoice(id)
      .then(setData)
      .catch((e) => {
        const details = e instanceof ApiError ? (e.details as { business?: { name: string; phone: string } } | null) : null;
        setError({ business: details?.business ?? null });
      });
  }, [id]);

  if (error) {
    const biz = error.business;
    return (
      <div className="caller-page">
        <div className="caller-card panel" data-testid="bad-invoice">
          {biz && (
            <header className="caller-head">
              <BrandMark />
              <div>
                <div className="caller-biz">{biz.name}</div>
                <div className="faint" style={{ fontSize: 13 }}>
                  {biz.phone}
                </div>
              </div>
            </header>
          )}
          <section className="ghost-card">
            <GhostIcon width={56} height={56} />
            <h1 className="caller-title">This invoice has given up the ghost.</h1>
            <p className="muted">The link may be mistyped or out of date. A quick call sorts it out.</p>
            {biz && (
              <a className="btn btn-primary caller-confirm" href={telHref(biz.phone)}>
                <PhoneIcon /> Call {biz.phone}
              </a>
            )}
          </section>
        </div>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="caller-page reel-loading" role="status">
        <Reels spinning />
        <span>Finding your invoice...</span>
      </div>
    );
  }
  const { invoice, business } = data;
  const paid = invoice.status === 'paid';

  async function pay() {
    setPaying(true);
    try {
      const { invoice: updated } = await api.demoPay(id);
      setData((d) => (d ? { ...d, invoice: updated } : d));
      setJustPaid(true);
    } finally {
      setPaying(false);
    }
  }

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
          {!paid && <div className="paper-stamp ok">Due</div>}
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
        {paid && (
          <div className={`paid-stamp ${justPaid ? 'slam' : ''}`} data-testid="paid-stamp">
            Paid
          </div>
        )}
        {paid ? (
          <p className="paid-note" role="status">
            Paid in full. Thank you from {business.name}.
          </p>
        ) : data.demoPay ? (
          <>
            <button className="btn btn-primary approve" type="button" onClick={() => void pay()} disabled={paying}>
              Pay {formatCents(invoice.totals.totalCents)}
            </button>
            <p className="faint approve-note">Demo payment: no card is charged. With the Stripe adapter on, Pay opens Stripe's hosted page.</p>
          </>
        ) : (
          <>
            <button className="btn btn-primary approve" type="button" disabled title="Card payment opens on Stripe when the Stripe adapter is on">
              Pay {formatCents(invoice.totals.totalCents)}
            </button>
            <p className="faint approve-note">
              With the Stripe adapter switched on, this button opens Stripe's hosted payment page.
            </p>
          </>
        )}
      </article>
      {story && paid && (
        <p className="row" style={{ justifyContent: 'center' }}>
          <Link className="btn" to="/machine">
            Back to the machine
          </Link>
        </p>
      )}
      <p className="caller-foot faint">
        <BrandMark className="brand-mark inline-mark" /> Invoicing by AfterBeep
      </p>
    </div>
  );
}
