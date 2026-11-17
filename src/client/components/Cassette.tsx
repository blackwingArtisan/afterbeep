import { useState } from 'react';
import type { Job, Message } from '../../domain/types';
import { formatDay, formatDuration, formatRange, formatTime, telHref, timeAgo } from '../lib/format';
import { CheckIcon, PhoneIcon, PlayIcon, StopIcon } from './Icons';
import { Reels } from './Reels';
import { UrgencyChip } from './Urgency';

interface Props {
  message: Message;
  side: string;
  timeZone: string;
  job: Job | null;
  playing: boolean;
  onPlay: () => void;
  onStop: () => void;
  onCalledBack: () => void;
}

export function Cassette({ message, side, timeZone, job, playing, onPlay, onStop, onCalledBack }: Props) {
  const [showTranscript, setShowTranscript] = useState(false);
  const x = message.extraction;
  const isNew = message.status === 'new';

  return (
    <article className={`tape-card ${isNew ? 'is-new' : ''}`} data-testid="cassette" aria-label={`Message from ${x.callerName ?? 'unknown caller'}`}>
      <div className="cassette">
        <div className="cassette-label">
          <span className={`cassette-stripe ${x.urgency}`} />
          <div className="spread" style={{ marginTop: 6 }}>
            <span className="cassette-side">{side}</span>
            <span className="row" style={{ gap: 8 }}>
              {isNew && <span className="chip chip-hold new-chip">New</span>}
              <UrgencyChip urgency={x.urgency} />
            </span>
          </div>
          <div className="cassette-name">{x.callerName ?? 'Unknown caller'}</div>
          <div className="cassette-job">{x.job}</div>
        </div>
        <Reels spinning={playing} />
      </div>

      <div className="tape-body">
        <p className="tape-summary">{x.summary}</p>
        <dl className="facts">
          <div>
            <dt>Call back</dt>
            <dd>
              <a href={telHref(x.callbackNumber ?? message.from)} className="mono">
                {x.callbackNumber ?? message.from}
              </a>
            </dd>
          </div>
          <div>
            <dt>Address</dt>
            <dd>{x.address ?? <span className="faint">Not given</span>}</dd>
          </div>
          <div>
            <dt>Received</dt>
            <dd>
              {formatTime(message.receivedAt, timeZone)} <span className="faint">({timeAgo(message.receivedAt)}, {formatDuration(message.durationSec)})</span>
            </dd>
          </div>
          <div>
            <dt>Booking</dt>
            <dd data-testid="booking-status">
              {job ? (
                <span className="ok-text">
                  <CheckIcon width={16} height={16} /> Booked {formatDay(job.start, timeZone)}, {formatRange(job.start, job.end, timeZone)}
                </span>
              ) : message.textedAt ? (
                <span className="muted">Texted a booking link at {formatTime(message.textedAt, timeZone)}. Waiting for a pick.</span>
              ) : (
                <span className="muted">Not texted</span>
              )}
            </dd>
          </div>
        </dl>

        <div className="row">
          {playing ? (
            <button className="btn btn-small" type="button" onClick={onStop}>
              <StopIcon width={16} height={16} /> Stop
            </button>
          ) : (
            <button className="btn btn-small" type="button" onClick={onPlay} aria-label={`Play message from ${x.callerName ?? 'unknown caller'}`}>
              <PlayIcon width={16} height={16} /> Play
            </button>
          )}
          <a className="btn btn-primary btn-small" href={telHref(x.callbackNumber ?? message.from)} onClick={onCalledBack}>
            <PhoneIcon width={16} height={16} /> Call back
          </a>
          <button className="btn btn-ghost btn-small" type="button" aria-expanded={showTranscript} onClick={() => setShowTranscript((v) => !v)}>
            {showTranscript ? 'Hide words' : 'Read words'}
          </button>
        </div>
        {showTranscript && <blockquote className="transcript">"{message.transcript}"</blockquote>}
      </div>
    </article>
  );
}
