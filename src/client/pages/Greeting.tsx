import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { GREETING_MAX_CHARS, greetingChecks, greetingProblem, spokenSeconds } from '../../domain/greeting';
import { api, ApiError } from '../api';
import { CheckIcon, MicIcon, PhoneIcon, StopIcon } from '../components/Icons';
import { Reels } from '../components/Reels';
import { useMachine, useTitle } from '../lib/machine';
import { beep, ring } from '../lib/sound';
import { speak, speechSupported, stopSpeaking, useDictation } from '../lib/speech';

type Playback = 'idle' | 'ringing' | 'playing' | 'beep';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The outgoing message: what callers hear before the beep, written or said by the owner. */
export default function Greeting() {
  useTitle('Greeting');
  const { business, setBusiness } = useMachine();
  const [text, setText] = useState('');
  const [playback, setPlayback] = useState<Playback>('idle');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useRef(0);
  const dictation = useDictation();
  const canDictate = speechSupported();

  useEffect(() => {
    if (business && !text) setText(business.greeting);
    // Only the first load fills the box; after that it is the owner's draft.
  }, [business]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (dictation.listening) setText(dictation.text);
  }, [dictation.listening, dictation.text]);

  useEffect(
    () => () => {
      run.current += 1;
      stopSpeaking();
    },
    [],
  );

  const checks = greetingChecks(text);
  const problem = text.trim() ? greetingProblem(text) : null;
  const seconds = spokenSeconds(text);
  const unchanged = business?.greeting === text.trim().replace(/\s+/g, ' ');
  const owner = business?.ownerName.split(' ')[0] ?? 'The owner';
  const suggested = business
    ? `You've reached ${business.name}'s answering machine. ${owner} is on a job right now. ` +
      `Leave your name, address and what's going on after the beep, and you'll get a text with times we can come out.`
    : '';

  async function play() {
    const token = ++run.current;
    setPlayback('ringing');
    ring(1);
    await wait(1400);
    if (token !== run.current) return;
    setPlayback('playing');
    await speak(text, 1.05);
    if (token !== run.current) return;
    setPlayback('beep');
    beep();
    await wait(700);
    if (token === run.current) setPlayback('idle');
  }

  function stop() {
    run.current += 1;
    stopSpeaking();
    setPlayback('idle');
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const { business: updated } = await api.saveGreeting(text);
      setBusiness(updated);
      setText(updated.greeting);
      setSaved(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'The greeting could not be saved. Try again.');
    } finally {
      setSaving(false);
    }
  }

  const busy = playback !== 'idle';
  return (
    <div className="stack" style={{ gap: 24 }}>
      <section>
        <p className="eyebrow">Outgoing message</p>
        <h1 className="page-title">Record the greeting</h1>
        <p className="muted page-lede">
          Plain voicemail loses 69% of callers before they say a word. A greeting that says it is a machine and promises a text gives them a
          reason to stay. Type it or say it, play it back the way a caller hears it, then save it.
        </p>
      </section>

      <div className="sim-grid">
        <section className="panel panel-pad stack" aria-label="Greeting">
          <div className="cassette ogm-cassette" data-testid="ogm-cassette">
            <div className="cassette-label">
              <span className="cassette-stripe ogm" />
              <div className="cassette-name">OGM</div>
              <div className="cassette-job">
                {playback === 'ringing' ? 'Ring...' : playback === 'playing' ? 'Playing greeting' : playback === 'beep' ? 'Beep.' : business?.name ?? ' '}
              </div>
            </div>
            <Reels spinning={playback === 'playing'} />
          </div>

          <div className="field">
            <label htmlFor="greeting">What callers hear</label>
            <textarea
              id="greeting"
              className="input ogm-input"
              value={text}
              maxLength={GREETING_MAX_CHARS + 100}
              onChange={(e) => {
                setText(e.target.value);
                setSaved(false);
              }}
              disabled={dictation.listening}
            />
            <span className="faint ogm-meta" data-testid="ogm-seconds">
              About {seconds} second{seconds === 1 ? '' : 's'} · {text.trim().length} of {GREETING_MAX_CHARS} characters
            </span>
          </div>

          <div className="row">
            {busy ? (
              <button className="btn" type="button" onClick={stop}>
                <StopIcon /> Stop
              </button>
            ) : (
              <button className="btn" type="button" onClick={() => void play()} disabled={!text.trim() || dictation.listening}>
                <PhoneIcon /> Play it as a caller
              </button>
            )}
            {canDictate &&
              (dictation.listening ? (
                <button className="btn" type="button" onClick={dictation.stop}>
                  <StopIcon /> Done talking
                </button>
              ) : (
                <button
                  className="btn"
                  type="button"
                  onClick={() => {
                    setSaved(false);
                    dictation.start();
                  }}
                  disabled={busy}
                >
                  <MicIcon /> Say it
                </button>
              ))}
            <button
              className="btn btn-ghost"
              type="button"
              onClick={() => {
                setText(suggested);
                setSaved(false);
              }}
              disabled={busy || dictation.listening || text === suggested}
            >
              Use the suggested greeting
            </button>
          </div>

          {(problem || error) && (
            <div className="error-box" role="alert">
              {problem ?? error}
            </div>
          )}
          {dictation.error && <div className="notice">{dictation.error}</div>}

          <div className="row">
            <button className="btn btn-primary" type="button" onClick={() => void save()} disabled={saving || !!problem || !text.trim() || unchanged}>
              {saving ? 'Saving...' : 'Save greeting'}
            </button>
            {saved && (
              <span className="ogm-saved" role="status" data-testid="greeting-saved">
                <CheckIcon width={14} height={14} /> Saved. The next caller hears it.
              </span>
            )}
          </div>
        </section>

        <section className="panel panel-pad stack" aria-label="Greeting checks">
          <h2 className="ogm-checks-title">What a good greeting does</h2>
          <ul className="ogm-checks">
            {checks.map((c) => (
              <li key={c.id} className={c.pass ? 'pass' : 'miss'} data-testid="greeting-check" data-pass={c.pass}>
                <span className="ogm-tick" aria-hidden="true">
                  {c.pass ? '✓' : '·'}
                </span>
                {c.label}
                <span className="visually-hidden">{c.pass ? ': yes' : ': not yet'}</span>
              </li>
            ))}
          </ul>
          <p className="muted ogm-note">
            The checks are advice. The one rule: AfterBeep is an honest machine, so a greeting that claims a person is on the line is not saved.
          </p>
          <Link className="btn btn-small" to="/machine/call">
            Ring the machine to hear it in a call
          </Link>
        </section>
      </div>
    </div>
  );
}
