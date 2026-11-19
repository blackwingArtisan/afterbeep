/**
 * The remote retrieval call script: the owner calls their own machine, keys a code,
 * hears the new messages and says an invoice.
 *
 * `step(state, event)` is pure. It reads no clock, draws no random number and calls no
 * outside service. A driver (the browser keypad, or a phone flow) feeds it events and
 * carries out the effects it returns. It never says an amount (RR 8.6).
 */
import type { Message, Urgency } from './types';

export type Key = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '*' | '#';

export const CODE_LENGTH = 3;
export const MAX_CODE_TRIES = 3;
/** Seconds the driver waits for a key while the code is asked, and on a message. */
export const CODE_SILENCE_SECONDS = 10;
export const MESSAGE_SILENCE_SECONDS = 20;

/** What the script needs to know about a message. Nothing else leaves the server. */
export interface RemoteMessage {
  id: string;
  urgency: Urgency;
  callerName: string | null;
  job: string;
  transcript: string;
  /** True when the message has a callback number to text. */
  canText: boolean;
}

export type Phase =
  | 'ringing'
  | 'ask-code'
  | 'checking-code'
  | 'message'
  | 'confirm-erase'
  | 'ask-invoice'
  | 'ended';

export interface RemoteState {
  phase: Phase;
  businessName: string;
  /** Code digits keyed so far. Cleared as soon as the code is handed to `verify-code`. */
  digits: string;
  /** Wrong codes on this call, 0 to 3. */
  wrongCodes: number;
  /** Silences in a row at this prompt; any key resets it. */
  silences: number;
  /** Set when the code is accepted. Empty before that, so nothing leaks (RR 1.8). */
  queue: RemoteMessage[];
  index: number;
  /** A text-booking-link effect is out and its result has not come back. */
  pending: 'text' | null;
}

export type TextOutcome = 'sent' | 'opted-out' | 'texted-recently' | 'no-number' | 'refused' | 'failed';

export type RemoteEffect =
  | { type: 'verify-code'; code: string }
  | { type: 'play-message'; messageId: string; transcript: string }
  | { type: 'mark-heard'; messageId: string }
  | { type: 'text-booking-link'; messageId: string }
  | { type: 'erase-message'; messageId: string }
  | { type: 'start-invoice' }
  | { type: 'draft-invoice'; speech: string }
  | { type: 'hang-up' };

export type RemoteEvent =
  | { type: 'call-answered' }
  | { type: 'key'; key: Key }
  | { type: 'silence' }
  | { type: 'code-checked'; result: 'ok'; messages: RemoteMessage[] }
  | { type: 'code-checked'; result: 'wrong' | 'locked' }
  | { type: 'text-result'; outcome: TextOutcome }
  | { type: 'effect-failed'; effect: RemoteEffect['type'] }
  | { type: 'invoice-heard'; speech: string }
  | { type: 'hung-up' };

export type PromptId =
  | 'opening'
  | 'ask-code'
  | 'code-wrong'
  | 'goodbye'
  | 'locked'
  | 'count'
  | 'announce'
  | 'keys'
  | 'confirm-erase'
  | 'erased'
  | 'kept'
  | 'bad-key'
  | 'texted'
  | 'opted-out'
  | 'texted-recently'
  | 'no-number'
  | 'text-failed'
  | 'ask-invoice'
  | 'draft'
  | 'no-invoice'
  | 'went-wrong';

export interface Prompt {
  id: PromptId;
  /** What is spoken. */
  text: string;
}

export interface Step {
  state: RemoteState;
  prompts: Prompt[];
  effects: RemoteEffect[];
}

/** A stored message, possibly erased. `erasedAt` arrives with the erase task. */
export type RemoteSource = Message & { erasedAt?: string | null };

const URGENCY_RANK: Record<Urgency, number> = { emergency: 0, soon: 1, routine: 2 };

/** New, not erased, not a hang-up; emergency, then soon, then routine; oldest first within each. */
export function remoteQueue(messages: readonly RemoteSource[]): RemoteMessage[] {
  return messages
    .filter((m) => m.status === 'new' && !m.erasedAt && !m.hangUp)
    .sort(
      (a, b) =>
        URGENCY_RANK[a.extraction.urgency] - URGENCY_RANK[b.extraction.urgency] ||
        (a.receivedAt < b.receivedAt ? -1 : a.receivedAt > b.receivedAt ? 1 : 0) ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    )
    .map(toRemoteMessage);
}

/** The fields of a stored message that the script needs. The phone Lambda builds these from the API. */
export interface RemoteMessageInput {
  id: string;
  from: string;
  transcript: string;
  extraction: {
    urgency: Urgency;
    callerName: string | null;
    callbackNumber: string | null;
    job: string;
  };
}

/** The one mapping from a stored message to what the script sees (RR 14.10). */
export function toRemoteMessage(m: RemoteMessageInput): RemoteMessage {
  return {
    id: m.id,
    urgency: m.extraction.urgency,
    callerName: m.extraction.callerName?.trim() || null,
    job: m.extraction.job,
    transcript: m.transcript,
    canText: Boolean((m.extraction.callbackNumber ?? m.from)?.trim()),
  };
}

