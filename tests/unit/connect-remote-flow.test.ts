import { readFileSync } from 'node:fs';
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
    expect(conditions.map((c) => c.Condition.Operator)).toEqual(['Equals', 'Equals', 'Equals', 'Equals']);
    expect(conditions.map((c) => c.Condition.Operands)).toEqual([['1'], ['2'], ['9'], ['#']]);
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
