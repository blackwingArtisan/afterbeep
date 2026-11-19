import type { CSSProperties } from 'react';
import { formatCents } from '../../domain/money';
import type { PriceBookEntry } from '../../domain/price-book';
import type { Cents } from '../../domain/types';

const slipDay = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

/**
 * The hold moment: the owner's own past carbon copies for this item fan out under the line, the
 * usual price lined up on each, with the price that was heard scrawled in red on top.
 */
export function CarbonFan({ entry, heardCents }: { entry: PriceBookEntry; heardCents: Cents }) {
  const slips = [...entry.history].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 4);
  if (slips.length === 0) return null;
  return (
    <figure className="carbon-fan" data-testid="carbon-fan" aria-label={`${slips.length} past invoices for ${entry.label}`}>
      <ol className="carbon-fan-slips">
        {slips.map((s, i) => (
          <li key={s.invoiceNumber} className="carbon-fan-slip" style={{ '--i': i, '--n': slips.length } as CSSProperties}>
            <span className="carbon-fan-no">
              No. {s.invoiceNumber} · {slipDay(s.date)}
            </span>
            <span className="carbon-fan-item">{entry.label}</span>
            <span className="carbon-fan-amt">{formatCents(s.unitPriceCents)}</span>
          </li>
        ))}
      </ol>
      <span className="carbon-fan-scrawl" aria-label={`heard ${formatCents(heardCents)}`}>
        {formatCents(heardCents).replace(/\.00$/, '')}?
      </span>
    </figure>
  );
}
