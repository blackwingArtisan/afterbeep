import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { beep, ring } from '../lib/sound';
import { MessageCounter } from './Lcd';
import { Reels } from './Reels';

const VOICEMAIL =
  "Hi, this is Priya Natarajan. My water heater just burst and there's water all over the basement floor. I'm at 88 Hollow Pine Road. Please call me back at 614-555-0134.";
const TEXT_BACK =
  "Hi Priya, it's Morgan at Hollow Creek Plumbing & Appliance. Got your message about your water heater. I'll call you back the minute I'm off this job. Grab the earliest visit here: afterbeep.example.com/book/...";

type Mode = 'idle' | 'tapefull' | 'ringing' | 'playing' | 'texted' | 'bill';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const AUTOPLAY_KEY = 'afterbeep.hero-autoplayed';

/** True the first time it is asked in a browser session; storage errors (private mode) mean no autoplay. */
function firstVisitThisSession(): boolean {
  try {
    if (window.sessionStorage.getItem(AUTOPLAY_KEY)) return false;
    window.sessionStorage.setItem(AUTOPLAY_KEY, '1');
    return true;
  } catch {
    return false;
  }
}

/** A VU meter: bars that dance while the machine rings or plays, and sit faint and still when idle. */
function Waveform({ live }: { live: boolean }) {
  return (
    <span className={`vu ${live ? 'live' : ''}`} aria-hidden="true" data-testid="device-vu">
      {Array.from({ length: 28 }, (_, i) => (
        <span key={i} style={{ animationDelay: `${(i * 97) % 600}ms` }} />
      ))}
    </span>
  );
}

/**
 * The hero: a 1980s answering machine, back from the dead. Play runs a real-looking missed
 * call (ring, beep, the words typed across the label, the text back), Bill prints the price-book
 * hold, and Book opens a real booking page from the demo data.
 */
export function Device({ count = 3 }: { count?: number }) {
  const [mode, setMode] = useState<Mode>('idle');
  const [typed, setTyped] = useState('');
  const run = useRef(0);
  const navigate = useNavigate();

  useEffect(() => () => void run.current++, []);

  // The first five seconds should move, once per session and silently, unless the visitor asked for
  // less motion: the old machine flashes TAPE FULL, AfterBeep picks up, the message types in, the
  // text goes back, and then the carbon copies hold a misheard price.
  useEffect(() => {
    if (reducedMotion()) return;
    const timer = setTimeout(() => {
      if (run.current === 0 && firstVisitThisSession()) void coldOpen();
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  async function coldOpen() {
    const token = ++run.current;
    setMode('tapefull');
    await wait(800);
    if (run.current !== token) return;
    await play({ muted: true, fast: true, token });
    await wait(2600);
    if (run.current === token) setMode('bill');
  }

  async function play({ muted = false, fast = false, token = ++run.current }: { muted?: boolean; fast?: boolean; token?: number } = {}) {
    setTyped('');
    setMode('ringing');
    if (!muted) ring(1);
    await wait(reducedMotion() ? 0 : fast ? 400 : 1400);
    if (run.current !== token) return;
    if (!muted) beep();
    setMode('playing');
    const words = VOICEMAIL.split(' ');
    if (reducedMotion()) {
      setTyped(VOICEMAIL);
    } else {
      const step = fast ? 3 : 1;
      for (let i = step; i < words.length + step; i += step) {
        if (run.current !== token) return;
        setTyped(words.slice(0, i).join(' '));
        await wait(fast ? 35 : 55);
      }
    }
    await wait(reducedMotion() ? 0 : fast ? 300 : 500);
    if (run.current === token) setMode('texted');
  }

  function bill() {
    run.current++;
    setMode('bill');
  }

  async function book() {
    run.current++;
    try {
      const { messages } = await api.messages();
      const open = messages.find((m) => m.textedAt && !m.jobId);
      navigate(open ? `/book/${open.bookingToken}` : '/machine/call');
    } catch {
      navigate('/machine/call');
    }
  }

  const spinning = mode === 'ringing' || mode === 'playing' || mode === 'idle';
  const live = mode === 'ringing' || mode === 'playing';
  return (
    <div className="device" role="group" aria-label="AfterBeep answering machine demo" data-testid="device">
      <div className="device-top">
        <div className="device-grill" />
        <MessageCounter count={count} />
      </div>
      <div className="device-deck">
        <div className="cassette device-cassette">
          <div className="cassette-label">
            <span className="cassette-stripe emergency" />
            <div className="spread" style={{ marginTop: 6 }}>
              <span className="cassette-side">A1</span>
              {mode === 'ringing' ? <span className="led blink" aria-hidden="true" /> : <span className="chip chip-emergency">Emergency</span>}
            </div>
            <div className="cassette-name">Priya N.</div>
            <div className="cassette-job">Water heater: burst, flooding</div>
          </div>
          <Reels spinning={spinning} />
        </div>
      </div>
      <div className="device-keys">
        <button
          type="button"
          className={`key key-play ${mode === 'idle' ? 'idle' : ''}`}
          onClick={() => void play()}
          aria-pressed={mode === 'playing' || mode === 'texted'}
        >
          <span className={`led led-small ${mode === 'idle' || mode === 'ringing' ? 'blink' : mode === 'bill' ? 'off' : ''}`} aria-hidden="true" />
          Play
        </button>
        <button type="button" className="key" onClick={() => void book()}>
          Book
        </button>
        <button type="button" className="key" onClick={bill} aria-pressed={mode === 'bill'}>
          Bill
        </button>
      </div>
      <div className="device-readout" aria-live="polite" data-testid="device-readout">
        {(mode === 'idle' || live) && <Waveform live={live} />}
        {mode === 'idle' && <p className="device-hint">Press Play to hear a missed call. Bill shows the price check.</p>}
        {mode === 'tapefull' && (
          <div className="device-tapefull" data-testid="device-tapefull">
            <span className="tapefull-lcd">Tape full</span>
            <p>The old machine. The tape is full, so the caller hangs up. On plain voicemail, 69% of callers never leave a word.</p>
          </div>
        )}
        {mode === 'ringing' && <p className="device-hint">Ring... AfterBeep picks up. Beep.</p>}
        {(mode === 'playing' || mode === 'texted') && <p className="device-words">"{typed}"</p>}
        {mode === 'texted' && (
          <div className="device-text">
            <span className="device-text-to">Texted back to (614) 555-0134</span>
            <p>{TEXT_BACK}</p>
          </div>
        )}
        {mode === 'bill' && (
          <div className="device-slip" data-testid="device-slip">
            <span className="device-slip-said">"Dryer belt, fifteen."</span>
            <span className="device-slip-hold">On hold</span>
            <p>You said $15.00. You always charge $50 for a dryer belt (4 past invoices). Nothing is sent until you choose.</p>
          </div>
        )}
      </div>
      <div className="device-note">3 new jobs!</div>
    </div>
  );
}
