import { describe, expect, it } from 'vitest';
import { checkRemoteCode, codesMatch, publicBusiness } from '../../src/domain/remote-code';
import { demoBusiness } from '../../src/server/seed';

const T0 = new Date('2026-11-16T19:00:00Z');
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);
const db = (remoteFailures: string[] = []) => ({ business: { remoteCode: '427' }, remoteFailures });

/** Keys wrong codes at the given minute offsets, carrying the failure list forward. */
function failAt(minutes: number[]) {
  let failures: string[] = [];
  for (const m of minutes) failures = checkRemoteCode(db(failures), '000', at(m)).failures;
  return failures;
}

describe('remote code', () => {
  it('[RR 2.1] the demo business uses 427', () => {
    expect(demoBusiness.remoteCode).toBe('427');
  });

  it('[RR 2.2] compares codes by digest, so length and content never short-circuit', () => {
    expect(codesMatch('427', '427')).toBe(true);
    expect(codesMatch('428', '427')).toBe(false);
    expect(codesMatch('4', '427')).toBe(false);
  });

  it('[RR 2.3] the public business has no remote code', () => {
    expect(JSON.stringify(publicBusiness(demoBusiness))).not.toContain('427');
    expect('remoteCode' in publicBusiness(demoBusiness)).toBe(false);
  });

  it('[RR 2.4] five wrong codes in 15 minutes lock the check, even for the right code', () => {
    const failures = failAt([0, 1, 2, 3, 4]);
    expect(failures).toHaveLength(5);
    expect(checkRemoteCode(db(failures), '427', at(5)).result).toBe('locked');
    expect(checkRemoteCode(db(failures), '000', at(10)).result).toBe('locked');
  });

  it('[RR 2.4] four wrong codes do not lock', () => {
    expect(checkRemoteCode(db(failAt([0, 1, 2, 3])), '427', at(4)).result).toBe('ok');
  });

  it('[RR 2.4] the lock holds until 15 minutes after the fifth failure, then lifts', () => {
    const failures = failAt([0, 1, 2, 3, 4]);
    expect(checkRemoteCode(db(failures), '427', at(18)).result).toBe('locked');
    expect(checkRemoteCode(db(failures), '427', at(19)).result).toBe('ok');
    const lifted = checkRemoteCode(db(failures), '000', at(19));
    expect(lifted.result).toBe('wrong');
    expect(lifted.failures).toHaveLength(1);
  });

  it('[RR 2.4] wrong codes older than 15 minutes stop counting', () => {
    const failures = failAt([0, 1, 2, 3]);
    const next = checkRemoteCode(db(failures), '000', at(16));
    expect(next.result).toBe('wrong');
    expect(next.failures).toHaveLength(3);
  });

  it('[RR 2.6] a right code clears the failures', () => {
    expect(checkRemoteCode(db(failAt([0, 1, 2])), '427', at(3))).toEqual({ result: 'ok', failures: [] });
  });

  it('[RR 2.4] a locked check records no further failure', () => {
    const failures = failAt([0, 1, 2, 3, 4]);
    expect(checkRemoteCode(db(failures), '000', at(6)).failures).toEqual(failures);
  });

  it('[RR 2.2] malformed digits are wrong, never ok', () => {
    expect(checkRemoteCode(db(), '42', at(0)).result).toBe('wrong');
    expect(checkRemoteCode({ business: { remoteCode: '' }, remoteFailures: [] }, '', at(0)).result).toBe('wrong');
  });
});
