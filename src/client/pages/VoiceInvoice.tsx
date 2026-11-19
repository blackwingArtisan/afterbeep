import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { findEntry, type CheckOption, type PriceBookEntry, type PriceCheck, type PriceCheckStatus } from '../../domain/price-book';
import { formatCents, formatQuantity, formatRateMilli, lineAmountCents } from '../../domain/money';
import type { Customer, Invoice, InvoiceLine, InvoiceTotals, Job, OutboxItem } from '../../domain/types';
import { api, ApiError, type InvoiceScript } from '../api';
import { AlertIcon, ArrowIcon, CheckIcon, MicIcon, StopIcon } from '../components/Icons';
import { caughtOnLine } from '../../domain/kept';
import { CarbonCopies } from '../components/CarbonCopies';
import { CarbonFan } from '../components/CarbonFan';
import { StoryBar } from '../components/StoryBar';
import { StoryFinale } from '../components/StoryFinale';
import { useMachine, useTitle } from '../lib/machine';
import { speechSupported, useDictation } from '../lib/speech';

interface Working {
  title: string;
  lines: InvoiceLine[];
  checks: PriceCheck[];
  totals: InvoiceTotals;
  blocked: boolean;
}

const UNIT_LABEL: Record<InvoiceLine['unit'], string> = { each: 'ea', hour: 'hr', flat: 'flat' };

function CheckBadge({ check }: { check: PriceCheck | undefined }) {
  if (!check) return null;
  const tone = check.blocking ? 'hold' : check.status === 'new-item' || check.status === 'filled' ? 'info' : 'ok';
  const labels: Record<PriceCheckStatus, string> = {
    ok: 'Usual price',
    filled: 'From history',
    'new-item': 'New item',
    outlier: 'Check price',
    confirmed: 'Confirmed',
    'missing-price': 'No price',
    ambiguous: 'Which price?',
    quantity: 'Check quantity',
    unplaced: 'Check line',
  };
  const label = labels[check.status];
  return (
    <span className={`chip chip-${tone}`}>
      {check.blocking ? <AlertIcon width={12} height={12} /> : <CheckIcon width={12} height={12} />} {label}
    </span>
  );
}

