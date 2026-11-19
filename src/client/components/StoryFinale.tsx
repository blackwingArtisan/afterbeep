import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { formatCents } from '../../domain/money';
import { ArrowIcon } from './Icons';

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Counts from zero up to `to` (an integer) over about a second; jumps straight there under reduced motion. */
function useCountUp(to: number, ms = 1100): number {
  const [value, setValue] = useState(() => (reducedMotion() ? to : 0));
  useEffect(() => {
    if (reducedMotion()) {
      setValue(to);
      return;
    }
    let frame = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      setValue(Math.round(to * (1 - (1 - t) ** 3)));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [to, ms]);
  return value;
}

interface Props {
  booked: number;
  billedCents: number;
  caughtCents: number;
  customerName: string;
  customerUrl: string;
}

/** The end of "Demo the whole story": what one missed call turned into, counted up on the LCD. */
export function StoryFinale({ booked, billedCents, caughtCents, customerName, customerUrl }: Props) {
  const b = useCountUp(booked, 600);
  const billed = useCountUp(billedCents);
  const caught = useCountUp(caughtCents);
  const first = customerName.split(' ')[0] ?? customerName;
  return (
    <section className="story-finale panel panel-pad" aria-labelledby="finale-title" data-testid="story-finale">
      <div className="stack" style={{ gap: 8 }}>
        <p className="eyebrow">Story complete</p>
        <h2 id="finale-title" className="finale-title">
          One missed call, start to finish, while you were under a sink.
        </h2>
      </div>
      <dl className="finale-lcd kept" aria-live="polite">
        <div>
          <dt>Booked</dt>
          <dd data-testid="finale-booked">{String(b).padStart(2, '0')}</dd>
        </div>
        <div>
          <dt>Billed</dt>
          <dd data-testid="finale-billed">{formatCents(billed)}</dd>
        </div>
        <div>
          <dt>Caught</dt>
          <dd data-testid="finale-caught">{formatCents(caught)}</dd>
        </div>
      </dl>
      <div className="row">
        <Link className="btn btn-primary" to={`${customerUrl}?story=1`} data-testid="pay-as-customer">
          Pay as {first} <ArrowIcon />
        </Link>
      </div>
    </section>
  );
}
