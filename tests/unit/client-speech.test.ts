import { afterEach, describe, expect, it, vi } from 'vitest';
import { speak } from '../../src/client/lib/speech';

afterEach(() => vi.unstubAllGlobals());

describe('spoken prompts', () => {
  it('[RR 12.5] speaks a prompt where the browser can speak', async () => {
    const spoken: string[] = [];
    class Utterance {
      rate = 1;
      pitch = 1;
      onend: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(public text: string) {}
    }
    const speechSynthesis = {
      cancel: vi.fn(),
      speak: (u: Utterance) => {
        spoken.push(u.text);
        u.onend?.();
      },
    };
    vi.stubGlobal('window', { speechSynthesis });
    vi.stubGlobal('SpeechSynthesisUtterance', Utterance);
    await speak('You have 2 new messages.');
    expect(spoken).toEqual(['You have 2 new messages.']);
  });

  it('[RR 12.5] finishes without speaking where the browser cannot, so the text still shows', async () => {
    vi.stubGlobal('window', {});
    await expect(speak('Goodbye.')).resolves.toBeUndefined();
  });
});
