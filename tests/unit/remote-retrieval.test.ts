import { describe, expect, it, vi } from 'vitest';
import {
  remoteQueue,
  startState,
  step,
  type Key,
  type RemoteEffect,
  type RemoteEvent,
  type RemoteMessage,
  type RemoteSource,
  type RemoteState,
  type Step,
} from '../../src/domain/remote-retrieval';
import type { Urgency } from '../../src/domain/types';

const BUSINESS = 'Hollow Creek Plumbing and Appliance';

function source(
  id: string,
  urgency: Urgency,
  receivedAt: string,
  extra: Partial<RemoteSource> = {},
  callerName: string | null = 'Priya Shah',
): RemoteSource {
  return {
    id,
    receivedAt,
    from: '+15555550101',
    durationSec: 20,
    transcript: `transcript of ${id}`,
    extraction: {
      callerName,
      callbackNumber: '+15555550101',
      address: null,
      job: `job ${id}`,
      jobCategory: 'general',
      urgency,
      summary: 'summary',
      source: 'rules',
    },
    status: 'new',
    bookingToken: `tok-${id}`,
    textedAt: null,
    noTextReason: null,
    jobId: null,
    ...extra,
  };
}

function msg(id: string, urgency: Urgency = 'routine', extra: Partial<RemoteMessage> = {}): RemoteMessage {
  return { id, urgency, callerName: 'Priya Shah', job: `job ${id}`, transcript: `transcript of ${id}`, canText: true, ...extra };
}

interface Run {
  state: RemoteState;
  prompts: string[];
  effects: RemoteEffect[];
  steps: Step[];
}

function run(events: RemoteEvent[], from: RemoteState = startState(BUSINESS)): Run {
  let state = from;
  const out: Run = { state, prompts: [], effects: [], steps: [] };
  for (const e of events) {
    const s = step(state, e);
    state = s.state;
    out.prompts.push(...s.prompts.map((p) => p.text));
    out.effects.push(...s.effects);
    out.steps.push(s);
  }
  out.state = state;
  return out;
}

const key = (k: Key): RemoteEvent => ({ type: 'key', key: k });
const keys = (s: string): RemoteEvent[] => [...s].map((c) => key(c as Key));
const answered: RemoteEvent = { type: 'call-answered' };
const accepted = (messages: RemoteMessage[]): RemoteEvent => ({ type: 'code-checked', result: 'ok', messages });

/** A call that has entered the code and heard the first announcement. */
function inCall(messages: RemoteMessage[]): Run {
  return run([answered, ...keys('427'), accepted(messages)]);
}

