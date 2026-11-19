import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { demoBusiness } from '../../src/server/seed';

interface Condition { NextAction: string; Condition: { Operator: string; Operands: string[] } }
interface Action {
  Identifier: string;
  Type: string;
  Parameters: Record<string, any>;
  Transitions: { NextAction?: string; Conditions?: Condition[]; Errors?: { NextAction: string; ErrorType: string }[] };
}

const raw = readFileSync('infra/connect/remote-retrieval-flow.json', 'utf8');
const flow = JSON.parse(raw) as { Version: string; StartAction: string; Actions: Action[] };
const ids = flow.Actions.map((a) => a.Identifier);
const inputs = flow.Actions.filter((a) => a.Type === 'GetParticipantInput');
const targets = (a: Action): string[] => [
  ...(a.Transitions.NextAction ? [a.Transitions.NextAction] : []),
  ...(a.Transitions.Conditions ?? []).map((c) => c.NextAction),
  ...(a.Transitions.Errors ?? []).map((e) => e.NextAction),
];

describe('remote retrieval Connect flow', () => {
  it('[RR 13.1] has a version, a start action that exists and unique identifiers', () => {
    expect(flow.Version).toBe('2019-10-30');
    expect(ids).toContain(flow.StartAction);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('[RR 13.1] has no transition to an action that does not exist', () => {
    for (const a of flow.Actions) for (const t of targets(a)) expect(ids, `${a.Identifier} -> ${t}`).toContain(t);
  });

  it('[RR 13.1] ends every path in a terminating action with empty transitions', () => {
    const ends = flow.Actions.filter((a) => a.Type === 'DisconnectParticipant');
    expect(ends.length).toBeGreaterThan(0);
    for (const a of ends) expect(a.Transitions).toEqual({});
  });

  it('[RR 13.2] asks for the code with stored input, three digits and an inter-digit limit', () => {
    const start = flow.Actions.find((a) => a.Identifier === flow.StartAction)!;
    expect(start.Type).toBe('GetParticipantInput');
    expect(start.Parameters.StoreInput).toBe('True');
    expect(start.Parameters.InputValidation.CustomValidation.MaximumLength).toBe('3');
    const gap = Number(start.Parameters.DTMFConfiguration.InterdigitTimeLimitSeconds);
    expect(gap).toBeGreaterThanOrEqual(1);
    expect(gap).toBeLessThanOrEqual(20);
    expect(start.Transitions.Conditions ?? []).toEqual([]);
  });

  it('[RR 13.3] reads keys 1, 2, 9 and # with one Equals condition each', () => {
    const menu = flow.Actions.find((a) => a.Identifier === 'menu')!;
    expect(menu.Parameters.StoreInput).toBe('False');
    const conditions = menu.Transitions.Conditions ?? [];
    expect(conditions.every((c) => c.Condition.Operator === 'Equals')).toBe(true);
    // `*` was added for the phone path (16.4); 1, 2, 9 and # keep one condition each.
    expect(conditions.map((c) => c.Condition.Operands)).toEqual([['1'], ['2'], ['9'], ['#'], ['*']]);
  });

  it('[RR 13.4] gives every keypad input a no-matching-error and a timeout transition', () => {
    for (const a of inputs) {
      const types = (a.Transitions.Errors ?? []).map((e) => e.ErrorType);
      expect(types, a.Identifier).toContain('NoMatchingError');
      expect(types, a.Identifier).toContain('InputTimeLimitExceeded');
    }
  });

  it('[RR 13.4] gives every input that uses conditions or stores nothing a no-matching-condition transition', () => {
    for (const a of inputs.filter((i) => i.Parameters.StoreInput === 'False')) {
      expect((a.Transitions.Errors ?? []).map((e) => e.ErrorType), a.Identifier).toContain('NoMatchingCondition');
    }
    for (const a of inputs.filter((i) => i.Parameters.StoreInput === 'True')) {
      expect((a.Transitions.Errors ?? []).map((e) => e.ErrorType), a.Identifier).not.toContain('NoMatchingCondition');
    }
  });

  it('[RR 13.5] keeps the remote code out of the flow and hands the keyed digits to a Lambda', () => {
    expect(raw).not.toContain(demoBusiness.remoteCode);
    expect(raw).not.toContain('427');
    const turn = flow.Actions.find((a) => a.Identifier === 'turn-code')!;
    expect(turn.Type).toBe('InvokeLambdaFunction');
    expect(turn.Parameters.LambdaInvocationAttributes.digits).toBe('$.StoredCustomerInput');
    for (const a of flow.Actions.filter((x) => x.Type === 'InvokeLambdaFunction')) {
      expect(Number(a.Parameters.InvocationTimeLimitSeconds), a.Identifier).toBeLessThanOrEqual(8);
      expect(a.Parameters.ResponseValidation.ResponseType).toBe('STRING_MAP');
      expect((a.Transitions.Errors ?? []).map((e) => e.ErrorType)).toContain('NoMatchingError');
    }
  });

  it('[RR 13.6] says in the Connect README that the flow is written and checked but not deployed', () => {
    const readme = readFileSync('infra/connect/README.md', 'utf8');
    expect(readme).toContain('remote-retrieval-flow.json');
    expect(readme).toMatch(/written and checked but not deployed/i);
  });
});

describe('remote retrieval Connect flow, phone path', () => {
  const get = (id: string): Action => flow.Actions.find((a) => a.Identifier === id)!;
  const turns = flow.Actions.filter((a) => a.Identifier.startsWith('turn-'));

  it('[RR 16.1] sends all nine turn actions to save-state and save-state to route', () => {
    expect(turns.map((a) => a.Identifier).sort()).toEqual(
      ['turn-1', 'turn-2', 'turn-9', 'turn-code', 'turn-invoice', 'turn-other', 'turn-pound', 'turn-silence', 'turn-star'].sort(),
    );
    for (const a of turns) expect(a.Transitions.NextAction, a.Identifier).toBe('save-state');
    const save = get('save-state');
    expect(save.Type).toBe('UpdateContactAttributes');
    expect(save.Parameters.Attributes).toEqual({ remoteState: '$.External.state' });
    expect(save.Parameters.TargetContact).toBe('Current');
    expect(save.Transitions.NextAction).toBe('route');
  });

  it('[RR 16.2] sends a save-state failure to went-wrong', () => {
    expect(get('save-state').Transitions.Errors).toEqual([{ NextAction: 'went-wrong', ErrorType: 'NoMatchingError' }]);
    expect(get('went-wrong').Transitions.NextAction).toBe('hang-up');
  });

  it('[RR 16.4] reads 1, 2, 9, # and * on the menu and sends * in its own turn', () => {
    const conditions = get('menu').Transitions.Conditions ?? [];
    expect(conditions.map((c) => c.Condition.Operator)).toEqual(Array(5).fill('Equals'));
    expect(conditions.map((c) => c.Condition.Operands[0]).sort()).toEqual(['#', '*', '1', '2', '9']);
    const star = conditions.find((c) => c.Condition.Operands[0] === '*')!;
    expect(star.NextAction).toBe('turn-star');
    expect(get('turn-star').Parameters.LambdaInvocationAttributes.key).toBe('*');
  });

  it('[RR 16.5] keeps every turn at the 8-second limit and the flow free of the code', () => {
    for (const a of turns) expect(Number(a.Parameters.InvocationTimeLimitSeconds)).toBeLessThanOrEqual(8);
    expect(raw).not.toContain('427');
  });

  it('[RR 16.3] asks for the code again when the answer is code', () => {
    const cond = (get('route').Transitions.Conditions ?? []).find((c) => c.Condition.Operands[0] === 'code')!;
    expect(cond.Condition.Operator).toBe('Equals');
    expect(cond.NextAction).toBe('ask-code-again');
    const ask = get('ask-code-again');
    expect(ask.Type).toBe('GetParticipantInput');
    expect(ask.Parameters.Text).toBe('$.External.prompt');
    expect(ask.Parameters.StoreInput).toBe('True');
    expect(ask.Parameters.InputValidation.CustomValidation.MaximumLength).toBe('3');
    expect(Number(ask.Parameters.DTMFConfiguration.InterdigitTimeLimitSeconds)).toBeGreaterThanOrEqual(1);
    expect(Number(ask.Parameters.InputTimeLimitSeconds)).toBe(10);
    const errors = ask.Transitions.Errors ?? [];
    expect(errors.map((e) => e.ErrorType)).toEqual(expect.arrayContaining(['InputTimeLimitExceeded', 'NoMatchingError']));
    expect(ask.Transitions.NextAction).toBe('turn-code');
  });

  it('[RR 16.5] holds the remote code in neither flow file', () => {
    expect(readFileSync('infra/connect/contact-flow.json', 'utf8')).not.toContain('427');
    expect(raw).not.toContain('427');
  });
});

describe('Connect README', () => {
  const readme = readFileSync('infra/connect/README.md', 'utf8');

  it('[RR 16.6] records the caller-ID-plus-code decision with no second number', () => {
    expect(readme).toMatch(/caller ID/i);
    expect(readme).toMatch(/3-digit code/);
    expect(readme).toMatch(/no second number/i);
    expect(readme).toMatch(/caller ID only routes the call/i);
    expect(readme).not.toContain('not decided yet');
  });

  it('[RR 16.7, 13.6] says the Lambda is not deployed, neither flow is imported and names the placeholders', () => {
    expect(readme).toMatch(/written and tested with mocks but not deployed/i);
    expect(readme).toMatch(/Neither flow has been imported/i);
    for (const p of ['REPLACE_WITH_OWNER_NUMBER', 'REPLACE_WITH_REMOTE_FLOW_ID', 'REPLACE_WITH_REMOTE_TURN_LAMBDA_ARN']) {
      expect(readme).toContain(p);
    }
    expect(readme).toMatch(/written and checked but not deployed/i);
  });

  it('[RR 15.7] says the remote flow must be an inbound flow', () => {
    expect(readme).toMatch(/remote flow must be an inbound flow/i);
  });
});

describe('Connect folder hygiene', () => {
  it('[RR 16.8, 15.4] holds no phone number, webhook secret or real ARN', () => {
    for (const f of readdirSync('infra/connect')) {
      const text = readFileSync(`infra/connect/${f}`, 'utf8');
      expect(text, f).not.toMatch(/\+\d{7,}/);
      expect(text, f).not.toMatch(/\b\d{3}[-. ]\d{3}[-. ]\d{4}\b/);
      expect(text, f).not.toMatch(/arn:aws[a-z-]*:[a-z0-9-]*:[a-z0-9-]*:\d{12}:/);
      expect(text, f).not.toMatch(/(secret|token)\s*[:=]\s*['"][A-Za-z0-9]{16,}['"]/i);
    }
  });
});
