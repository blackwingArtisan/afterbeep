import { useCallback, useEffect, useRef, useState } from 'react';

/** Minimal typing for the Web Speech API, which TypeScript's DOM library does not include. */
interface RecognitionResult {
  isFinal: boolean;
  0: { transcript: string };
}
interface RecognitionEvent {
  resultIndex: number;
  results: ArrayLike<RecognitionResult>;
}
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function speechSupported(): boolean {
  return recognitionCtor() !== null;
}

/** Browser speech-to-text. The transcript is the local path's stand-in for Amazon Transcribe. */
export function useDictation() {
  const [listening, setListening] = useState(false);
  const [finalText, setFinalText] = useState('');
  const [interim, setInterim] = useState('');
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<Recognition | null>(null);

  const stop = useCallback(() => {
    rec.current?.stop();
  }, []);

  const start = useCallback((seed = '') => {
    const Ctor = recognitionCtor();
    if (!Ctor) {
      setError('This browser cannot transcribe speech. Type the words or pick a sample.');
      return;
    }
    setError(null);
    setFinalText(seed);
    setInterim('');
    const r = new Ctor();
    r.lang = 'en-US';
    r.continuous = true;
    r.interimResults = true;
    r.onresult = (event) => {
      let finals = '';
      let partial = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]!;
        if (result.isFinal) finals += result[0].transcript;
        else partial += result[0].transcript;
      }
      if (finals) setFinalText((prev) => `${prev} ${finals}`.trim());
      setInterim(partial);
    };
    r.onerror = (event) => {
      setError(event.error === 'not-allowed' ? 'Microphone access was blocked.' : `Speech error: ${event.error}`);
    };
    r.onend = () => {
      setListening(false);
      setInterim('');
    };
    rec.current = r;
    r.start();
    setListening(true);
  }, []);

  useEffect(() => () => rec.current?.stop(), []);

  return { listening, text: `${finalText} ${interim}`.trim(), finalText, setFinalText, error, start, stop };
}

/** Reads text aloud with the browser's voice. Resolves when done, or at once when unsupported. */
export function speak(text: string, rate = 1): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return resolve();
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = rate;
    u.pitch = 0.9;
    u.onend = () => resolve();
    u.onerror = () => resolve();
    window.speechSynthesis.speak(u);
  });
}

export function stopSpeaking() {
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel();
}
