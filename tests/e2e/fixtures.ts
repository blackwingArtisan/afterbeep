import { test as base } from '@playwright/test';

export { expect, type APIRequestContext, type Page } from '@playwright/test';

/**
 * Every page in these tests gets a stand-in voice. The app speaks prompts and greetings through the
 * browser's speechSynthesis, which hands each one to the operating system's voice service; when that
 * service is busy it can hold a headless browser for many seconds per prompt. The stand-in keeps the
 * timing the app relies on (an utterance lasts a moment, about 20 ms a character up to 3 seconds, and
 * cancel interrupts it) without the operating system. The spoken words are covered by unit tests.
 */
export const test = base.extend<{ standInVoice: void }>({
  standInVoice: [
    async ({ page }, use) => {
      await page.addInitScript(() => {
        const synth = window.speechSynthesis;
        if (!synth) return;
        const pending = new Map<SpeechSynthesisUtterance, ReturnType<typeof setTimeout>>();
        synth.speak = (utterance: SpeechSynthesisUtterance) => {
          const ms = Math.min(3000, 20 * utterance.text.length);
          pending.set(
            utterance,
            setTimeout(() => {
              pending.delete(utterance);
              utterance.onend?.(new Event('end') as SpeechSynthesisEvent);
            }, ms),
          );
        };
        synth.cancel = () => {
          for (const [utterance, timer] of pending) {
            clearTimeout(timer);
            utterance.onerror?.(new Event('error') as SpeechSynthesisErrorEvent);
          }
          pending.clear();
        };
      });
      await use();
    },
    { auto: true },
  ],
});
