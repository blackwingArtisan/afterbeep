import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  CODE_SILENCE_SECONDS,
  MESSAGE_SILENCE_SECONDS,
  startState,
  step,
  type Key,
  type RemoteEffect,
  type RemoteEvent,
  type RemoteState,
} from '../../domain/remote-retrieval';
import { api } from '../api';
import { ArrowIcon, MicIcon, PhoneIcon, StopIcon } from '../components/Icons';
import { Keypad } from '../components/Keypad';
import { useMachine, useTitle } from '../lib/machine';
import { DEMO_REMOTE_CODE } from '../lib/remote';
import { beep, ring } from '../lib/sound';
import { speak, speechSupported, stopSpeaking, useDictation } from '../lib/speech';

interface Line {
  id: number;
  who: 'machine' | 'caller' | 'you';
  text: string;
}

/** Calling your own machine from the truck: the keypad drives the same pure call script a phone flow would. */
export default function Remote() {
  useTitle('Remote');
  const { business, refresh } = useMachine();
  const [view, setView] = useState<RemoteState | null>(null);
  const [tick, setTick] = useState(0);
  const [lines, setLines] = useState<Line[]>([]);
  const [ringing, setRinging] = useState(false);
  const [demo, setDemo] = useState(false);
  const [talk, setTalk] = useState(true);
  const [words, setWords] = useState('');
  const [draftSpeech, setDraftSpeech] = useState<string | null>(null);
  const dictation = useDictation();
  const canDictate = speechSupported();

  const state = useRef<RemoteState | null>(null);
  const nextId = useRef(0);
  const talkRef = useRef(true);
  const answerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  talkRef.current = talk;

  useEffect(() => {
    void api.health().then((h) => setDemo(h.demo)).catch(() => setDemo(false));
    return () => {
      if (answerTimer.current) clearTimeout(answerTimer.current);
      stopSpeaking();
    };
  }, []);

  useEffect(() => {
    if (dictation.listening) setWords(dictation.text);
  }, [dictation.listening, dictation.text]);

  // Keep the newest prompt in view as the call goes on.
  const tapeRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const tape = tapeRef.current;
    if (tape) tape.scrollTop = tape.scrollHeight;
  }, [lines]);

  const dispatchRef = useRef<(event: RemoteEvent) => void>(() => {});

  const run = useCallback((effect: RemoteEffect) => {
    const send = (event: RemoteEvent) => dispatchRef.current(event);
    const failed = () => send({ type: 'effect-failed', effect: effect.type });
    switch (effect.type) {
      case 'verify-code':
        api
          .remoteCode(effect.code)
          .then((r) => send(r.result === 'ok' ? { type: 'code-checked', result: 'ok', messages: r.messages } : { type: 'code-checked', result: r.result }))
          .catch(failed);
        break;
      case 'mark-heard':
        // Playing never lowers a status: only a message that is still new becomes heard (RR 4.3).
        api
          .messages()
          .then(({ messages }) => {
            if (messages.find((m) => m.id === effect.messageId)?.status === 'new') return api.setStatus(effect.messageId, 'heard');
          })
          .catch(failed);
        break;
      case 'text-booking-link':
        api
          .remoteText(effect.messageId)
          .then((r) => send({ type: 'text-result', outcome: r.outcome }))
          .catch(failed);
        break;
      case 'erase-message':
        api.remoteErase(effect.messageId).catch(failed);
        break;
      case 'start-invoice':
        beep();
        break;
      case 'draft-invoice':
        setDraftSpeech(effect.speech);
        break;
      case 'play-message':
      case 'hang-up':
        // The transcript is shown and spoken with the step's prompts; hanging up is handled when the call ends.
        break;
    }
  }, []);

  const dispatch = useCallback(
    (event: RemoteEvent) => {
      const before = state.current;
      if (!before) return;
      const result = step(before, event);
      state.current = result.state;
      setView(result.state);
      setTick((t) => t + 1);

      const added: Line[] = [];
      const spoken: string[] = [];
      for (const effect of result.effects) {
        if (effect.type === 'play-message') {
          added.push({ id: nextId.current++, who: 'caller', text: effect.transcript });
          spoken.push(effect.transcript);
        }
      }
      for (const prompt of result.prompts) {
        added.push({ id: nextId.current++, who: 'machine', text: prompt.text });
        spoken.push(prompt.text);
      }
      if (added.length) setLines((all) => [...all, ...added]);
      if (spoken.length && talkRef.current) void speak(spoken.join(' '));

      for (const effect of result.effects) run(effect);

      if (result.state.phase === 'ended' && before.phase !== 'ended') {
        stopSpeaking();
        void refresh().catch(() => {});
      }
    },
    [refresh, run],
  );
  dispatchRef.current = dispatch;

  function startCall() {
    if (!business) return;
    stopSpeaking();
    state.current = startState(business.name);
    setView(state.current);
    setLines([]);
    setWords('');
    setDraftSpeech(null);
    setRinging(true);
    ring(1);
    answerTimer.current = setTimeout(() => {
      setRinging(false);
      dispatch({ type: 'call-answered' });
    }, 900);
  }

  const onKey = useCallback(
    (key: Key) => {
      const phase = state.current?.phase;
      if (phase && phase !== 'ask-code' && phase !== 'checking-code' && phase !== 'ringing') {
        setLines((all) => [...all, { id: nextId.current++, who: 'you', text: `Pressed ${key}` }]);
      }
      dispatch({ type: 'key', key });
    },
    [dispatch],
  );

  // The silence timers live here; the script counts the silences (RR 1.7, 7.4).
  const phase = view?.phase;
  const pending = view?.pending ?? null;
  useEffect(() => {
    if (pending) return;
    let seconds = 0;
    if (phase === 'ask-code') seconds = CODE_SILENCE_SECONDS;
    else if (phase === 'message' || phase === 'confirm-erase') seconds = MESSAGE_SILENCE_SECONDS;
    if (!seconds) return;
    const timer = setTimeout(() => dispatchRef.current({ type: 'silence' }), seconds * 1000);
    return () => clearTimeout(timer);
  }, [phase, pending, tick]);

  const live = phase !== undefined && phase !== 'ended' && !ringing;
  const keysOn = phase === 'ask-code' || phase === 'message' || phase === 'confirm-erase';
  const readout = phase === 'ask-code' ? (view?.digits ?? '').replace(/./g, '•').padEnd(3, '_') : phase === 'message' || phase === 'confirm-erase' ? `${(view?.index ?? 0) + 1}/${view?.queue.length ?? 0}` : '---';

  function sendWords() {
    if (dictation.listening) dictation.stop();
    dispatch({ type: 'invoice-heard', speech: words });
  }

  return (
    <div className="stack" style={{ gap: 24 }}>
      <section>
        <p className="eyebrow">Call in</p>
        <h1 className="page-title">Phone your own machine</h1>
        <p className="muted page-lede">
          From the truck, key your 3-digit code, hear what is waiting, text a caller your open times, then say the invoice. This screen is the
          keypad for that call. Nothing is sent without your approval.
        </p>
      </section>

      <div className="remote-grid">
        <section className="panel panel-pad stack" aria-label="Keypad">
          <div className="remote-status">
            <span className="label">{ringing ? 'Ringing...' : live ? 'On the line' : phase === 'ended' ? 'Call ended' : 'Not calling'}</span>
            <span className="remote-readout" data-testid="remote-readout" aria-label="Display">
              {readout}
            </span>
          </div>
          <Keypad onKey={onKey} disabled={!keysOn} />
          <div className="row">
            {live ? (
              <button className="btn" type="button" onClick={() => dispatch({ type: 'hung-up' })}>
                <StopIcon /> Hang up
              </button>
            ) : (
              <button className="btn btn-primary" type="button" onClick={startCall} disabled={!business || ringing}>
                <PhoneIcon /> {phase === 'ended' ? 'Call again' : 'Call your machine'}
              </button>
            )}
            <label className="tick">
              <input type="checkbox" checked={talk} onChange={(e) => setTalk(e.target.checked)} /> Speak the prompts
            </label>
          </div>
          {demo && (
            <p className="remote-code-hint" data-testid="remote-demo-code">
              Demo mode. The remote code is <strong>{DEMO_REMOTE_CODE}</strong>.
            </p>
          )}
        </section>

        <section className="panel panel-pad stack" aria-label="The call">
          <h2 className="ogm-checks-title">What the machine says</h2>
          <div ref={tapeRef} className="remote-tape" data-testid="remote-tape" aria-live="polite">
            {lines.length === 0 && <p className="remote-empty">Press Call your machine. It answers and asks for your code.</p>}
            {lines.map((line) => (
              <div key={line.id} className={`remote-line is-${line.who}`} data-who={line.who}>
                {line.who === 'caller' && <span className="faint">Caller: </span>}
                {line.text}
              </div>
            ))}
          </div>

          {phase === 'ask-invoice' && (
            <div className="remote-invoice" data-testid="remote-invoice">
              <div className="field">
                <label htmlFor="remote-words">Say your invoice</label>
                <textarea
                  id="remote-words"
                  className="input"
                  value={words}
                  onChange={(e) => setWords(e.target.value)}
                  placeholder="Dryer belt fifty, taxed. One hour labor at eighty-five."
                />
              </div>
              <div className="row">
                {canDictate &&
                  (dictation.listening ? (
                    <button className="btn" type="button" onClick={dictation.stop}>
                      <StopIcon /> Done talking
                    </button>
                  ) : (
                    <button className="btn" type="button" onClick={() => dictation.start(words)}>
                      <MicIcon /> Say it
                    </button>
                  ))}
                <button className="btn btn-primary" type="button" onClick={sendWords}>
                  Give it to the machine <ArrowIcon />
                </button>
              </div>
              {dictation.error && <div className="notice">{dictation.error}</div>}
            </div>
          )}

          {draftSpeech !== null && (
            <div className="row">
              <Link className="btn btn-primary" to="/machine/invoice" state={{ speech: draftSpeech }} data-testid="open-draft">
                Open the draft <ArrowIcon />
              </Link>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
