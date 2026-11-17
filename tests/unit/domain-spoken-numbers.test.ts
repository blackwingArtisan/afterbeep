import { describe, expect, it } from 'vitest';
import { readCount, readPrice, spokenDigitsToText } from '../../src/domain/spoken-numbers';

describe('readPrice', () => {
  it.each([
    ['three twenty-nine', [32900, 329]],
    ['sixty-two fifty', [6250, 625000]],
    ['forty-five', [4500]],
    ['sixty', [6000]],
    ['twelve hundred', [120000]],
    ['a hundred and twenty', [12000]],
    ['one hundred twenty nine ninety-nine', [12999]],
    ['four oh five', [40500, 405]],
    ['two thousand four hundred', [240000]],
    ['forty dollars and fifty cents', [4050]],
    ['fifty cents', [50]],
    ['ninety bucks', [9000]],
    ['$1,250.00', [125000]],
    ['62.50', [6250]],
  ])('reads "%s"', (phrase, expected) => {
    expect(readPrice(phrase)).toEqual(expected);
  });

  it('returns nothing when there are two separate numbers', () => {
    expect(readPrice('two three')).toEqual([]);
  });
});

describe('readCount', () => {
  it.each([
    ['nineteen', 19],
    ['two', 2],
    ['1.5', 1.5],
    ['three hundred and five', 305],
  ])('reads "%s"', (phrase, expected) => {
    expect(readCount(phrase)).toBe(expected);
  });
});

describe('spokenDigitsToText', () => {
  it('joins spoken phone digits', () => {
    expect(spokenDigitsToText('call six one four, five five five, oh one seven seven thanks')).toBe(
      'call 6145550177 thanks',
    );
  });
  it('handles "double"', () => {
    expect(spokenDigitsToText('five double five oh one two one')).toBe('5550121');
  });
  it('leaves short runs alone', () => {
    expect(spokenDigitsToText('this is one of two dryers')).toBe('this is one of two dryers');
  });
});
