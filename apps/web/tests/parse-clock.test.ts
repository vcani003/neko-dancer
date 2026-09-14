/**
 * Clock-style start times. `0:06` is six seconds, not six milliseconds.
 */
import { describe, expect, it } from 'vitest';
import { parseClock } from '../src/pages/create/parseClock.ts';

describe('parseClock', () => {
  it('reads 0:06 as six seconds', () => {
    expect(parseClock('0:06')).toBe(6000);
  });

  it('reads 1:12 as one minute twelve', () => {
    expect(parseClock('1:12')).toBe(72_000);
  });

  it('treats a bare number as seconds', () => {
    expect(parseClock('6')).toBe(6000);
  });

  it('accepts zero and fractions', () => {
    expect(parseClock('0:00')).toBe(0);
    expect(parseClock('1:12.5')).toBe(72_500);
  });

  it('refuses empty, inverted, and sixty-second clocks', () => {
    expect(parseClock('')).toBeNull();
    expect(parseClock('  ')).toBeNull();
    expect(parseClock('nope')).toBeNull();
    expect(parseClock('0:60')).toBeNull();
    expect(parseClock('-1:00')).toBeNull();
  });
});
