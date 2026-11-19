import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Job, Message } from '../../domain/types';
import { api } from '../api';
import { Cassette } from '../components/Cassette';
import { Reels } from '../components/Reels';
import { PhoneIcon, PlayIcon, StopIcon } from '../components/Icons';
import { countWord, formatPhone, formatTime, telHref } from '../lib/format';
import { useMachine, useTitle } from '../lib/machine';
import { speak, stopSpeaking } from '../lib/speech';

export default function Inbox() {
  useTitle('Messages');
  const { business, refresh } = useMachine();
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [playing, setPlaying] = useState<string | null>(null);
  const playToken = useRef(0);
  const tz = business?.timezone ?? 'America/New_York';

  const load = useCallback(async () => {
    const [m, j] = await Promise.all([api.messages(), api.jobs()]);
    setMessages(m.messages);
    setJobs(j.jobs);
  }, []);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load().catch(() => {}), 5000);
    return () => {
      clearInterval(timer);
      stopSpeaking();
    };
  }, [load]);

  const newOnes = messages?.filter((m) => m.status === 'new') ?? [];
  // Tape numbers follow the order calls came in, so the newest call is always the highest number.
  const sideOf = new Map(
    [...(messages ?? [])].sort((a, b) => a.receivedAt.localeCompare(b.receivedAt)).map((m, i) => [m.id, `A${i + 1}`] as const),
  );
  // New emergencies go to the top; everything else stays newest first.
  const urgentFirst = (m: Message) => (m.status === 'new' && m.extraction.urgency === 'emergency' ? 0 : 1);
  const ordered = [...(messages ?? [])].sort((a, b) => urgentFirst(a) - urgentFirst(b) || b.receivedAt.localeCompare(a.receivedAt));
  const callNow = ordered.filter((m) => urgentFirst(m) === 0);

  async function playList(list: Message[]) {
    const token = ++playToken.current;
    for (const [i, m] of list.entries()) {
      if (playToken.current !== token) return;
      setPlaying(m.id);
      await speak(`Message ${i + 1}. Received ${formatTime(m.receivedAt, tz)}. ${m.transcript}`, 1.02);
      if (playToken.current !== token) return;
      if (m.status === 'new') await api.setStatus(m.id, 'heard').catch(() => {});
    }
    setPlaying(null);
    await Promise.all([load(), refresh()]);
  }

  function stop() {
    playToken.current++;
    stopSpeaking();
    setPlaying(null);
  }

  async function retryText(m: Message) {
    await api.retryText(m.id).catch(() => {});
    await load();
  }

  async function calledBack(m: Message) {
    await api.setStatus(m.id, 'called-back').catch(() => {});
    await Promise.all([load(), refresh()]);
  }

  if (!messages) return <div className="empty">Rewinding the tape...</div>;

  return (
    <div className="stack" style={{ gap: 24 }}>
      <section className="inbox-head panel panel-pad">
        <div>
          <p className="eyebrow">The machine</p>
          <h1 className="inbox-title" data-testid="inbox-title">
            You have <span className="lcd-word">{countWord(newOnes.length)}</span> new message{newOnes.length === 1 ? '' : 's'}
          </h1>
          <p className="muted">Every real caller already got a text with a booking link. Play them, call back the emergencies, and let the rest book themselves.</p>
        </div>
        <div className="row">
          {playing ? (
            <button className="btn" type="button" onClick={stop}>
              <StopIcon /> Stop tape
            </button>
          ) : (
            <button className="btn btn-primary" type="button" disabled={messages.length === 0} onClick={() => void playList(newOnes.length ? newOnes : messages)}>
              <PlayIcon /> {newOnes.length ? 'Play new messages' : 'Play all'}
            </button>
          )}
          <Link className="btn" to="/machine/call">
            <PhoneIcon /> Call the machine
          </Link>
        </div>
      </section>

      {callNow.length > 0 && (
        <section className="call-now" aria-label="Call back now" data-testid="call-now">
          <span className="call-now-label">
            <span className="led blink" aria-hidden="true" /> Call back now
          </span>
          <ul>
            {callNow.map((m) => (
              <li key={m.id}>
                <a className="btn btn-primary btn-small" href={telHref(m.extraction.callbackNumber ?? m.from)} onClick={() => void calledBack(m)}>
                  <PhoneIcon width={16} height={16} /> {m.extraction.callerName ?? formatPhone(m.from)}: {m.extraction.job}
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      {messages.length === 0 ? (
        <div className="empty-tape panel panel-pad" data-testid="empty-tape">
          <div className="cassette sim-cassette">
            <div className="cassette-label">
              <span className="cassette-stripe unknown" />
              <div className="spread" style={{ marginTop: 6 }}>
                <span className="cassette-side">A0</span>
              </div>
              <div className="cassette-name">Blank tape</div>
              <div className="cassette-job">The line is quiet... too quiet.</div>
            </div>
            <Reels spinning={false} />
          </div>
          <Link className="btn btn-primary" to="/machine/call">
            <PhoneIcon /> Leave the first message
          </Link>
        </div>
      ) : (
        <div className="tape-grid">
          {ordered.map((m) => (
            <Cassette
              key={m.id}
              message={m}
              side={sideOf.get(m.id)!}
              timeZone={tz}
              job={jobs.find((j) => j.id === m.jobId) ?? null}
              playing={playing === m.id}
              onPlay={() => void playList([m])}
              onStop={stop}
              onCalledBack={() => void calledBack(m)}
              onRetryText={() => void retryText(m)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
