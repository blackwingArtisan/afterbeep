import { useEffect, useState } from 'react';
import type { PriceBookEntry } from '../../domain/price-book';
import { formatCents } from '../../domain/money';
import { api } from '../api';
import { useTitle } from '../lib/machine';

function Spark({ entry }: { entry: PriceBookEntry }) {
  const prices = entry.history.map((h) => h.unitPriceCents);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const w = 120;
  const h = 28;
  const span = max - min || 1;
  const points = prices
    .map((p, i) => `${prices.length === 1 ? w / 2 : (i / (prices.length - 1)) * (w - 8) + 4},${h - 4 - ((p - min) / span) * (h - 8)}`)
    .join(' ');
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`${prices.length} past prices`}>
      <line x1="0" x2={w} y1={h / 2} y2={h / 2} stroke="var(--edge)" strokeDasharray="2 4" />
      <polyline points={points} fill="none" stroke="var(--lcd)" strokeWidth="2" />
      {points.split(' ').map((pt) => {
        const [x, y] = pt.split(',');
        return <circle key={pt} cx={x} cy={y} r="2.5" fill="var(--lcd)" />;
      })}
    </svg>
  );
}

export default function PriceBook() {
  useTitle('Price book');
  const [entries, setEntries] = useState<PriceBookEntry[] | null>(null);

  useEffect(() => {
    void api.priceBook().then((r) => setEntries(r.entries));
  }, []);

  if (!entries) return <div className="empty">Loading...</div>;

  return (
    <div className="stack" style={{ gap: 24 }}>
      <section>
        <p className="eyebrow">Price book</p>
        <h1 className="page-title">What you actually charge</h1>
        <p className="muted page-lede">
          Built from your own past invoices, never a catalog. When a spoken price lands more than 40% away from your usual, the invoice
          waits for you to pick.
        </p>
      </section>
      <div className="panel table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Item</th>
              <th scope="col">Usual</th>
              <th scope="col">Range</th>
              <th scope="col">Times billed</th>
              <th scope="col">History</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.key}>
                <th scope="row">{e.label}</th>
                <td className="mono">
                  {formatCents(e.medianCents)}
                  {e.unit === 'hour' ? '/hr' : ''}
                </td>
                <td className="mono muted">
                  {e.minCents === e.maxCents ? 'always' : `${formatCents(e.minCents)} - ${formatCents(e.maxCents)}`}
                </td>
                <td className="mono">{e.count}</td>
                <td>
                  <Spark entry={e} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
