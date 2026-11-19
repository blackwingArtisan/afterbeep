/** Tiny Web Audio sound effects: the ring, and the beep. Silent when audio is unavailable. */

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === 'undefined' || !('AudioContext' in window)) return null;
  ctx ??= new AudioContext();
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

function tone(freqs: number[], start: number, duration: number, gain = 0.08) {
  const a = audio();
  if (!a) return;
  const out = a.createGain();
  out.gain.setValueAtTime(0, a.currentTime + start);
  out.gain.linearRampToValueAtTime(gain, a.currentTime + start + 0.02);
  out.gain.setValueAtTime(gain, a.currentTime + start + duration - 0.03);
  out.gain.linearRampToValueAtTime(0, a.currentTime + start + duration);
  out.connect(a.destination);
  for (const f of freqs) {
    const osc = a.createOscillator();
    osc.frequency.value = f;
    osc.connect(out);
    osc.start(a.currentTime + start);
    osc.stop(a.currentTime + start + duration);
  }
}

/** North American ringback: 440 + 480 Hz, two seconds on. */
export function ring(times = 2) {
  for (let i = 0; i < times; i++) tone([440, 480], i * 1.6, 1.1, 0.05);
}

/** The beep. */
export function beep() {
  tone([1000], 0, 0.45, 0.07);
}

const DTMF_ROWS = [697, 770, 852, 941] as const;
const DTMF_COLS = [1209, 1336, 1477] as const;
const DTMF_LAYOUT = ['123', '456', '789', '*0#'] as const;

/** The standard keypad tone pairs: [row Hz, column Hz] for each of the twelve keys. */
export const DTMF_FREQUENCIES: Record<string, readonly [number, number]> = Object.fromEntries(
  DTMF_LAYOUT.flatMap((row, r) => [...row].map((key, c) => [key, [DTMF_ROWS[r]!, DTMF_COLS[c]!] as const])),
);

/** One keypad press: its two-tone pair for 120 ms. Silent when audio is unavailable. */
export function dtmf(key: string) {
  const pair = DTMF_FREQUENCIES[key];
  if (pair) tone([...pair], 0, 0.12, 0.05);
}