describe('queue and prompts', () => {
  it('[RR 3.2] keeps only new messages that are not erased and not hang-ups', () => {
    const q = remoteQueue([
      source('a', 'routine', '2026-11-10T10:00:00Z'),
      source('b', 'routine', '2026-11-10T11:00:00Z', { status: 'heard' }),
      source('c', 'routine', '2026-11-10T12:00:00Z', { status: 'called-back' }),
      source('d', 'routine', '2026-11-10T13:00:00Z', { erasedAt: '2026-11-11T00:00:00Z' }),
      source('e', 'routine', '2026-11-10T14:00:00Z', { hangUp: true }),
    ]);
    expect(q.map((m) => m.id)).toEqual(['a']);
  });

  it('[RR 3.3] orders emergency, then soon, then routine, oldest first within each', () => {
    const q = remoteQueue([
      source('r1', 'routine', '2026-11-10T08:00:00Z'),
      source('s2', 'soon', '2026-11-10T12:00:00Z'),
      source('e2', 'emergency', '2026-11-10T11:00:00Z'),
      source('s1', 'soon', '2026-11-10T09:00:00Z'),
      source('e1', 'emergency', '2026-11-10T07:00:00Z'),
      source('r2', 'routine', '2026-11-10T09:30:00Z'),
    ]);
    expect(q.map((m) => m.id)).toEqual(['e1', 'e2', 's1', 's2', 'r1', 'r2']);
  });

  it('[RR 3.2] marks a message with no callback number or caller ID as not textable', () => {
    const noNumber = source('x', 'routine', '2026-11-10T08:00:00Z', { from: '' });
    noNumber.extraction.callbackNumber = null;
    expect(remoteQueue([noNumber])[0]?.canText).toBe(false);
    expect(remoteQueue([source('y', 'routine', '2026-11-10T08:00:00Z')])[0]?.canText).toBe(true);
  });

  it('[RR 9.2] every prompt is under 30 words', () => {
    const long = msg('long', 'emergency', {
      callerName: 'A very long caller name that goes on and on forever and ever',
      job: 'a job described in far too many words for any one prompt to hold without cutting it short',
    });
    const all = [
      run([answered, key('1'), key('*'), ...keys('4'), { type: 'silence' }]),
      run([answered, ...keys('111'), { type: 'code-checked', result: 'wrong' }]),
      run([answered, ...keys('111'), { type: 'code-checked', result: 'locked' }]),
      run([answered, ...keys('427'), accepted([long, msg('b', 'soon', { callerName: null })]), key('1'), key('2'), { type: 'text-result', outcome: 'sent' }, key('9'), key('9'), key('3'), key('#'), { type: 'invoice-heard', speech: 'dryer belt' }]),
      run([answered, ...keys('427'), accepted([long]), key('9'), key('5'), key('0'), key('*'), { type: 'silence' }, { type: 'effect-failed', effect: 'play-message' }, { type: 'text-result', outcome: 'refused' }]),
      run([answered, ...keys('427'), accepted([]), { type: 'invoice-heard', speech: '  ' }]),
    ];
    const prompts = all.flatMap((r) => r.prompts);
    expect(prompts.length).toBeGreaterThan(20);
    for (const text of prompts) expect(text.split(/\s+/).length, text).toBeLessThan(30);
  });

  it('[RR 10.2] every effect survives a JSON round trip', () => {
    const effects: RemoteEffect[] = [
      { type: 'verify-code', code: '427' },
      { type: 'play-message', messageId: 'm1', transcript: 'hello' },
      { type: 'mark-heard', messageId: 'm1' },
      { type: 'text-booking-link', messageId: 'm1' },
      { type: 'erase-message', messageId: 'm1' },
      { type: 'start-invoice' },
      { type: 'draft-invoice', speech: 'dryer belt fifteen' },
      { type: 'hang-up' },
    ];
    for (const e of effects) expect(JSON.parse(JSON.stringify(e))).toEqual(e);
    const r = run([answered, ...keys('427'), accepted([msg('a')]), key('1'), key('2'), key('9'), key('9'), { type: 'invoice-heard', speech: 'x' }]);
    for (const e of r.effects) expect(JSON.parse(JSON.stringify(e))).toEqual(e);
  });
});

