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

  it('[RR 15.2] starts at the call gate, then compares the caller before save-caller and record', () => {
    expect(flow.StartAction).toBe('gate');
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
    // Connect requires a next action on a transfer; it only runs if the transfer does not happen.
    expect(get('to-remote').Transitions.NextAction).toBe('save-caller');
  });

  it('[RR 15.3] keeps the voicemail actions in order, storing only the masked caller', () => {
    expect(ids.filter((i) => oldActions.includes(i))).toEqual(['save-caller', 'greeting', 'record', 'listen', 'goodbye', 'hang-up']);
    expect(get('save-caller')).toEqual({
      Identifier: 'save-caller',
      Type: 'UpdateContactAttributes',
      Parameters: { Attributes: { afterbeepCaller: '$.External.maskedCaller' }, TargetContact: 'Current' },
      Transitions: { NextAction: 'greeting', Errors: [{ NextAction: 'over-cap', ErrorType: 'NoMatchingError' }] },
    });
    expect(get('greeting').Transitions.NextAction).toBe('record');
    expect(get('record').Type).toBe('UpdateContactRecordingAndAnalyticsBehavior');
    expect(get('record').Parameters.VoiceBehavior.VoiceRecordingBehavior).toEqual({ RecordedParticipants: ['Customer'], IVRRecordingBehavior: 'Enabled' });
    expect(get('record').Transitions.NextAction).toBe('listen');
    expect(get('listen').Parameters).toEqual({ Text: ' ', InputTimeLimitSeconds: '60', StoreInput: 'False' });
    expect(get('listen').Transitions.NextAction).toBe('stop-record');
    expect(get('stop-record').Parameters.VoiceBehavior.VoiceRecordingBehavior.IVRRecordingBehavior).toBe('Disabled');
    expect(get('stop-record').Transitions.NextAction).toBe('goodbye');
    expect(get('goodbye').Transitions.NextAction).toBe('hang-up');
    expect(get('hang-up').Transitions).toEqual({});
  });

  it('[RR 15.1, 15.3] reaches save-caller on every admitted path except the transfer, and records only after the greeting', () => {
    const seen = new Set<string>();
    const walk = (id: string): void => {
      if (seen.has(id) || id === 'to-remote' || id === 'star-to-remote' || id === 'over-cap') return;
      seen.add(id);
      for (const t of targets(get(id))) walk(t);
    };
    walk('check-owner');
    expect(seen.has('save-caller')).toBe(true);
    // The recording starts only after the greeting, which only save-caller leads to.
    expect(flow.Actions.filter((a) => targets(a).includes('greeting')).map((a) => a.Identifier)).toEqual(['save-caller']);
    expect(flow.Actions.filter((a) => targets(a).includes('record')).map((a) => a.Identifier)).toEqual(['greeting', 'star-to-remote']);
    expect(get('to-remote').Transitions.NextAction).toBe('save-caller');
    expect(get('star-to-remote').Transitions.NextAction).toBe('record');
  });

  it('[RR 15.5] lets a caller press * during the greeting to reach the remote flow, where the code is still the only gate', () => {
    const greeting = get('greeting');
    expect(greeting.Type).toBe('GetParticipantInput');
    expect(greeting.Transitions.Conditions).toEqual([{ NextAction: 'star-to-remote', Condition: { Operator: 'Equals', Operands: ['*'] } }]);
    expect(get('star-to-remote')).toMatchObject({ Type: 'TransferToFlow', Parameters: { ContactFlowId: 'REPLACE_WITH_REMOTE_FLOW_ID' } });
  });

  it('starts with the call gate and fails closed: only an allowed answer goes on', () => {
    const gate = get('gate');
    expect(gate.Type).toBe('InvokeLambdaFunction');
    expect(gate.Parameters.LambdaFunctionARN).toBe('REPLACE_WITH_CALL_GATE_LAMBDA_ARN');
    expect(gate.Transitions.Errors).toEqual([{ NextAction: 'over-cap', ErrorType: 'NoMatchingError' }]);
    const cap = get('check-cap');
    expect(cap.Parameters.ComparisonValue).toBe('$.External.allowed');
    expect(cap.Transitions.Conditions).toEqual([{ NextAction: 'stamp', Condition: { Operator: 'Equals', Operands: ['yes'] } }]);
    expect(cap.Transitions.NextAction).toBe('over-cap');
    expect(get('stamp').Parameters.Attributes).toEqual({ afterbeepStart: '$.External.startedAt' });
    expect(get('over-cap').Transitions.NextAction).toBe('hang-up');
  });

  it('never stores the real caller number in a contact attribute', () => {
    for (const a of flow.Actions.filter((x) => x.Type === 'UpdateContactAttributes')) {
      expect(JSON.stringify(a.Parameters.Attributes), a.Identifier).not.toContain('CustomerEndpoint');
    }
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