export default function VoiceInvoice() {
  useTitle('Voice invoice');
  const { business } = useMachine();
  const [params] = useSearchParams();
  const handoff = (useLocation().state as { speech?: string } | null)?.speech;
  const [jobs, setJobs] = useState<Job[]>([]);
  const [jobId, setJobId] = useState<string>('');
  const [scripts, setScripts] = useState<InvoiceScript[]>([]);
  const [speech, setSpeech] = useState('');
  const [work, setWork] = useState<Working | null>(null);
  const [customer, setCustomer] = useState<Customer>({ name: '', phone: '', email: null, address: null });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<Invoice | null>(null);
  const [sentText, setSentText] = useState<OutboxItem | null>(null);
  // The owner's own past invoices, fanned out under a held price as carbon slips.
  const [book, setBook] = useState<PriceBookEntry[]>([]);
  useEffect(() => {
    void api.priceBook().then((r) => setBook(r.entries)).catch(() => setBook([]));
  }, [sent]);
  // A remote call hands over the words the owner said; the owner still lines them up and approves the total.
  useEffect(() => {
    if (handoff) setSpeech(handoff);
  }, [handoff]);
  const story = params.get('story') === '1';
  const dictation = useDictation();

  useEffect(() => {
    void api.jobs().then(({ jobs: all }) => {
      const open = all.filter((j) => j.status !== 'invoiced');
      setJobs(open);
      const wanted = params.get('job');
      const pick = open.find((j) => j.id === wanted) ?? open.find((j) => j.status === 'done') ?? open[0];
      setJobId(pick?.id ?? '');
    });
    void api.samples().then((r) => {
      setScripts(r.invoiceScripts);
      const wantedScript = r.invoiceScripts.find((s) => s.id === params.get('script'));
      if (wantedScript) setSpeech(wantedScript.speech);
    });
  }, [params]);

  useEffect(() => {
    if (dictation.listening) setSpeech(dictation.text);
  }, [dictation.text, dictation.listening]);

  const requote = useCallback(async (title: string, lines: InvoiceLine[]) => {
    setBusy(true);
    try {
      const { quote } = await api.quote(lines);
      setWork({ title, ...quote });
    } finally {
      setBusy(false);
    }
  }, []);

  async function build() {
    setError(null);
    setSent(null);
    if (!speech.trim()) {
      setError('Say or type the invoice first.');
      return;
    }
    setBusy(true);
    try {
      const { draft, customer: c } = await api.draft(speech, jobId || null);
      setWork({ title: draft.title ?? 'Service call', lines: draft.lines, checks: draft.checks, totals: draft.totals, blocked: draft.blocked });
      if (c) setCustomer(c);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not read that invoice.');
    } finally {
      setBusy(false);
    }
  }

  function updateLine(id: string, change: Partial<InvoiceLine>) {
    if (!work) return;
    void requote(
      work.title,
      work.lines.map((l) => (l.id === id ? { ...l, ...change } : l)),
    );
  }

  function choose(line: InvoiceLine, option: CheckOption) {
    updateLine(line.id, option.patch);
  }

  function removeLine(id: string) {
    if (!work) return;
    void requote(
      work.title,
      work.lines.filter((l) => l.id !== id),
    );
  }

  async function approve() {
    if (!work) return;
    setError(null);
    setBusy(true);
    try {
      const { invoice } = await api.send({
        jobId: jobId || null,
        title: work.title,
        customer: { ...customer, email: customer.email?.trim() || null, address: customer.address?.trim() || null },
        lines: work.lines,
        approvedTotalCents: work.totals.totalCents,
      });
      setSent(invoice);
      setJobs((all) => all.filter((j) => j.id !== jobId));
      const { outbox } = await api.outbox();
      setSentText(outbox.find((o) => o.kind === 'invoice' && o.linkPath === invoice.customerUrl) ?? null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Sending failed. Nothing was sent.');
      if (e instanceof ApiError && e.code === 'total-mismatch') await requote(work.title, work.lines);
    } finally {
      setBusy(false);
    }
  }

  const canDictate = speechSupported();
  const job = jobs.find((j) => j.id === jobId);
  const customerReady = customer.name.trim().length > 0 && customer.phone.trim().length >= 7;

  if (sent) {
    return (
      <div className="stack" style={{ gap: 24 }}>
        {story && <StoryBar step={5} />}
        {story && sent.customerUrl.startsWith('/') && (
          <StoryFinale
            booked={sent.jobId ? 1 : 0}
            billedCents={sent.totals.totalCents}
            caughtCents={sent.lines.reduce((sum, l) => sum + caughtOnLine(l), 0)}
            customerName={sent.customer.name}
            customerUrl={sent.customerUrl}
          />
        )}
        <CarbonCopies invoice={sent} business={business ? { name: business.name, phone: business.phone } : null} />
        <section className="panel panel-pad sent-card" data-testid="invoice-sent">
          <div className="sent-show">
            <div className="paper sent-paper" aria-hidden="true">
              <div className="sent-paper-head">
                <strong>{business?.name}</strong>
                <span>Invoice {sent.number}</span>
              </div>
              <ul className="sent-paper-lines">
                {sent.lines.map((l) => (
                  <li key={l.id}>
                    <span>{l.description}</span>
                    <span>{formatCents(lineAmountCents(l.quantity, l.unitPriceCents))}</span>
                  </li>
                ))}
                <li className="sent-paper-total">
                  <span>Total</span>
                  <span>{formatCents(sent.totals.totalCents)}</span>
                </li>
              </ul>
              <span className="sent-stamp" data-testid="sent-stamp">
                Sent
              </span>
            </div>
            {sentText && (
              <div className="phone sent-phone">
                <div className="phone-screen">
                  <div className="phone-to">To {sent.customer.name}</div>
                  <div className="bubble sim-bubble">{sentText.body}</div>
                </div>
              </div>
            )}
          </div>
          <p className="eyebrow">Sent</p>
          <h1 className="page-title">
            Invoice {sent.number} is out: {formatCents(sent.totals.totalCents)}
          </h1>
          <p className="muted">
            {sent.customer.name} got a link to view and pay. The prices you just used went into your carbon copies.
          </p>
          <div className="row">
            <Link className="btn btn-primary" to={sent.customerUrl}>
              See what {sent.customer.name.split(' ')[0]} sees <ArrowIcon />
            </Link>
            <Link className="btn" to="/machine/outbox">
              Outbox
            </Link>
            <button className="btn" type="button" onClick={() => window.print()}>
              Print carbon copies
            </button>
            <button className="btn btn-ghost" type="button" onClick={() => { setSent(null); setWork(null); setSpeech(''); }}>
              Another invoice
            </button>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="stack" style={{ gap: 24 }}>
      {story && <StoryBar step={4} />}
      <section>
        <p className="eyebrow">The Dictaphone</p>
        <h1 className="page-title">Say the invoice. Code does the math.</h1>
        <p className="muted page-lede">
          Talk it out like you would to the office. AfterBeep lines it up, checks every price against your own past invoices, and sends
          nothing until you approve the exact total.
        </p>
      </section>

      <div className="invoice-grid">
        <section className="panel panel-pad stack" aria-label="Say it">
          <div className="field">
            <label htmlFor="job">Job</label>
            <select id="job" className="input" value={jobId} onChange={(e) => setJobId(e.target.value)}>
              <option value="">No job (walk-in)</option>
              {jobs.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.customerName}: {j.description}
                </option>
              ))}
            </select>
            {job && <span className="faint" style={{ fontSize: 14 }}>{job.address}</span>}
          </div>

          <div className="mic-wrap">
            <button
              className={`mic ${dictation.listening ? 'live' : ''}`}
              type="button"
              disabled={!canDictate}
              onClick={() => (dictation.listening ? dictation.stop() : dictation.start(''))}
              aria-label={dictation.listening ? 'Stop listening' : 'Start talking'}
            >
              {dictation.listening ? <StopIcon width={34} height={34} /> : <MicIcon width={34} height={34} />}
            </button>
            <div className="muted" style={{ fontSize: 14 }}>
              {canDictate
                ? dictation.listening
                  ? 'Listening. Say each item, its price, and "taxed" for taxable parts.'
                  : 'Tap and talk: "Dryer belt fifty, taxed. One hour labor at eighty-five."'
                : 'Speech needs Chrome or Edge. Type below or use an example.'}
            </div>
          </div>
          {dictation.error && <div className="error-box">{dictation.error}</div>}

          <div className="field">
            <label htmlFor="speech">What you said</label>
            <textarea id="speech" className="input" value={speech} onChange={(e) => setSpeech(e.target.value)} placeholder="Dryer repair. Drum motor three twenty-nine, taxed. Two hours labor at eighty-five." />
          </div>

          <div className="stack" style={{ gap: 8 }}>
            <span className="label">Or try an example</span>
            <div className="row">
              {scripts.map((s) => (
                <button key={s.id} type="button" className="btn btn-small btn-ghost" onClick={() => setSpeech(s.speech)}>
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {error && !work && <div className="error-box" role="alert">{error}</div>}
          <button className="btn btn-primary" type="button" onClick={() => void build()} disabled={busy}>
            Line it up <ArrowIcon />
          </button>
        </section>

        <section className="paper-wrap" aria-label="Confirm">
          {!work ? (
            <div className="paper paper-empty">
              <p className="paper-hint">Your invoice shows up here, line by line, with every price checked.</p>
            </div>
          ) : (
            <div className="paper" data-testid="draft">
              <div className="paper-head">
                <div>
                  <div className="paper-biz">{business?.name}</div>
                  <input className="paper-title-input" aria-label="Invoice title" value={work.title} onChange={(e) => setWork({ ...work, title: e.target.value })} />
                </div>
                <div className={`paper-stamp ${work.blocked ? 'hold' : 'ok'}`} data-testid="draft-state">
                  {work.blocked ? 'On hold' : 'Ready'}
                </div>
              </div>

              <ul className="lines">
                {work.lines.map((line) => {
                  const check = work.checks.find((c) => c.lineId === line.id);
                  return (
                    <li key={line.id} className={`line ${check?.blocking ? 'held' : ''}`} data-testid="line">
                      <div className="line-top">
                        <div>
                          <div className="line-desc">{line.description}</div>
                          <div className="line-math">
                            {formatQuantity(line.quantity)} {UNIT_LABEL[line.unit]} x {formatCents(line.unitPriceCents)}
                            {line.taxable ? ' · taxed' : ''}
                          </div>
                        </div>
                        <div className="line-amt">{formatCents(lineAmountCents(line.quantity, line.unitPriceCents))}</div>
                      </div>
                      <div className="line-check">
                        <CheckBadge check={check} />
                        <span>{check?.message}</span>
                      </div>
                      {check?.status === 'outlier' && check.blocking && (() => {
                        const entry = findEntry(book, line.description, line.kind);
                        return entry ? <CarbonFan entry={entry} heardCents={line.unitPriceCents} /> : null;
                      })()}
                      {line.note && <div className="line-note">{line.note}</div>}
                      {check && check.options.length > 0 && (
                        <div className="row line-options">
                          {check.options.map((o) => (
                            <button key={o.label} type="button" className="btn btn-small" onClick={() => choose(line, o)} disabled={busy}>
                              {o.label}
                            </button>
                          ))}
                        </div>
                      )}
                      {check?.status === 'missing-price' && (
                        <PriceEntry onSet={(cents) => updateLine(line.id, { unitPriceCents: cents, priceSource: 'owner' })} />
                      )}
                      <div className="row line-tools">
                        <label className="tick">
                          <input type="checkbox" checked={line.taxable} onChange={(e) => updateLine(line.id, { taxable: e.target.checked })} /> Taxed
                        </label>
                        <button type="button" className="link-btn" onClick={() => removeLine(line.id)}>
                          Remove
                        </button>
                      </div>
                      <div className="line-heard">heard: "{line.heard}"</div>
                    </li>
                  );
                })}
              </ul>

              <dl className="totals">
                <div>
                  <dt>Subtotal</dt>
                  <dd>{formatCents(work.totals.subtotalCents)}</dd>
                </div>
                <div>
                  <dt>Sales tax {formatRateMilli(work.totals.taxRateMilli)} on {formatCents(work.totals.taxableCents)}</dt>
                  <dd>{formatCents(work.totals.taxCents)}</dd>
                </div>
                <div className="grand">
                  <dt>Total</dt>
                  <dd data-testid="total">{formatCents(work.totals.totalCents)}</dd>
                </div>
              </dl>

              <div className="bill-to">
                <span className="label">Bill to</span>
                <div className="bill-grid">
                  <input className="input" aria-label="Customer name" placeholder="Name" value={customer.name} onChange={(e) => setCustomer({ ...customer, name: e.target.value })} />
                  <input className="input" aria-label="Customer phone" placeholder="Phone" value={customer.phone} onChange={(e) => setCustomer({ ...customer, phone: e.target.value })} />
                  <input className="input" aria-label="Customer email" placeholder="Email (optional)" value={customer.email ?? ''} onChange={(e) => setCustomer({ ...customer, email: e.target.value })} />
                </div>
              </div>

              {error && <div className="error-box" role="alert">{error}</div>}
              <button className="btn btn-primary approve" type="button" disabled={busy || work.blocked || !customerReady} onClick={() => void approve()}>
                {work.blocked ? 'Settle the held lines to continue' : `Approve and send ${formatCents(work.totals.totalCents)}`}
              </button>
              <p className="faint approve-note">The server recomputes this total from the lines and refuses to send if it differs by a cent.</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function PriceEntry({ onSet }: { onSet: (cents: number) => void }) {
  const [value, setValue] = useState('');
  const cents = Math.round(Number(value) * 100);
  const valid = value.trim() !== '' && Number.isFinite(cents) && cents > 0;
  return (
    <form
      className="row line-options"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) onSet(cents);
      }}
    >
      <input className="input price-input" inputMode="decimal" aria-label="Price in dollars" placeholder="Price $" value={value} onChange={(e) => setValue(e.target.value)} />
      <button className="btn btn-small" type="submit" disabled={!valid}>
        Set price
      </button>
    </form>
  );
}