describe('code phases', () => {
  it('[RR 1.1, 9.3] says it is the machine for the business and asks for the code', () => {
    const r = run([answered]);
    expect(r.prompts).toEqual([
      `This is the answering machine for ${BUSINESS}. Enter your three-digit remote code.`,
    ]);
    expect(r.state.phase).toBe('ask-code');
    expect(r.effects).toEqual([]);
  });

  it('[RR 1.2] checks the code at the third digit without a terminating key', () => {
    const r = run([answered, ...keys('42')]);
    expect(r.effects).toEqual([]);
    const done = run([key('7')], r.state);
    expect(done.effects).toEqual([{ type: 'verify-code', code: '427' }]);
    expect(done.state.phase).toBe('checking-code');
    expect(done.state.digits).toBe('');
  });

  it('[RR 1.3] star clears the digits and asks again', () => {
    const r = run([answered, ...keys('42*')]);
    expect(r.state.digits).toBe('');
    expect(r.prompts.at(-1)).toBe('Enter your three-digit remote code.');
    const after = run(keys('427'), r.state);
    expect(after.effects).toEqual([{ type: 'verify-code', code: '427' }]);
  });

  it('[RR 1.4] ignores pound while the code is asked', () => {
    const r = run([answered, key('4'), key('#'), key('2')]);
    expect(r.state.digits).toBe('42');
    expect(r.state.phase).toBe('ask-code');
    expect(r.effects).toEqual([]);
  });

  it('[RR 1.5] says a wrong code is wrong and asks again', () => {
    const r = run([answered, ...keys('111'), { type: 'code-checked', result: 'wrong' }]);
    expect(r.prompts.slice(-2)).toEqual(['That code is not right.', 'Enter your three-digit remote code.']);
    expect(r.state.phase).toBe('ask-code');
    expect(r.state.wrongCodes).toBe(1);
    expect(r.effects.filter((e) => e.type === 'hang-up')).toEqual([]);
  });

  it('[RR 1.6] the third wrong code says goodbye and hangs up with no message read', () => {
    const wrong: RemoteEvent[] = [...keys('111'), { type: 'code-checked', result: 'wrong' }];
    const r = run([answered, ...wrong, ...wrong, ...wrong]);
    expect(r.state.phase).toBe('ended');
    expect(r.effects.at(-1)).toEqual({ type: 'hang-up' });
    expect(r.prompts.at(-1)).toBe('Goodbye.');
    expect(r.prompts.join(' ')).not.toMatch(/message \d|new message/i);
  });

  it('[RR 1.7] asks once more after 10 seconds of silence, then hangs up', () => {
    const first = run([answered, { type: 'silence' }]);
    expect(first.prompts.at(-1)).toBe('Enter your three-digit remote code.');
    expect(first.state.phase).toBe('ask-code');
    expect(first.effects).toEqual([]);
    const second = run([{ type: 'silence' }], first.state);
    expect(second.state.phase).toBe('ended');
    expect(second.effects).toEqual([{ type: 'hang-up' }]);
  });

  it('[RR 1.7] a key resets the silence count', () => {
    const r = run([answered, { type: 'silence' }, key('4'), { type: 'silence' }]);
    expect(r.state.phase).toBe('ask-code');
  });

  it('[RR 1.8] no message data is in the state or any prompt before the code is accepted', () => {
    const r = run([answered, key('1'), { type: 'silence' }, ...keys('111'), { type: 'code-checked', result: 'wrong' }, key('4')]);
    expect(r.state.queue).toEqual([]);
    const text = JSON.stringify([r.prompts, r.state]);
    expect(text).not.toMatch(/Priya|job a|transcript|new message|Message \d/);
    // The code itself is not kept in state after it is handed over.
    const checking = run([answered, ...keys('427')]);
    expect(JSON.stringify(checking.state)).not.toContain('427');
  });

  it('[RR 2.5] a locked answer says so and hangs up', () => {
    const r = run([answered, ...keys('427'), { type: 'code-checked', result: 'locked' }]);
    expect(r.prompts.at(-1)).toBe('The machine is locked. Try again later.');
    expect(r.effects.at(-1)).toEqual({ type: 'hang-up' });
    expect(r.state.phase).toBe('ended');
  });

  it('[RR 9.1] no prompt claims a person or gives the machine a name', () => {
    const r = run([
      answered, ...keys('111'), { type: 'code-checked', result: 'wrong' }, ...keys('427'),
      accepted([msg('a', 'emergency', { callerName: null }), msg('b')]),
      key('1'), key('2'), { type: 'text-result', outcome: 'opted-out' }, key('9'), key('9'), key('5'), key('#'),
      { type: 'invoice-heard', speech: '' },
    ]);
    expect(r.prompts[0]).toContain('answering machine');
    for (const text of r.prompts) {
      expect(text).not.toMatch(/\b(I am|I'm|my name|human|person|receptionist|assistant)\b/i);
    }
  });
});

describe('announcements', () => {
  it('[RR 3.1] says the count with singular, plural and zero forms', () => {
    expect(inCall([msg('a')]).prompts).toContain('You have 1 new message.');
    expect(inCall([msg('a'), msg('b'), msg('c')]).prompts).toContain('You have 3 new messages.');
    expect(inCall([]).prompts).toContain('You have no new messages.');
  });

  it('[RR 3.4] announces position, urgency, caller name and job', () => {
    const r = inCall([
      msg('a', 'emergency', { job: 'Burst water heater' }),
      msg('b', 'soon', { callerName: null, job: 'Dryer repair' }),
      msg('c', 'routine', { job: 'Faucet drip' }),
    ]);
    expect(r.prompts).toContain('Message 1 of 3. Emergency. From Priya Shah. Burst water heater.');
    const second = run([key('#')], r.state);
    expect(second.prompts[0]).toBe('Message 2 of 3. Soon. From an unknown caller. Dryer repair.');
    const third = run([key('#')], second.state);
    expect(third.prompts[0]).toBe('Message 3 of 3. From Priya Shah. Faucet drip.');
  });

  it('[RR 3.5] says the keys after each announcement', () => {
    const r = inCall([msg('a')]);
    expect(r.prompts.slice(-2)[1]).toBe('Press 1 to play, 2 to text back, 9 to erase, pound for next.');
    expect(r.state.phase).toBe('message');
  });

  it('[RR 3.6, 8.1] with no new messages goes straight to the invoice prompt and beep', () => {
    const r = inCall([]);
    expect(r.prompts.slice(-2)).toEqual(['You have no new messages.', 'After the beep, say your invoice.']);
    expect(r.effects.at(-1)).toEqual({ type: 'start-invoice' });
    expect(r.state.phase).toBe('ask-invoice');
  });

  it('[RR 3.7] star repeats the announcement and the keys without any effect', () => {
    const r = inCall([msg('a', 'emergency')]);
    const again = run([key('*')], r.state);
    expect(again.prompts).toEqual(r.prompts.slice(-2));
    expect(again.effects).toEqual([]);
    expect(again.state.index).toBe(0);
  });
});

describe('play, skip and stray keys', () => {
  it('[RR 4.1, 4.4] key 1 plays the transcript, marks it heard and says the keys again', () => {
    const r = inCall([msg('a')]);
    const played = run([key('1')], r.state);
    expect(played.effects).toEqual([
      { type: 'play-message', messageId: 'a', transcript: 'transcript of a' },
      { type: 'mark-heard', messageId: 'a' },
    ]);
    expect(played.prompts).toEqual(['Press 1 to play, 2 to text back, 9 to erase, pound for next.']);
    expect(played.state.index).toBe(0);
  });

  it('[RR 4.2] announcing a message emits no play or mark-heard effect', () => {
    const r = inCall([msg('a'), msg('b')]);
    const effects = [...r.effects, ...run([key('#')], r.state).effects];
    expect(effects.filter((e) => e.type === 'play-message' || e.type === 'mark-heard')).toEqual([]);
  });

  it('[RR 7.1] pound moves to the next message and changes no status', () => {
    const r = inCall([msg('a'), msg('b')]);
    const next = run([key('#')], r.state);
    expect(next.state.index).toBe(1);
    expect(next.effects).toEqual([]);
    expect(next.prompts[0]).toMatch(/^Message 2 of 2\./);
  });

  it('[RR 7.2, 8.1] pound on the last message asks for the invoice', () => {
    const r = inCall([msg('a')]);
    const next = run([key('#')], r.state);
    expect(next.state.phase).toBe('ask-invoice');
    expect(next.prompts).toEqual(['After the beep, say your invoice.']);
    expect(next.effects).toEqual([{ type: 'start-invoice' }]);
  });

  it('[RR 7.3] a key with no meaning is said so, with the keys again and no effect', () => {
    const r = inCall([msg('a')]);
    for (const k of ['0', '3', '4', '5', '6', '7', '8'] as Key[]) {
      const out = run([key(k)], r.state);
      expect(out.prompts).toEqual([
        'That key does nothing here.',
        'Press 1 to play, 2 to text back, 9 to erase, pound for next.',
      ]);
      expect(out.effects).toEqual([]);
      expect(out.state.index).toBe(0);
    }
  });

  it('[RR 7.4] silence repeats the keys once, then says goodbye and hangs up', () => {
    const r = inCall([msg('a')]);
    const first = run([{ type: 'silence' }], r.state);
    expect(first.prompts).toEqual(['Press 1 to play, 2 to text back, 9 to erase, pound for next.']);
    expect(first.effects).toEqual([]);
    const second = run([{ type: 'silence' }], first.state);
    expect(second.prompts).toEqual(['Goodbye.']);
    expect(second.effects).toEqual([{ type: 'hang-up' }]);
    expect(second.state.phase).toBe('ended');
    expect(second.effects.some((e) => e.type === 'erase-message' || e.type === 'text-booking-link')).toBe(false);
  });

  it('[RR 7.4] a key between silences resets the count', () => {
    const r = inCall([msg('a')]);
    const out = run([{ type: 'silence' }, key('0'), { type: 'silence' }], r.state);
    expect(out.state.phase).toBe('message');
  });
});

describe('texting', () => {
  it('[RR 5.1, 5.2] key 2 texts the current message only', () => {
    const r = inCall([msg('a'), msg('b')]);
    const first = run([key('2')], r.state);
    expect(first.effects).toEqual([{ type: 'text-booking-link', messageId: 'a' }]);
    const skipped = run([{ type: 'text-result', outcome: 'sent' }, key('#'), key('2')], first.state);
    expect(skipped.effects).toEqual([{ type: 'text-booking-link', messageId: 'b' }]);
  });

  it('[RR 5.7] a sent text says so, stays on the message and says the keys', () => {
    const r = run([key('2'), { type: 'text-result', outcome: 'sent' }], inCall([msg('a'), msg('b')]).state);
    expect(r.prompts).toEqual([
      'Booking link texted.',
      'Press 1 to play, 2 to text back, 9 to erase, pound for next.',
    ]);
    expect(r.state.index).toBe(0);
    expect(r.state.phase).toBe('message');
  });

  it('[RR 5.3] an opted-out number is said so', () => {
    const r = run([key('2'), { type: 'text-result', outcome: 'opted-out' }], inCall([msg('a')]).state);
    expect(r.prompts[0]).toBe('That caller asked not to be texted.');
  });

  it('[RR 5.4] a number texted a moment ago is said so', () => {
    const r = run([key('2'), { type: 'text-result', outcome: 'texted-recently' }], inCall([msg('a')]).state);
    expect(r.prompts[0]).toBe('That caller was texted a moment ago.');
  });

  it('[RR 5.5] a message with no number sends nothing and says so', () => {
    const r = run([key('2')], inCall([msg('a', 'routine', { canText: false })]).state);
    expect(r.effects).toEqual([]);
    expect(r.prompts[0]).toBe('There is no number to text.');
    const server = run([key('2'), { type: 'text-result', outcome: 'no-number' }], inCall([msg('a')]).state);
    expect(server.prompts[0]).toBe('There is no number to text.');
  });

  it('[RR 5.6] a refused text is said so and the message stays', () => {
    for (const outcome of ['refused', 'failed'] as const) {
      const r = run([key('2'), { type: 'text-result', outcome }], inCall([msg('a')]).state);
      expect(r.prompts[0]).toBe('The text did not go out.');
      expect(r.state.index).toBe(0);
      expect(r.state.phase).toBe('message');
    }
  });

  it('[RR 10.6] no second effect while a text is pending', () => {
    const r = run([key('2'), key('2'), key('2'), key('9'), key('#'), { type: 'silence' }], inCall([msg('a'), msg('b')]).state);
    expect(r.effects).toEqual([{ type: 'text-booking-link', messageId: 'a' }]);
    expect(r.state.pending).toBe('text');
    expect(r.state.index).toBe(0);
    const done = run([{ type: 'text-result', outcome: 'sent' }, key('2')], r.state);
    expect(done.effects).toEqual([{ type: 'text-booking-link', messageId: 'a' }]);
  });

  it('[RR 10.4] a text result with no text pending changes nothing', () => {
    const r = inCall([msg('a')]);
    const out = step(r.state, { type: 'text-result', outcome: 'sent' });
    expect(out.state).toBe(r.state);
    expect(out.prompts).toEqual([]);
    expect(out.effects).toEqual([]);
  });
});

describe('erasing', () => {
  it('[RR 6.1] key 9 asks to press 9 again and emits nothing', () => {
    const r = run([key('9')], inCall([msg('a')]).state);
    expect(r.prompts).toEqual(['Press 9 again to erase it. Any other key keeps it.']);
    expect(r.effects).toEqual([]);
    expect(r.state.phase).toBe('confirm-erase');
  });

  it('[RR 6.2] a second 9 erases the message once and moves to the next', () => {
    const r = run([key('9'), key('9')], inCall([msg('a'), msg('b')]).state);
    expect(r.effects).toEqual([{ type: 'erase-message', messageId: 'a' }]);
    expect(r.prompts[1]).toBe('Erased.');
    expect(r.prompts[2]).toMatch(/^Message 2 of 2\./);
    expect(r.state.index).toBe(1);
    expect(r.state.phase).toBe('message');
  });

  it('[RR 6.2, 8.1] erasing the last message asks for the invoice', () => {
    const r = run([key('9'), key('9')], inCall([msg('a')]).state);
    expect(r.effects).toEqual([
      { type: 'erase-message', messageId: 'a' },
      { type: 'start-invoice' },
    ]);
    expect(r.prompts.slice(1)).toEqual(['Erased.', 'After the beep, say your invoice.']);
    expect(r.state.phase).toBe('ask-invoice');
  });

  it('[RR 6.3] any other key keeps the message and says the keys', () => {
    for (const k of ['1', '2', '5', '#', '*', '0'] as Key[]) {
      const r = run([key('9'), key(k)], inCall([msg('a'), msg('b')]).state);
      expect(r.effects).toEqual([]);
      expect(r.prompts.slice(1)).toEqual(['Kept.', 'Press 1 to play, 2 to text back, 9 to erase, pound for next.']);
      expect(r.state.phase).toBe('message');
      expect(r.state.index).toBe(0);
    }
  });

  it('[RR 6.1, 7.4] silence after the question never erases', () => {
    const r = run([key('9'), { type: 'silence' }, { type: 'silence' }], inCall([msg('a')]).state);
    expect(r.effects).toEqual([{ type: 'hang-up' }]);
    expect(r.state.phase).toBe('ended');
  });
});

describe('invoice and failures', () => {
  const atInvoice = () => inCall([]).state;

  it('[RR 8.1] the invoice prompt comes with a beep effect', () => {
    const r = inCall([msg('a')]);
    const out = run([key('#')], r.state);
    expect(out.prompts).toContain('After the beep, say your invoice.');
    expect(out.effects).toContainEqual({ type: 'start-invoice' });
  });

  it('[RR 8.4] spoken words become a draft, with the draft prompt, then hang up', () => {
    const r = run([{ type: 'invoice-heard', speech: ' dryer belt fifteen taxed ' }], atInvoice());
    expect(r.effects).toEqual([
      { type: 'draft-invoice', speech: 'dryer belt fifteen taxed' },
      { type: 'hang-up' },
    ]);
    expect(r.prompts).toEqual(['Got it. Your invoice is a draft. Nothing goes out until you approve the total.']);
    expect(r.state.phase).toBe('ended');
  });

  it('[RR 8.5] empty words make no draft', () => {
    const r = run([{ type: 'invoice-heard', speech: '   ' }], atInvoice());
    expect(r.effects).toEqual([{ type: 'hang-up' }]);
    expect(r.prompts[0]).toBe('No invoice heard.');
    expect(r.state.phase).toBe('ended');
  });

  it('[RR 8.3] the script has no effect that sends an invoice', () => {
    const r = run([{ type: 'invoice-heard', speech: 'dryer belt fifteen' }], atInvoice());
    expect(r.effects.map((e) => e.type)).toEqual(['draft-invoice', 'hang-up']);
  });

  it('[RR 8.6] no prompt says an amount', () => {
    const r = run([
      answered, ...keys('427'),
      accepted([msg('a', 'routine', { job: 'dryer belt' })]),
      key('1'), key('#'), { type: 'invoice-heard', speech: 'dryer belt fifteen taxed, two hours labor at eighty-five' },
    ]);
    for (const text of r.prompts) expect(text).not.toMatch(/\$|\btotal of\b|\bdollar|\bcents?\b|\d+\.\d\d/i);
  });

  it('[RR 12.8] a failed effect on a message says so, keeps the message and says the keys', () => {
    const r = run([key('1'), { type: 'effect-failed', effect: 'play-message' }], inCall([msg('a'), msg('b')]).state);
    expect(r.prompts.slice(-2)).toEqual([
      'Something went wrong.',
      'Press 1 to play, 2 to text back, 9 to erase, pound for next.',
    ]);
    expect(r.state.index).toBe(0);
    expect(r.state.phase).toBe('message');
  });

  it('[RR 12.8] a failed text clears the pending text so the owner can try again', () => {
    const r = run([key('2'), { type: 'effect-failed', effect: 'text-booking-link' }, key('2')], inCall([msg('a')]).state);
    expect(r.effects).toEqual([
      { type: 'text-booking-link', messageId: 'a' },
      { type: 'text-booking-link', messageId: 'a' },
    ]);
  });

  it('[RR 12.8] a failed erase keeps the message', () => {
    const r = run([key('9'), key('#'), key('9'), { type: 'effect-failed', effect: 'erase-message' }], inCall([msg('a')]).state);
    expect(r.state.phase).toBe('message');
    expect(r.state.index).toBe(0);
  });

  it('[RR 12.8] a failed code check asks for the code again', () => {
    const r = run([answered, ...keys('427'), { type: 'effect-failed', effect: 'verify-code' }]);
    expect(r.prompts.slice(-2)).toEqual(['Something went wrong.', 'Enter your three-digit remote code.']);
    expect(r.state.phase).toBe('ask-code');
  });
});

describe('a pure script', () => {
  it('[RR 10.4] an event that makes no sense leaves the state unchanged with no effect', () => {
    const cases: Array<[RemoteState, RemoteEvent]> = [
      [startState(BUSINESS), key('1')],
      [startState(BUSINESS), { type: 'silence' }],
      [run([answered]).state, { type: 'invoice-heard', speech: 'x' }],
      [run([answered]).state, { type: 'text-result', outcome: 'sent' }],
      [run([answered, ...keys('427')]).state, key('1')],
      [run([answered, ...keys('427')]).state, { type: 'silence' }],
      [inCall([msg('a')]).state, { type: 'call-answered' }],
      [inCall([msg('a')]).state, { type: 'invoice-heard', speech: 'x' }],
      [inCall([]).state, key('1')],
      [inCall([]).state, { type: 'silence' }],
    ];
    for (const [state, event] of cases) {
      const out = step(state, event);
      expect(out.state).toEqual(state);
      expect(out.prompts).toEqual([]);
      expect(out.effects).toEqual([]);
    }
  });

  it('[RR 10.5] a call that has ended ignores every later event', () => {
    const ended = run([answered, { type: 'silence' }, { type: 'silence' }]).state;
    expect(ended.phase).toBe('ended');
    const events: RemoteEvent[] = [
      answered, key('1'), key('9'), key('2'), { type: 'silence' }, accepted([msg('a')]),
      { type: 'text-result', outcome: 'sent' }, { type: 'invoice-heard', speech: 'x' },
      { type: 'effect-failed', effect: 'hang-up' }, { type: 'hung-up' },
    ];
    for (const e of events) {
      const out = step(ended, e);
      expect(out.state).toBe(ended);
      expect(out.prompts).toEqual([]);
      expect(out.effects).toEqual([]);
    }
  });

  it('[RR 10.5] the owner hanging up ends the call quietly from any phase', () => {
    const out = run([{ type: 'hung-up' }], inCall([msg('a')]).state);
    expect(out.state.phase).toBe('ended');
    expect(out.prompts).toEqual([]);
    expect(out.effects).toEqual([]);
  });

  it('[RR 10.1] the same state and event always give the same step, and the input is not changed', () => {
    const state = inCall([msg('a'), msg('b')]).state;
    const before = JSON.stringify(state);
    const a = step(state, key('9'));
    const b = step(state, key('9'));
    expect(a).toEqual(b);
    expect(JSON.stringify(state)).toBe(before);
  });

  it('[RR 10.3] a step reads no clock and draws no random number', () => {
    const now = vi.spyOn(Date, 'now');
    const random = vi.spyOn(Math, 'random');
    try {
      run([answered, ...keys('427'), accepted([msg('a')]), key('1'), key('2'), { type: 'text-result', outcome: 'sent' }, key('#'), { type: 'invoice-heard', speech: 'x' }]);
      expect(now).not.toHaveBeenCalled();
      expect(random).not.toHaveBeenCalled();
    } finally {
      now.mockRestore();
      random.mockRestore();
    }
  });
});

/** A small seeded generator (mulberry32), so the random run is the same every time. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ALL_KEYS: Key[] = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '#'];

function randomEvents(seed: number, count: number): RemoteEvent[] {
  const rnd = seeded(seed);
  const pick = <T,>(items: readonly T[]): T => items[Math.floor(rnd() * items.length)] as T;
  const events: RemoteEvent[] = [];
  for (let i = 0; i < count; i++) {
    const roll = rnd();
    if (roll < 0.55) events.push({ type: 'key', key: pick(ALL_KEYS) });
    else if (roll < 0.65) events.push({ type: 'silence' });
    else if (roll < 0.72) events.push({ type: 'call-answered' });
    else if (roll < 0.8) {
      const n = Math.floor(rnd() * 4);
      const messages = Array.from({ length: n }, (_, j) =>
        msg(`m${i}-${j}`, pick(['emergency', 'soon', 'routine'] as const), { canText: rnd() < 0.8 }),
      );
      events.push(rnd() < 0.7 ? accepted(messages) : { type: 'code-checked', result: pick(['wrong', 'locked'] as const) });
    } else if (roll < 0.88) {
      events.push({ type: 'text-result', outcome: pick(['sent', 'opted-out', 'texted-recently', 'no-number', 'refused', 'failed'] as const) });
    } else if (roll < 0.93) {
      events.push({ type: 'effect-failed', effect: pick(['verify-code', 'play-message', 'mark-heard', 'text-booking-link', 'erase-message', 'start-invoice', 'draft-invoice', 'hang-up'] as const) });
    } else if (roll < 0.98) {
      events.push({ type: 'invoice-heard', speech: pick(['', '  ', 'dryer belt fifteen', 'two hours labor']) });
    } else events.push({ type: 'hung-up' });
  }
  return events;
}

describe('seeded random-key run', () => {
  const SEEDS = [1, 7, 42, 2026, 31337, 99991, 123456, 7777777];

  it('[RR 10.1, 10.3, 10.5] never throws, never emits after the call ended, and repeats exactly', () => {
    let steps = 0;
    let calls = 0;
    for (const seed of SEEDS) {
      const events = randomEvents(seed, 600);
      const trace = (): string => {
        let state = startState(BUSINESS);
        const out: Step[] = [];
        for (const e of events) {
          const before = state;
          const s = step(state, e);
          steps++;
          if (before.phase === 'ended') {
            expect(s.state).toBe(before);
            expect(s.prompts).toEqual([]);
            expect(s.effects).toEqual([]);
          }
          if (before.phase !== 'ended' && s.state.phase === 'ended') calls++;
          expect(s.effects.filter((x) => x.type === 'text-booking-link' || x.type === 'erase-message').length).toBeLessThanOrEqual(1);
          for (const eff of s.effects) expect(JSON.parse(JSON.stringify(eff))).toEqual(eff);
          for (const pr of s.prompts) expect(pr.text.split(/\s+/).length).toBeLessThan(30);
          state = s.state;
          out.push(s);
        }
        return JSON.stringify(out);
      };
      expect(trace()).toBe(trace());
    }
    expect(steps).toBe(SEEDS.length * 600 * 2);
    expect(calls).toBeGreaterThan(0);
  });

  it('[RR 10.1, 10.5] a long run of random keys in a live call does not throw or emit after the end', () => {
    for (const seed of SEEDS) {
      let state = inCall([msg('a', 'emergency'), msg('b', 'soon'), msg('c')]).state;
      const rnd = seeded(seed);
      let ended = false;
      for (let i = 0; i < 400; i++) {
        const event: RemoteEvent =
          rnd() < 0.9 ? { type: 'key', key: ALL_KEYS[Math.floor(rnd() * ALL_KEYS.length)] as Key } : { type: 'silence' };
        const s = step(state, event);
        if (ended) expect(s.effects).toEqual([]);
        if (s.state.phase === 'ended') ended = true;
        state = s.state;
      }
    }
  });
});
