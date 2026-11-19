/**
 * The outgoing message (OGM): what a caller hears before the beep. Plain voicemail loses most
 * callers, so the greeting has a job to do: say it is a machine, promise a text, and ask for what
 * the machine needs. These checks are advice, shown as the owner types, except one rule: the
 * greeting must never claim a person is on the line.
 */

/** Words a caller hears per second at a calm speaking pace. */
const WORDS_PER_SECOND = 2.5;
export const MAX_GREETING_SECONDS = 25;
export const GREETING_MIN_CHARS = 10;
export const GREETING_MAX_CHARS = 400;

export interface GreetingCheck {
  id: 'machine' | 'text' | 'details' | 'short';
  label: string;
  pass: boolean;
}

export function spokenSeconds(greeting: string): number {
  const words = greeting.trim().split(/\s+/).filter(Boolean).length;
  return Math.round(words / WORDS_PER_SECOND);
}

export function greetingChecks(greeting: string): GreetingCheck[] {
  const g = greeting.toLowerCase();
  const asks = [/\bname\b/, /\baddress\b|\bwhere\b/, /what'?s (going on|wrong|broken)|\bwhat happened\b|\bthe problem\b|\bwhat you need\b|\bwhat'?s broken\b/];
  return [
    { id: 'machine', label: 'Says it is a machine', pass: /\b(answering )?machine\b|\brecording\b|\bvoicemail\b/.test(g) },
    { id: 'text', label: 'Promises a text back', pass: /\btext(ed)?\b/.test(g) },
    { id: 'details', label: 'Asks for name, address and the problem', pass: asks.every((r) => r.test(g)) },
    { id: 'short', label: `Under ${MAX_GREETING_SECONDS} seconds`, pass: spokenSeconds(greeting) <= MAX_GREETING_SECONDS },
  ];
}

const PRETENDS_TO_BE_A_PERSON = [
  /\bthis is (the )?(receptionist|front desk|office manager|assistant)\b/,
  /\bi'?m (the|your) (receptionist|assistant|office manager)\b/,
  /\byou'?re (speaking|talking) (to|with) a (real )?(person|human)\b/,
  /\b(i'?m|i am) (a )?(real )?(person|human)\b/,
  /\bnot a (machine|robot|recording)\b/,
];

/** Why a greeting may not be saved, or null when it may. */
export function greetingProblem(greeting: string): string | null {
  const g = greeting.trim();
  if (g.length < GREETING_MIN_CHARS) return 'The greeting is too short to tell a caller what to do.';
  if (g.length > GREETING_MAX_CHARS) return `Keep the greeting under ${GREETING_MAX_CHARS} characters; callers hang up on long ones.`;
  if (PRETENDS_TO_BE_A_PERSON.some((r) => r.test(g.toLowerCase()))) {
    return 'AfterBeep is an honest machine: the greeting cannot claim a person is on the line.';
  }
  return null;
}
