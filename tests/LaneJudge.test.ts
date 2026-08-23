import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WINDOWS,
  collectExpiredArrows,
  findClaimableArrow,
  judgeDelta,
  toActiveArrows,
  visibleArrows,
} from '../src/engine/LaneJudge.ts';
import { arrow, chartWith } from './helpers.ts';

const active = (arrows: ReturnType<typeof arrow>[], offsetMs = 0) =>
  toActiveArrows(chartWith(arrows, offsetMs));

describe('judgeDelta — five tiers', () => {
  it('lands exactly on each boundary', () => {
    expect(judgeDelta(0)).toBe('PERFECT');
    expect(judgeDelta(35)).toBe('PERFECT');
    expect(judgeDelta(70)).toBe('NICE');
    expect(judgeDelta(110)).toBe('OKAY');
    expect(judgeDelta(160)).toBe('OOPS');
  });

  it('drops a tier one millisecond past each boundary', () => {
    expect(judgeDelta(35.001)).toBe('NICE');
    expect(judgeDelta(70.001)).toBe('OKAY');
    expect(judgeDelta(110.001)).toBe('OOPS');
    expect(judgeDelta(160.001)).toBe('MISS');
  });

  /**
   * Tighter than hop//beat's ±80/±160 on purpose. A keydown carries no
   * inference latency, so none of the window is spent before the input is
   * seen — that measured ~28 ms of camera pipeline simply is not here to pay
   * for, and the extra grain is a real thing the player did.
   */
  it('is stricter than the camera game could afford to be', () => {
    expect(DEFAULT_WINDOWS.perfectMs).toBeLessThan(80);
  });

  it('honours custom windows', () => {
    const loose = { perfectMs: 60, niceMs: 120, okayMs: 180, oopsMs: 250 };
    expect(judgeDelta(55, loose)).toBe('PERFECT');
    expect(judgeDelta(255, loose)).toBe('MISS');
  });
});

describe('toActiveArrows', () => {
  /**
   * This asserted the opposite until ADR-003: the chart offset was added to
   * every note time here. It is kept, inverted, rather than deleted, because
   * the rule it now encodes is the one that was previously wrong.
   */
  it('does not apply the chart offset — note times are absolute', () => {
    expect(active([arrow('a', 1000)], 250)[0].timeMs).toBe(1000);
  });

  it('starts everything unjudged', () => {
    expect(active([arrow('a', 0), arrow('b', 500)]).every((a) => a.judgment === null)).toBe(true);
  });
});

describe('findClaimableArrow', () => {
  it('claims an arrow inside the widest window', () => {
    expect(findClaimableArrow(active([arrow('a', 1000)]), 'left', 1100)?.arrow.id).toBe('a');
  });

  it('claims nothing beyond it', () => {
    expect(findClaimableArrow(active([arrow('a', 1000)]), 'left', 1200)).toBeNull();
  });

  it('ignores other lanes', () => {
    expect(findClaimableArrow(active([arrow('a', 1000, 'left')]), 'right', 1000)).toBeNull();
  });

  it('ignores arrows already judged', () => {
    const arrows = active([arrow('a', 1000)]);
    arrows[0].judgment = 'PERFECT';
    expect(findClaimableArrow(arrows, 'left', 1000)).toBeNull();
  });

  /**
   * Nearest, not earliest. Crediting the earlier of two close arrows consumes
   * the one the player was not aiming at and leaves the intended one to expire.
   */
  it('claims the nearest arrow in time', () => {
    const arrows = active([arrow('a', 1000), arrow('b', 1120)]);
    expect(findClaimableArrow(arrows, 'left', 1110)?.arrow.id).toBe('b');
    expect(findClaimableArrow(arrows, 'left', 1010)?.arrow.id).toBe('a');
  });

  it('claims an early press as readily as a late one', () => {
    expect(findClaimableArrow(active([arrow('a', 1000)]), 'left', 920)?.arrow.id).toBe('a');
  });
});

describe('collectExpiredArrows', () => {
  it('does not expire an arrow still exactly reachable', () => {
    expect(collectExpiredArrows(active([arrow('a', 1000)]), 1000 + DEFAULT_WINDOWS.oopsMs)).toEqual([]);
  });

  it('expires one millisecond past the last window', () => {
    const expired = collectExpiredArrows(active([arrow('a', 1000)]), 1000 + DEFAULT_WINDOWS.oopsMs + 1);
    expect(expired.map((a) => a.arrow.id)).toEqual(['a']);
  });

  it('never expires something already judged', () => {
    const arrows = active([arrow('a', 1000)]);
    arrows[0].judgment = 'OKAY';
    expect(collectExpiredArrows(arrows, 99_999)).toEqual([]);
  });
});

describe('visibleArrows', () => {
  it('shows what is approaching within the lead', () => {
    const arrows = active([arrow('a', 1000), arrow('b', 9000)]);
    expect(visibleArrows(arrows, 0, 2000).map((a) => a.arrow.id)).toEqual(['a']);
  });

  it('keeps a just-passed arrow briefly so feedback can land', () => {
    const arrows = active([arrow('a', 1000)]);
    expect(visibleArrows(arrows, 1100, 2000, 150)).toHaveLength(1);
    expect(visibleArrows(arrows, 1300, 2000, 150)).toHaveLength(0);
  });
});

/**
 * ADR-003: a note time is absolute.
 *
 * The chart's `analysis.offsetMs` describes the beat grid the notes were
 * authored against. It is editor and analysis metadata, and it is never added
 * to a note time at playback — otherwise a chart that stores absolute times AND
 * an offset has both applied, and every note is wrong by the offset.
 */
describe('note times are absolute (ADR-003)', () => {
  it('ignores the chart offset when deciding when a note is due', () => {
    const notes = [arrow('a', 10_000, 'up')];
    const withoutOffset = toActiveArrows(chartWith(notes, 0));
    const withOffset = toActiveArrows(chartWith(notes, 250));

    // Same note, same due time, whatever the chart says its grid offset was.
    expect(withOffset[0].timeMs).toBe(10_000);
    expect(withOffset[0].timeMs).toBe(withoutOffset[0].timeMs);
  });

  it('judges a press at the written time as perfect, offset or no offset', () => {
    const chart = chartWith([arrow('a', 10_000, 'up')], 250);
    const [active] = toActiveArrows(chart);
    expect(judgeDelta(Math.abs(10_000 - active.timeMs), DEFAULT_WINDOWS)).toBe('PERFECT');
  });
});
