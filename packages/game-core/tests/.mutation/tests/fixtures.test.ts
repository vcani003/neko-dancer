/**
 * The fixtures are real charts.
 *
 * `ENGINEERING.md` §5: a test chart missing `type: 'tap'` once passed a server
 * that only counted arrows and failed the client validator, so the test proved
 * nothing about the path it claimed to cover.
 *
 * Every chart the engine tests use is put through the protocol's own validator
 * here. If a builder drifts out of spec, this fails — rather than every engine
 * test quietly exercising a shape the real game will never see.
 *
 * This file imports only `@neko/protocol`, so it runs even while
 * `@neko/game-core` is still being written.
 */
import { describe, expect, it } from 'vitest';
import { validateChartRevision } from '@neko/protocol';
import { chartOf, hold, singleTapChart, tap } from './helpers.ts';

const expectValid = (chart: unknown) => {
  const result = validateChartRevision(chart);
  expect(result.ok ? '' : result.errors.join(' | ')).toBe('');
};

describe('every chart the engine tests use would be accepted by the server', () => {
  it('builds a valid single-tap chart', () => {
    expectValid(singleTapChart());
  });

  it('builds a valid chart of several taps in ascending order', () => {
    expectValid(chartOf([tap('a', 1_000), tap('b', 1_500), tap('c', 2_000)]));
  });

  it('builds a valid chart holding a hold', () => {
    expectValid(chartOf([hold('h1', 10_000, 2_000)]));
  });

  it('builds a valid chart mixing taps and holds across lanes', () => {
    expectValid(chartOf([
      tap('a', 1_000, 'left'),
      hold('h', 1_200, 800, 'down'),
      tap('b', 1_500, 'up'),
      tap('c', 2_000, 'right'),
    ]));
  });

  it('builds a valid empty chart', () => {
    expectValid(chartOf([]));
  });

  it('builds a valid 120-note chart, as the failure tests use', () => {
    const notes = Array.from({ length: 120 }, (_, i) => tap(`n${i}`, 1_000 + i * 100));
    expectValid(chartOf(notes));
  });

  it('builds notes in the ascending order the engine relies on', () => {
    // "The engine walks forward and never looks back", which is only safe
    // because order is validated upstream. A builder emitting them unsorted
    // would make that invariant untestable.
    const notes = chartOf([tap('a', 1_000), tap('b', 1_500), tap('c', 2_000)]).notes;
    const times = notes.map((n) => n.timeMs);
    expect([...times].sort((x, y) => x - y)).toEqual(times);
  });
});

describe('the builders honour their arguments', () => {
  // A builder that ignored its parameters would make every engine test pass by
  // testing the same default chart over and over.
  it('places a tap where it was asked to', () => {
    expect(tap('x', 4_242, 'left')).toMatchObject({ id: 'x', timeMs: 4_242, lane: 'left', type: 'tap' });
  });

  it('gives a hold the duration it was asked for', () => {
    expect(hold('h', 1_000, 750, 'right')).toMatchObject({
      timeMs: 1_000, durationMs: 750, lane: 'right', type: 'hold',
    });
  });

  it('never puts a durationMs on a tap', () => {
    expect('durationMs' in tap('x', 0)).toBe(false);
  });
});
