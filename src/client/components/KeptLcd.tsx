import { timesPrice, type KeptStats } from '../../domain/kept';
import { dollars } from '../lib/format';

/** The "Kept this week" readout: what the machine saved the owner over the last seven days. */
export function KeptLcd({ kept }: { kept: KeptStats | null }) {
  const cells: Array<[label: string, value: string, title: string]> = kept
    ? [
        ['Calls', String(kept.calls).padStart(2, '0'), 'Calls the machine answered this week'],
        ['Texted', String(kept.textedBack).padStart(2, '0'), 'Callers texted a booking link'],
        ['Booked', String(kept.booked).padStart(2, '0'), 'Callers who booked from the text'],
        ['Jobs', dollars(kept.bookedValueCents), 'Booked work, at the invoiced total or your typical job'],
        ['Caught', dollars(kept.caughtCents), 'Misheard prices and quantities fixed before the customer saw them'],
      ]
    : [];
  return (
    <section className="kept" aria-label="Kept this week" data-testid="kept">
      <span className="kept-title">Kept this week</span>
      <dl className="kept-grid">
        {cells.map(([label, value, title]) => (
          <div key={label} title={title}>
            <dt>{label}</dt>
            <dd data-testid={`kept-${label.toLowerCase()}`}>{value}</dd>
          </div>
        ))}
      </dl>
      {kept && kept.bookedValueCents > 0 && (
        <p className="kept-payback" data-testid="kept-payback">
          Paid for itself <strong>{timesPrice(kept.bookedValueCents)}&times;</strong> this week
        </p>
      )}
    </section>
  );
}
