import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Message } from '../../domain/types';
import { api, ApiError, type Sample } from '../api';
import { ArrowIcon, CheckIcon, MicIcon, PhoneIcon, StopIcon } from '../components/Icons';
import { Reels } from '../components/Reels';
import { UrgencyChip } from '../components/Urgency';
import { useMachine, useTitle } from '../lib/machine';
import { beep, ring } from '../lib/sound';
import { speak, speechSupported, stopSpeaking, useDictation } from '../lib/speech';

type Phase = 'compose' | 'ringing' | 'greeting' | 'recording' | 'processing' | 'done';
type Mode = 'sample' | 'voice' | 'type';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const STEPS: Array<{ phase: Phase[]; label: string }> = [
  { phase: ['ringing'], label: 'Ringing' },
  { phase: ['greeting'], label: 'Greeting' },
  { phase: ['recording'], label: 'Recording' },
  { phase: ['processing'], label: 'Reading the message' },
  { phase: ['done'], label: 'Texted back' },
];
const ORDER: Phase[] = ['compose', 'ringing', 'greeting', 'recording', 'processing', 'done'];

export default function CallSimulator() {
  useTitle('Call simulator');
  const { business, refresh } = useMachine();
  const [samples, setSamples] = useState<Sample[]>([]);
  const [mode, setMode] = useState<Mode>('sample');
  const [sampleId, setSampleId] = useState('no-heat');
  const [typed, setTyped] = useState('');
  const [from, setFrom] = useState('(614) 555-0163');
  const [phase, setPhase] = useState<Phase>('compose');
  const [shown, setShown] = useState('');
  const [result, setResult] = useState<Message | null>(null);
  const [error, setError] = useState<string | null>(null);
  const skip = useRef<() => void>(() => {});
  const dictation = useDictation();
  const canDictate = speechSupported();

  useEffect(() => {
    void api.samples().then((r) => setSamples(r.voicemails));
    return () => stopSpeaking();
  }, []);

  const sample = samples.find((s) => s.id === sampleId);

  function pickSample(s: Sample) {
    setSampleId(s.id);
    setFrom(formatCallerId(s.from));
  }

  function skippable(ms: number) {
    return new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, ms);
      skip.current = () => {
        clearTimeout(timer);
        resolve();
      };
    });
  }

  async function submit(transcript: string) {
    setPhase('processing');
    try {
      const [{ message }] = await Promise.all([api.call(from, transcript), wait(900)]);
      setResult(message);
      setPhase('done');
      await refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'The call dropped. Try again.');
      setPhase('compose');
    }
  }

  async function callMachine() {
    setError(null);
    setResult(null);
    setShown('');
    const script = mode === 'sample' ? (sample?.transcript ?? '') : mode === 'type' ? typed.trim() : '';
    if (mode !== 'voice' && !script) {
      setError('Pick a sample or type what the caller says.');
      return;
    }
    setPhase('ringing');
    ring(2);
    await skippable(2800);
    setPhase('greeting');
    await Promise.race([speak(business?.greeting ?? 'Leave a message after the beep.', 1.05), skippable(7000)]);
    stopSpeaking();
    beep();
    setPhase('recording');
    if (mode === 'voice') {
      dictation.start();
      return;
    }
    const words = script.split(' ');
    for (let i = 1; i <= words.length; i += 3) {
      setShown(words.slice(0, i).join(' '));
      await wait(45);
    }
    setShown(script);
    await wait(400);
    await submit(script);
  }

  async function hangUp() {
    dictation.stop();
    const words = dictation.text.trim();
    if (!words) {
      setError("The machine didn't hear anything. Try again, or type the message.");
      setPhase('compose');
      return;
    }
    setShown(words);
    await submit(words);
  }

  const busy = phase !== 'compose' && phase !== 'done';
  const x = result?.extraction;

  return (
    <div className="stack" style={{ gap: 24 }}>
      <section>
        <p className="eyebrow">Call simulator</p>
        <h1 className="page-title">Ring the machine</h1>
        <p className="muted page-lede">
          In production a real phone line forwards unanswered calls to AfterBeep. Here you play the caller: pick a voicemail,
          say one into your mic, or type it. The machine answers, reads it, and texts the caller back.
        </p>
      </section>

      <div className="sim-grid">
        <section className="panel panel-pad stack" aria-label="Caller">
          <div className="field">
            <label htmlFor="caller-id">Caller ID</label>
            <input id="caller-id" className="input mono" value={from} onChange={(e) => setFrom(e.target.value)} disabled={busy} inputMode="tel" />
          </div>

          <div className="segmented" role="tablist" aria-label="Message source">
            {(
              [
                ['sample', 'Sample voicemail'],
                ['voice', 'Say it'],
                ['type', 'Type it'],
              ] as const
            ).map(([m, label]) => (
              <button key={m} role="tab" type="button" aria-selected={mode === m} className={mode === m ? 'on' : ''} onClick={() => setMode(m)} disabled={busy}>
                {label}
              </button>
            ))}
          </div>

          {mode === 'sample' && (
            <div className="sample-list" role="radiogroup" aria-label="Sample voicemails">
              {samples.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  role="radio"
                  aria-checked={s.id === sampleId}
                  className={`sample ${s.id === sampleId ? 'on' : ''}`}
                  onClick={() => pickSample(s)}
                  disabled={busy}
                >
                  <span className="sample-label">{s.label}</span>
                  <span className="sample-text">{s.transcript}</span>
                </button>
              ))}
            </div>
          )}
          {mode === 'voice' && (
            <div className="notice">
              {canDictate
                ? 'After the beep, talk like a customer: your name, address, what is broken, and how soon. Then hang up.'
                : 'This browser cannot transcribe speech (try Chrome or Edge). Use a sample or type it instead.'}
            </div>
          )}
          {mode === 'type' && (
            <div className="field">
              <label htmlFor="typed">What the caller says</label>
              <textarea
                id="typed"
                className="input"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                disabled={busy}
                placeholder="Hi, this is Sam Rowe at 12 Willow Street. The upstairs toilet won't stop running. Call me at 614-555-0110."
              />
            </div>
          )}

          {error && <div className="error-box" role="alert">{error}</div>}

          <div className="row">
            <button className="btn btn-primary" type="button" onClick={() => void callMachine()} disabled={busy || (mode === 'voice' && !canDictate)}>
              <PhoneIcon /> Call the machine
            </button>
            {(phase === 'ringing' || phase === 'greeting') && (
              <button className="btn btn-ghost" type="button" onClick={() => skip.current()}>
                Skip to the beep
              </button>
            )}
          </div>
        </section>

        <section className="panel panel-pad sim-machine" aria-live="polite" aria-label="Answering machine">
          <ol className="steps">
            {STEPS.map((s) => {
              const idx = ORDER.indexOf(s.phase[0]!);
              const now = ORDER.indexOf(phase);
              const state = now > idx || phase === 'done' ? 'done' : now === idx ? 'active' : 'todo';
              return (
                <li key={s.label} className={`step ${state}`}>
                  <span className="step-dot">{state === 'done' ? <CheckIcon width={14} height={14} /> : null}</span>
                  {s.label}
                </li>
              );
            })}
          </ol>

          <div className="cassette sim-cassette">
            <div className="cassette-label">
              <span className={`cassette-stripe ${x?.urgency ?? 'routine'}`} />
              <div className="spread" style={{ marginTop: 6 }}>
                <span className="cassette-side">{phase === 'recording' ? 'REC' : 'A'}</span>
                {phase === 'recording' && <span className="led blink" />}
                {x && <UrgencyChip urgency={x.urgency} />}
              </div>
              <div className="cassette-name">{x?.callerName ?? (phase === 'compose' ? 'Blank tape' : 'Incoming...')}</div>
              <div className="cassette-job">{x?.job ?? (phase === 'greeting' ? 'Playing greeting' : ' ')}</div>
            </div>
            <Reels spinning={busy} />
          </div>

          {phase === 'ringing' && <p className="sim-caption ringing">Ring... ring...</p>}
          {phase === 'greeting' && <p className="sim-caption">"{business?.greeting}"</p>}
          {phase === 'recording' && (
            <div className="stack">
              <p className="sim-caption">{mode === 'voice' ? dictation.text || 'Listening...' : shown}</p>
              {mode === 'voice' && (
                <button className="btn btn-primary" type="button" onClick={() => void hangUp()}>
                  <StopIcon /> Hang up
                </button>
              )}
              {dictation.error && <div className="error-box">{dictation.error}</div>}
            </div>
          )}
          {phase === 'processing' && <p className="sim-caption">Transcribing and pulling out the details...</p>}

          {phase === 'done' && result && x && (
            <div className="stack" data-testid="sim-result">
              <dl className="facts facts-tight">
                <div>
                  <dt>Name</dt>
                  <dd>{x.callerName ?? 'Not given'}</dd>
                </div>
                <div>
                  <dt>Call back</dt>
                  <dd className="mono">{x.callbackNumber}</dd>
                </div>
                <div>
                  <dt>Address</dt>
                  <dd>{x.address ?? 'Not given'}</dd>
                </div>
                <div>
                  <dt>Job</dt>
                  <dd>{x.job}</dd>
                </div>
              </dl>
              <p className="ok-text">
                <CheckIcon width={16} height={16} /> Texted back with a booking link
              </p>
              <div className="row">
                <Link className="btn btn-primary" to={`/book/${result.bookingToken}`}>
                  Open the text as the caller <ArrowIcon />
                </Link>
                <Link className="btn" to="/machine">
                  See it in Messages
                </Link>
                <button className="btn btn-ghost" type="button" onClick={() => setPhase('compose')}>
                  <MicIcon /> Another call
                </button>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function formatCallerId(e164: string): string {
  const d = e164.replace(/\D/g, '').replace(/^1/, '');
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : e164;
}
