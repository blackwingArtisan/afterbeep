import { Link } from 'react-router-dom';
import { ArrowIcon, CheckIcon } from './Icons';

const STEPS = ['A call is missed', 'The caller is texted', 'The caller books', 'The owner bills it'] as const;

/** The "whole story" guide: one missed call, followed from the beep to a sent invoice. Step 5 means every step is done. */
export function StoryBar({ step, next }: { step: 1 | 2 | 3 | 4 | 5; next?: { to: string; label: string } }) {
  return (
    <aside className={`story-bar ${step === 5 ? 'complete' : ''}`} aria-label="The whole story" data-testid="story-bar">
      <span className="story-title">{step === 5 ? 'The whole story · complete' : `The whole story · step ${step} of 4`}</span>
      <ol className="story-steps">
        {STEPS.map((label, i) => {
          const state = i + 1 < step ? 'done' : i + 1 === step ? 'active' : 'todo';
          return (
            <li key={label} className={`story-step ${state}`} aria-current={state === 'active' ? 'step' : undefined}>
              <span className="story-dot">{state === 'done' ? <CheckIcon width={12} height={12} /> : i + 1}</span>
              {label}
            </li>
          );
        })}
      </ol>
      {next && (
        <Link className="btn btn-primary btn-small" to={next.to} data-testid="story-next">
          {next.label} <ArrowIcon width={14} height={14} />
        </Link>
      )}
    </aside>
  );
}
