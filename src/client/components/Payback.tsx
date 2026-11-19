import { useId, useState } from 'react';
import { PAYBACK_DEFAULTS, PLAIN_VOICEMAIL_LEAVE_RATE, payback } from '../../domain/payback';
import { dollars } from '../lib/format';

/**
 * The payback math with its assumptions in plain sight. The visitor moves the two numbers we
 * cannot cite (calls missed a week, callers who leave a message); everything else is sourced.
 */
export function Payback() {
  const [missedPerWeek, setMissed] = useState(PAYBACK_DEFAULTS.missedPerWeek);
  const [leavePct, setLeavePct] = useState(Math.round(PAYBACK_DEFAULTS.leaveRate * 100));
  const id = useId();
  const r = payback({ ...PAYBACK_DEFAULTS, missedPerWeek, leaveRate: leavePct / 100 });
  const plainPct = Math.round(PLAIN_VOICEMAIL_LEAVE_RATE * 100);

  return (
    <div className="payback panel panel-pad" data-testid="payback">
      <div className="payback-inputs">
        <label className="payback-field" htmlFor={`${id}-missed`}>
          <span>
            Calls you miss a week <em className="payback-tag">your number</em>
          </span>
          <span className="payback-row">
            <input
              id={`${id}-missed`}
              type="range"
              min={1}
              max={20}
              value={missedPerWeek}
              onChange={(e) => setMissed(Number(e.target.value))}
            />
            <output className="lcd payback-val">{String(missedPerWeek).padStart(2, '0')}</output>
          </span>
        </label>
        <label className="payback-field" htmlFor={`${id}-leave`}>
          <span>
            Callers who leave a message <em className="payback-tag">assumption</em>
          </span>
          <span className="payback-row">
            <input
              id={`${id}-leave`}
              type="range"
              min={plainPct}
              max={80}
              value={leavePct}
              onChange={(e) => setLeavePct(Number(e.target.value))}
            />
            <output className="lcd payback-val">{leavePct}%</output>
          </span>
          <span className="faint payback-note">
            Plain voicemail keeps {plainPct}%. We assume a greeting that promises a text in seconds keeps more.
          </span>
        </label>
      </div>
      <div className="payback-out" aria-live="polite">
        <p className="payback-big" data-testid="payback-month">
          {dollars(r.bookedCentsPerMonth)}
          <span>/month</span>
        </p>
        <p className="muted">
          About {Math.round(r.messagesPerMonth)} messages a month get a booking link. If 1 in 3 book (assumption) at a typical $206
          repair, that is work that would have gone to the next name on the search page.
        </p>
        <p className="payback-times" data-testid="payback-times">
          Pays for itself <strong>{r.timesPrice}&times;</strong> at $39 a month.
        </p>
      </div>
    </div>
  );
}
