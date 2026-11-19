import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { OutboxItem } from '../../domain/types';
import { api } from '../api';
import { ArrowIcon, OutboxIcon, PhoneIcon } from '../components/Icons';
import { formatDay, formatPhone, formatTime } from '../lib/format';
import { useMachine, useTitle } from '../lib/machine';

function linkify(body: string, linkPath: string | null) {
  if (!linkPath) return body;
  const at = body.search(/https?:\/\/\S+/);
  if (at < 0) return body;
  const url = body.slice(at).split(/\s/)[0]!;
  return (
    <>
      {body.slice(0, at)}
      <Link to={linkPath} className="bubble-link" title={url}>
        {shortLink(url)}
      </Link>
      {body.slice(at + url.length)}
    </>
  );
}

/** "https://afterbeep.example.com/book/3f9c1d2e..." -> "afterbeep.example.com/book/3f9c1d…" */
function shortLink(url: string): string {
  const bare = url.replace(/^https?:\/\//, '');
  const cut = bare.lastIndexOf('/') + 7;
  return bare.length > cut + 1 ? `${bare.slice(0, cut)}\u2026` : bare;
}

export default function Outbox() {
  useTitle('Outbox');
  const { business } = useMachine();
  const [items, setItems] = useState<OutboxItem[] | null>(null);
  const tz = business?.timezone ?? 'America/New_York';

  useEffect(() => {
    void api.outbox().then((r) => setItems(r.outbox));
  }, []);

  if (!items) return <div className="empty">Loading...</div>;

  return (
    <div className="stack" style={{ gap: 24 }}>
      <section>
        <p className="eyebrow">Outbox</p>
        <h1 className="page-title">Every text the machine sent</h1>
        <p className="muted page-lede">
          Locally, texts and invoices land here instead of a phone carrier, word for word. With the AWS adapter switched on, the same
          messages go out through Amazon End User Messaging SMS.
        </p>
      </section>
      {items.length === 0 && <div className="empty panel">Nothing sent yet. The first text goes out the moment a caller leaves a message.</div>}
      <div className="outbox-grid">
        {items.map((item) => (
          <article key={item.id} className="phone" data-testid="outbox-item">
            <div className="phone-screen">
              <div className="phone-to">
                {item.kind === 'sms' ? <PhoneIcon width={12} height={12} style={{ display: 'inline' }} /> : <OutboxIcon width={12} height={12} style={{ display: 'inline' }} />}{' '}
                To {formatPhone(item.to)} · {formatDay(item.createdAt, tz)} {formatTime(item.createdAt, tz)}
              </div>
              <div className="bubble">{linkify(item.body, item.linkPath)}</div>
              {item.linkPath && (
                <Link className="btn btn-small phone-open" to={item.linkPath}>
                  {item.kind === 'invoice' ? 'Open invoice' : 'Open booking link'} <ArrowIcon width={14} height={14} />
                </Link>
              )}
              <div className="phone-to">{item.kind === 'invoice' ? 'Invoice' : 'Text'} via {item.provider}</div>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
