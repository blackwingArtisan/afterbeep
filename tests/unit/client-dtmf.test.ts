import { describe, expect, it } from 'vitest';
import { DTMF_FREQUENCIES, dtmf } from '../../src/client/lib/sound';

describe('keypad tones', () => {
  it('[RR 12.6] gives each of the twelve keys its standard row and column pair', () => {
    expect(DTMF_FREQUENCIES).toEqual({
      '1': [697, 1209],
      '2': [697, 1336],
      '3': [697, 1477],
      '4': [770, 1209],
      '5': [770, 1336],
      '6': [770, 1477],
      '7': [852, 1209],
      '8': [852, 1336],
      '9': [852, 1477],
      '*': [941, 1209],
      '0': [941, 1336],
      '#': [941, 1477],
    });
  });

  it('[RR 12.6] stays silent where audio is unavailable', () => {
    expect(() => dtmf('5')).not.toThrow();
  });
});
