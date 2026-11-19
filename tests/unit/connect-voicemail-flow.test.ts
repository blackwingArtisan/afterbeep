import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

interface Action {
  Identifier: string;
  Type: string;
  Parameters: Record<string, any>;
  Transitions: {
    NextAction?: string;
    Conditions?: { NextAction: string; Condition: { Operator: string; Operands: string[] } }[];
    Errors?: { NextAction: string; ErrorType: string }[];
  };
}

const raw = readFileSync('infra/connect/contact-flow.json', 'utf8');
const flow = JSON.parse(raw) as { Version: string; StartAction: string; Actions: Action[] };
const ids = flow.Actions.map((a) => a.Identifier);
const get = (id: string): Action => flow.Actions.find((a) => a.Identifier === id)!;
const targets = (a: Action): string[] => [
  ...(a.Transitions.NextAction ? [a.Transitions.NextAction] : []),
  ...(a.Transitions.Conditions ?? []).map((c) => c.NextAction),
  ...(a.Transitions.Errors ?? []).map((e) => e.NextAction),
];

// The voicemail actions as they were before the owner check was added.
const oldActions = ['save-caller', 'record', 'greeting', 'listen', 'goodbye', 'hang-up'];

describe('voicemail Connect flow with the owner check', () => {
  it('[RR 15.2] parses with unique identifiers and no dangling transition', () => {
    expect(flow.Version).toBe('2019-10-30');
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain(flow.StartAction);
    for (const a of flow.Actions) for (const t of targets(a)) expect(ids, `${a.Identifier} -> ${t}`).toContain(t);
  });

  it('[RR 15.2] starts at check-owner, which compares the caller before save-caller and record', () => {
    expect(flow.StartAction).toBe('check-owner');
    const check = get('check-owner');
    expect(check.Type).toBe('Compare');
    expect(check.Parameters.ComparisonValue).toBe('$.CustomerEndpoint.Address');
    expect(ids.indexOf('check-owner')).toBeLessThan(ids.indexOf('save-caller'));
    expect(ids.indexOf('check-owner')).toBeLessThan(ids.indexOf('record'));
  });

  it('[RR 15.2, 15.4] has one Equals condition on the owner placeholder and a transfer to the flow placeholder', () => {
    const conditions = get('check-owner').Transitions.Conditions ?? [];
    expect(conditions).toHaveLength(1);
    expect(conditions[0]?.Condition).toEqual({ Operator: 'Equals', Operands: ['REPLACE_WITH_OWNER_NUMBER'] });
    expect(conditions[0]?.NextAction).toBe('to-remote');
    const transfer = get('to-remote');
    expect(transfer.Type).toBe('TransferToFlow');
    expect(transfer.Parameters.ContactFlowId).toBe('REPLACE_WITH_REMOTE_FLOW_ID');
  });

  it('[RR 15.3] sends a different caller, a failed compare and a failed transfer to save-caller', () => {
    const check = get('check-owner').Transitions;
    expect(check.NextAction).toBe('save-caller');
    expect(check.Errors).toEqual([{ NextAction: 'save-caller', ErrorType: 'NoMatchingCondition' }]);
    expect(get('to-remote').Transitions.Errors).toEqual([{ NextAction: 'save-caller', ErrorType: 'NoMatchingError' }]);
    expect(get('to-remote').Transitions.NextAction).toBeUndefined();
  });

  it('[RR 15.3] leaves every old action as it was', () => {
    expect(ids.filter((i) => oldActions.includes(i))).toEqual(oldActions);
    expect(get('save-caller')).toEqual({
      Identifier: 'save-caller',
      Type: 'UpdateContactAttributes',
      Parameters: { Attributes: { afterbeepCaller: '$.CustomerEndpoint.Address' }, TargetContact: 'Current' },
      Transitions: { NextAction: 'record', Errors: [{ NextAction: 'record', ErrorType: 'NoMatchingError' }] },
    });
    expect(get('record')).toEqual({
      Identifier: 'record',
      Type: 'UpdateContactRecordingBehavior',
      Parameters: { RecordingBehavior: { RecordedParticipants: ['Customer'] } },
      Transitions: { NextAction: 'greeting' },
    });
    expect(get('greeting').Transitions.NextAction).toBe('listen');
    expect(get('listen').Parameters).toEqual({ Text: ' ', InputTimeLimitSeconds: '120', StoreInput: 'False' });
    expect(get('listen').Transitions.NextAction).toBe('goodbye');
    expect(get('goodbye').Transitions.NextAction).toBe('hang-up');
    expect(get('hang-up').Transitions).toEqual({});
  });

  it('[RR 15.1, 15.3] reaches save-caller on every path except the transfer, and records only after it', () => {
    const seen = new Set<string>();
    const walk = (id: string): void => {
      if (seen.has(id) || id === 'to-remote') return;
      seen.add(id);
      for (const t of targets(get(id))) walk(t);
    };
    walk(flow.StartAction);
    expect(seen.has('save-caller')).toBe(true);
    // The only way to the recording is through save-caller.
    const toRecord = flow.Actions.filter((a) => targets(a).includes('record')).map((a) => a.Identifier);
    expect(toRecord).toEqual(['save-caller']);
    // A transfer never reaches record in this flow: it has no transition of its own except the error.
    expect(get('to-remote').Transitions.NextAction).toBeUndefined();
  });

  it('[RR 15.4, 15.6] holds no phone number and no flow id', () => {
    expect(raw).not.toMatch(/\+\d/);
    expect(raw).not.toMatch(/555/);
    expect(raw).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    expect(raw).not.toMatch(/arn:aws/);
  });

  it('[RR 15.6] has no recording action before the transfer decision', () => {
    const recordingBeforeCheck = flow.Actions.slice(0, ids.indexOf('to-remote') + 1).filter(
      (a) => a.Type === 'UpdateContactRecordingBehavior',
    );
    expect(recordingBeforeCheck).toEqual([]);
  });
});