export function startState(businessName: string): RemoteState {
  return {
    phase: 'ringing',
    businessName,
    digits: '',
    wrongCodes: 0,
    silences: 0,
    queue: [],
    index: 0,
    pending: null,
  };
}

// ---------------------------------------------------------------- prompts

const p = (id: PromptId, text: string): Prompt => ({ id, text });

const KEYS_TEXT = 'Press 1 to play, 2 to text back, 9 to erase, pound for next.';

function clip(text: string, maxWords: number): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  return words.slice(0, maxWords).join(' ');
}

const opening = (businessName: string) =>
  p('opening', `This is the answering machine for ${clip(businessName, 8)}. Enter your three-digit remote code.`);
const askCode = () => p('ask-code', 'Enter your three-digit remote code.');
const goodbye = () => p('goodbye', 'Goodbye.');
const keysPrompt = () => p('keys', KEYS_TEXT);
const askInvoice = () => p('ask-invoice', 'After the beep, say your invoice.');
const wentWrong = () => p('went-wrong', 'Something went wrong.');

function countPrompt(n: number): Prompt {
  if (n === 0) return p('count', 'You have no new messages.');
  if (n === 1) return p('count', 'You have 1 new message.');
  return p('count', `You have ${n} new messages.`);
}

function announce(state: RemoteState, index: number): Prompt[] {
  const m = state.queue[index];
  if (!m) return [];
  const parts = [`Message ${index + 1} of ${state.queue.length}.`];
  if (m.urgency === 'emergency') parts.push('Emergency.');
  else if (m.urgency === 'soon') parts.push('Soon.');
  parts.push(`From ${m.callerName ? clip(m.callerName, 5) : 'an unknown caller'}.`);
  parts.push(`${clip(m.job, 10)}.`);
  return [p('announce', parts.join(' ')), keysPrompt()];
}

const TEXT_PROMPTS: Record<TextOutcome, Prompt> = {
  sent: p('texted', 'Booking link texted.'),
  'opted-out': p('opted-out', 'That caller asked not to be texted.'),
  'texted-recently': p('texted-recently', 'That caller was texted a moment ago.'),
  'no-number': p('no-number', 'There is no number to text.'),
  refused: p('text-failed', 'The text did not go out.'),
  failed: p('text-failed', 'The text did not go out.'),
};

// ---------------------------------------------------------------- step

const unchanged = (state: RemoteState): Step => ({ state, prompts: [], effects: [] });

const isDigit = (key: Key): boolean => key >= '0' && key <= '9';

function hangUp(state: RemoteState, prompts: Prompt[]): Step {
  return {
    state: { ...state, phase: 'ended', digits: '', pending: null },
    prompts,
    effects: [{ type: 'hang-up' }],
  };
}

/** Move to message `index`, or to the invoice prompt when the queue is done. */
function goTo(state: RemoteState, index: number, lead: Prompt[], effects: RemoteEffect[]): Step {
  if (index < state.queue.length) {
    return {
      state: { ...state, phase: 'message', index, silences: 0, pending: null },
      prompts: [...lead, ...announce(state, index)],
      effects,
    };
  }
  return {
    state: { ...state, phase: 'ask-invoice', index, silences: 0, pending: null },
    prompts: [...lead, askInvoice()],
    effects: [...effects, { type: 'start-invoice' }],
  };
}

export function step(state: RemoteState, event: RemoteEvent): Step {
  if (state.phase === 'ended') return unchanged(state);
  if (event.type === 'hung-up') {
    return { state: { ...state, phase: 'ended', digits: '', pending: null }, prompts: [], effects: [] };
  }
  switch (state.phase) {
    case 'ringing':
      if (event.type === 'call-answered') {
        return { state: { ...state, phase: 'ask-code' }, prompts: [opening(state.businessName)], effects: [] };
      }
      return unchanged(state);
    case 'ask-code':
      return stepAskCode(state, event);
    case 'checking-code':
      return stepChecking(state, event);
    case 'message':
      return stepMessage(state, event);
    case 'confirm-erase':
      return stepConfirmErase(state, event);
    case 'ask-invoice':
      return stepAskInvoice(state, event);
  }
}

function stepAskCode(state: RemoteState, event: RemoteEvent): Step {
  if (event.type === 'key') {
    const base = { ...state, silences: 0 };
    if (event.key === '*') return { state: { ...base, digits: '' }, prompts: [askCode()], effects: [] };
    if (!isDigit(event.key)) return { state: base, prompts: [], effects: [] };
    const digits = state.digits + event.key;
    if (digits.length < CODE_LENGTH) return { state: { ...base, digits }, prompts: [], effects: [] };
    return {
      state: { ...base, phase: 'checking-code', digits: '' },
      prompts: [],
      effects: [{ type: 'verify-code', code: digits }],
    };
  }
  if (event.type === 'silence') {
    if (state.silences === 0) {
      return { state: { ...state, digits: '', silences: 1 }, prompts: [askCode()], effects: [] };
    }
    return hangUp(state, [goodbye()]);
  }
  return unchanged(state);
}

