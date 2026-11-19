import { Link } from 'react-router-dom';
import { ArrowIcon, CheckIcon } from './Icons';

const STEPS = ['A call is missed', 'The caller is texted', 'The caller books', 'The owner bills it'] as const;

/** The "whole story" guide: one missed call, followed from the beep to a sent invoice. */
export function StoryBar({ step, next }: { step: 1 | 2 | 3 | 4; next?: { to: string; label: string } }) {
  return (
    <aside className="story-bar" aria-label="The whole story" data-testid="story-bar">
      <span className="story-title">The whole story · step {step} of 4</span>
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

/** A fresh caller ID in the 555-01xx range reserved for fiction, so the story can run again without the 10-minute text cooldown. */
export function storyCallerId(): string {
  const last = String(10 + Math.floor(Math.random() * 90));
  return `(614) 555-01${last}`;
}
