import { useEffect } from 'react';
import type { Key } from '../../domain/remote-retrieval';
import { dtmf } from '../lib/sound';

export const KEYPAD_KEYS: Key[] = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'];

const SUB: Partial<Record<Key, string>> = { '1': 'play', '2': 'text', '9': 'erase', '#': 'next', '*': 'repeat' };

function isKey(value: string): value is Key {
  return (KEYPAD_KEYS as string[]).includes(value);
}

interface KeypadProps {
  onKey: (key: Key) => void;
  disabled?: boolean;
}

/** Twelve big keys. The computer keyboard presses them too, unless the owner is typing in a field. */
export function Keypad({ onKey, disabled = false }: KeypadProps) {
  function press(key: Key) {
    if (disabled) return;
    dtmf(key);
    onKey(key);
  }

  useEffect(() => {
    if (disabled) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (!isKey(event.key)) return;
      event.preventDefault();
      dtmf(event.key);
      onKey(event.key);
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [disabled, onKey]);

  return (
    <div className="keypad" role="group" aria-label="Keypad" data-testid="keypad">
      {KEYPAD_KEYS.map((key) => (
        <button key={key} type="button" className="keypad-key" disabled={disabled} onClick={() => press(key)} aria-label={key === '#' ? '#' : key}>
          <span className="keypad-digit" aria-hidden="true">
            {key}
          </span>
          <span className="keypad-sub" aria-hidden="true">
            {SUB[key] ?? ''}
          </span>
        </button>
      ))}
    </div>
  );
}