function stepChecking(state: RemoteState, event: RemoteEvent): Step {
  if (event.type === 'code-checked') {
    if (event.result === 'ok') {
      const queue = event.messages;
      const next: RemoteState = { ...state, queue, index: 0, wrongCodes: 0, silences: 0, digits: '' };
      return goTo(next, 0, [countPrompt(queue.length)], []);
    }
    if (event.result === 'locked') {
      return hangUp(state, [p('locked', 'The machine is locked. Try again later.')]);
    }
    const wrongCodes = state.wrongCodes + 1;
    if (wrongCodes >= MAX_CODE_TRIES) {
      return hangUp({ ...state, wrongCodes }, [p('code-wrong', 'That code is not right.'), goodbye()]);
    }
    return {
      state: { ...state, phase: 'ask-code', wrongCodes, digits: '', silences: 0 },
      prompts: [p('code-wrong', 'That code is not right.'), askCode()],
      effects: [],
    };
  }
  if (event.type === 'effect-failed' && event.effect === 'verify-code') {
    return {
      state: { ...state, phase: 'ask-code', digits: '', silences: 0 },
      prompts: [wentWrong(), askCode()],
      effects: [],
    };
  }
  return unchanged(state);
}

function stepMessage(state: RemoteState, event: RemoteEvent): Step {
  const current = state.queue[state.index];
  if (!current) return unchanged(state);

  if (event.type === 'text-result') {
    if (state.pending !== 'text') return unchanged(state);
    return {
      state: { ...state, pending: null },
      prompts: [TEXT_PROMPTS[event.outcome], keysPrompt()],
      effects: [],
    };
  }
  if (event.type === 'effect-failed') {
    return {
      state: { ...state, pending: null, silences: 0 },
      prompts: [wentWrong(), keysPrompt()],
      effects: [],
    };
  }
  // While a text is out, nothing else moves the call (one effect per press).
  if (state.pending === 'text') return unchanged(state);

  if (event.type === 'silence') {
    if (state.silences === 0) return { state: { ...state, silences: 1 }, prompts: [keysPrompt()], effects: [] };
    return hangUp(state, [goodbye()]);
  }
  if (event.type !== 'key') return unchanged(state);

  const base = { ...state, silences: 0 };
  switch (event.key) {
    case '1':
      return {
        state: base,
        prompts: [keysPrompt()],
        effects: [
          { type: 'play-message', messageId: current.id, transcript: current.transcript },
          { type: 'mark-heard', messageId: current.id },
        ],
      };
    case '2':
      if (!current.canText) {
        return { state: base, prompts: [TEXT_PROMPTS['no-number'], keysPrompt()], effects: [] };
      }
      return {
        state: { ...base, pending: 'text' },
        prompts: [],
        effects: [{ type: 'text-booking-link', messageId: current.id }],
      };
    case '9':
      return {
        state: { ...base, phase: 'confirm-erase' },
        prompts: [p('confirm-erase', 'Press 9 again to erase it. Any other key keeps it.')],
        effects: [],
      };
    case '#':
      return goTo(base, state.index + 1, [], []);
    case '*':
      return { state: base, prompts: announce(base, state.index), effects: [] };
    default:
      return { state: base, prompts: [p('bad-key', 'That key does nothing here.'), keysPrompt()], effects: [] };
  }
}

function stepConfirmErase(state: RemoteState, event: RemoteEvent): Step {
  const current = state.queue[state.index];
  if (!current) return unchanged(state);
  if (event.type === 'key') {
    if (event.key === '9') {
      return goTo({ ...state, silences: 0 }, state.index + 1, [p('erased', 'Erased.')], [
        { type: 'erase-message', messageId: current.id },
      ]);
    }
    return {
      state: { ...state, phase: 'message', silences: 0 },
      prompts: [p('kept', 'Kept.'), keysPrompt()],
      effects: [],
    };
  }
  if (event.type === 'silence') {
    if (state.silences === 0) {
      return {
        state: { ...state, silences: 1 },
        prompts: [p('confirm-erase', 'Press 9 again to erase it. Any other key keeps it.')],
        effects: [],
      };
    }
    return hangUp(state, [goodbye()]);
  }
  if (event.type === 'effect-failed') {
    return { state: { ...state, phase: 'message', silences: 0 }, prompts: [wentWrong(), keysPrompt()], effects: [] };
  }
  return unchanged(state);
}

function stepAskInvoice(state: RemoteState, event: RemoteEvent): Step {
  if (event.type === 'invoice-heard') {
    const speech = event.speech.trim();
    if (!speech) return hangUp(state, [p('no-invoice', 'No invoice heard.'), goodbye()]);
    const done = hangUp(state, [
      p('draft', 'Got it. Your invoice is a draft. Nothing goes out until you approve the total.'),
    ]);
    return { ...done, effects: [{ type: 'draft-invoice', speech }, { type: 'hang-up' }] };
  }
  if (event.type === 'effect-failed') {
    return { state, prompts: [wentWrong()], effects: [] };
  }
  return unchanged(state);
}
