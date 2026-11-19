import { useState } from 'react';
import type { GraveyardView, RaiseResult } from '../../domain/graveyard';
import { formatCents } from '../../domain/money';
import { formatDay, formatPhone, formatTime } from '../lib/format';
import { Reels } from './Reels';

interface Props {
  view: GraveyardView;
  timeZone: string;
  /** Called after a raise, so the inbox and "Kept this week" can reload. */
  onRaise: (result: RaiseResult) => void;
  raise: () => Promise<RaiseResult>;
  /** Set during "Demo the whole story", where the graveyard is the last beat. */
  story?: boolean;
}

/**
 * The graveyard: hang-ups nobody returned, as ghost cassettes. One press of "Raise the dead" texts
 * each caller one booking link; the cassettes rise and turn into raised calls.
 */
export function Graveyard({ view, timeZone, onRaise, raise, story = false }: Props) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<RaiseResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { ghosts, raised } = view;
  if (ghosts.length === 0 && raised.length === 0) return null;

  async function press() {
    setBusy(true);
    setError(null);
    try {
      const r = await raise();
      setResult(r);
      onRaise(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The machine could not raise them. Try again.');
    } finally {
      setBusy(false);
    }
  }

  const booked = raised.filter((r) => r.booked).length;
  return (
    <section className={`graveyard panel panel-pad ${story ? 'story-beat' : ''}`} aria-labelledby="graveyard-title" data-testid="graveyard">
      <div className="graveyard-head">
        <div className="stack" style={{ gap: 6 }}>
          <p className="eyebrow">{story ? 'One more thing' : 'The graveyard'}</p>
          <h2 id="graveyard-title" className="graveyard-title">
            {ghosts.length > 0 ? "Your missed calls aren't gone. They're just dead." : 'The dead have risen.'}
          </h2>
          <p className="muted" data-testid="graveyard-summary">
            {ghosts.length > 0 ? (
              <>
                {ghosts.length} caller{ghosts.length === 1 ? '' : 's'} hung up without a message and never heard back. Raise them and each gets
                one text with a booking link: up to <strong data-testid="graveyard-worth">{formatCents(view.mightWinBackCents)}</strong> of work at
                your typical {formatCents(view.typicalJobCents)} job.
              </>
            ) : (
              <>
                {raised.length} raised, {booked} booked so far. None of them will be texted again.
              </>
            )}
          </p>
        </div>
        {ghosts.length > 0 && (
          <button className="btn btn-primary raise-btn" type="button" disabled={busy} onClick={() => void press()} data-testid="raise-dead">
            {busy ? 'Raising...' : 'Raise the dead'}
          </button>
        )}
      </div>

      <ul className="ghost-row" aria-label={ghosts.length > 0 ? 'Unreturned calls' : 'Raised calls'}>
        {(ghosts.length > 0 ? ghosts.map((g) => ({ ...g, raised: null })) : raised.map((r) => ({ ...r, raised: r }))).map((g, i) => {
          const isRaised = g.raised !== null;
          return (
            <li key={g.id} className={`ghost ${isRaised ? 'risen' : ''}`} style={{ animationDelay: `${i * 120}ms` }} data-testid="ghost">
              <div className="cassette ghost-cassette">
                <div className="cassette-label">
                  <span className="cassette-stripe unknown" />
                  <div className="cassette-name">{formatPhone(g.from)}</div>
                  <div className="cassette-job">
                    {formatDay(g.receivedAt, timeZone)} · {formatTime(g.receivedAt, timeZone)}
                  </div>
                </div>
                <Reels spinning={false} />
              </div>
              <span className="ghost-state">{g.raised ? (g.raised.booked ? 'Booked' : 'Texted') : 'Unreturned'}</span>
            </li>
          );
        })}
      </ul>

      {result && (
        <p className="graveyard-result" role="status" data-testid="raise-result">
          Raised {result.raised}. Each got one text with a booking link; the Outbox shows them word for word.
          {result.failed.length > 0 && ` ${result.failed.length} could not be texted: ${result.failed[0]!.reason}`}
        </p>
      )}
      {error && (
        <p className="graveyard-result error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
