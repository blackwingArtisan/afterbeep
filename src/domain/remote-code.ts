/**
 * The remote code check. Pure: the caller passes `now` and stores the failure list it gets back.
 * Five wrong codes within 15 minutes lock every check until 15 minutes after the fifth (RR 2.4).
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import type { Business } from './types';

export const LOCKOUT_FAILURES = 5;
export const LOCKOUT_MINUTES = 15;

export type CodeResult = 'ok' | 'wrong' | 'locked';

export interface CodeCheck {
  result: CodeResult;
  /** The new list of recent wrong-code times (ISO). Save it as `remoteFailures`. */
  failures: string[];
}

export interface CodeDb {
  business: Pick<Business, 'remoteCode'>;
  remoteFailures?: readonly string[];
}

/** Compares two strings in constant time by comparing fixed-length digests (RR 2.2). */
export function codesMatch(keyed: string, saved: string): boolean {
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(keyed), digest(saved));
}

export function checkRemoteCode(db: CodeDb, digits: string, now: Date): CodeCheck {
  const windowMs = LOCKOUT_MINUTES * 60_000;
  const times = [...(db.remoteFailures ?? [])].map((t) => Date.parse(t)).filter((t) => !Number.isNaN(t)).sort((a, b) => a - b);
  const last = times[times.length - 1];
  // Locked until 15 minutes after the fifth failure; even a right code is refused.
  if (times.length >= LOCKOUT_FAILURES && last !== undefined && now.getTime() - last < windowMs) {
    return { result: 'locked', failures: times.map((t) => new Date(t).toISOString()) };
  }
  const recent = times.filter((t) => now.getTime() - t < windowMs);
  const saved = db.business.remoteCode ?? '';
  const right = /^\d{3}$/.test(saved) && /^\d{3}$/.test(digits) && codesMatch(digits, saved);
  if (right) return { result: 'ok', failures: [] };
  return { result: 'wrong', failures: [...recent, now.getTime()].map((t) => new Date(t).toISOString()) };
}

/** The business as every API response shows it: without the remote code (RR 2.3). */
export function publicBusiness(business: Business): Omit<Business, 'remoteCode'> {
  const { remoteCode: _code, ...rest } = business;
  return rest;
}
