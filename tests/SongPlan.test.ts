import { describe, expect, it } from 'vitest';
import {
  bpmAt,
  flatPlan,
  inferPlanFromTaps,
  intensityAt,
  normalisePlan,
  playsAt,
  sectionAt,
  validatePlan,
  type SongPlan,
} from '../src/charts/SongPlan.ts';
import { generateChart } from '../src/analysis/generate.ts';
import { analysisFromTempo } from '../src/analysis/fromTempo.ts';

const plan = (over: Partial<SongPlan> = {}): SongPlan => ({
  bpm: 120,
  firstBeatMs: 0,
  durationMs: 60_000,
  sections: [
    { id: 'a', startMs: 0, endMs: 10_000, kind: 'skip', intensity: 0, label: 'intro' },
    { id: 'b', startMs: 10_000, endMs: 40_000, kind: 'play', intensity: 1 },
    { id: 'c', startMs: 40_000, endMs: 60_000, kind: 'play', intensity: 1.8, bpm: 140 },
  ],
  ...over,
});

describe('reading a plan', () => {
  it('finds the section covering a moment', () => {
    expect(sectionAt(plan(), 5_000)?.id).toBe('a');
    expect(sectionAt(plan(), 20_000)?.id).toBe('b');
    expect(sectionAt(plan(), 99_000)).toBeNull();
  });

  it('treats a boundary as belonging to the section starting there', () => {
    expect(sectionAt(plan(), 10_000)?.id).toBe('b');
  });

  /** The intro problem, solved: nothing is placed where nothing should be. */
  it('knows where arrows do and do not belong', () => {
    expect(playsAt(plan(), 5_000)).toBe(false);
    expect(playsAt(plan(), 20_000)).toBe(true);
    expect(playsAt(plan(), 99_000)).toBe(false);
  });

  it('reports the tempo in force, section first', () => {
    expect(bpmAt(plan(), 20_000)).toBe(120);
    expect(bpmAt(plan(), 50_000)).toBe(140);
  });

  it('reports intensity, and zero wherever it is skipped', () => {
    expect(intensityAt(plan(), 5_000)).toBe(0);
    expect(intensityAt(plan(), 50_000)).toBe(1.8);
  });
});

describe('validatePlan', () => {
  it('accepts a sound plan', () => {
    expect(validatePlan(plan())).toEqual([]);
  });

  /**
   * Overlaps would make `sectionAt` depend on array order — the kind of bug
   * that surfaces months later as "sometimes the arrows just stop".
   */
  it('catches overlapping sections', () => {
    const overlapping = plan({
      sections: [
        { id: 'a', startMs: 0, endMs: 20_000, kind: 'play', intensity: 1 },
        { id: 'b', startMs: 10_000, endMs: 30_000, kind: 'play', intensity: 1 },
      ],
    });
    expect(validatePlan(overlapping).some((p) => /overlap/i.test(p.message))).toBe(true);
  });

  it('catches a section that ends before it starts', () => {
    const backwards = plan({
      sections: [{ id: 'a', startMs: 20_000, endMs: 10_000, kind: 'play', intensity: 1 }],
    });
    expect(validatePlan(backwards).some((p) => /ends before/i.test(p.message))).toBe(true);
  });

  it('catches duplicate ids and impossible tempos', () => {
    const broken = plan({
      bpm: 0,
      sections: [
        { id: 'a', startMs: 0, endMs: 1000, kind: 'play', intensity: 1 },
        { id: 'a', startMs: 2000, endMs: 3000, kind: 'play', intensity: 1, bpm: -5 },
      ],
    });
    const messages = validatePlan(broken).map((p) => p.message).join(' ');
    expect(messages).toMatch(/Duplicate/);
    expect(messages).toMatch(/Tempo must be above zero/);
    expect(messages).toMatch(/Section tempo/);
  });
});

describe('normalisePlan', () => {
  /** An edit that nudged one section into another meant to move a boundary. */
  it('trims an overlap rather than dropping a section', () => {
    const messy = plan({
      sections: [
        { id: 'b', startMs: 10_000, endMs: 30_000, kind: 'play', intensity: 1 },
        { id: 'a', startMs: 0, endMs: 20_000, kind: 'skip', intensity: 0 },
      ],
    });
    const tidy = normalisePlan(messy);
    expect(tidy.sections.map((s) => s.id)).toEqual(['a', 'b']);
    expect(tidy.sections[1].startMs).toBe(20_000);
    expect(validatePlan(tidy)).toEqual([]);
  });

  it('clips anything past the end of the song', () => {
    const overrun = plan({
      durationMs: 30_000,
      sections: [{ id: 'a', startMs: 0, endMs: 90_000, kind: 'play', intensity: 1 }],
    });
    expect(normalisePlan(overrun).sections[0].endMs).toBe(30_000);
  });

  it('drops a section left with no length at all', () => {
    const swallowed = plan({
      sections: [
        { id: 'a', startMs: 0, endMs: 30_000, kind: 'play', intensity: 1 },
        { id: 'b', startMs: 10_000, endMs: 20_000, kind: 'play', intensity: 1 },
      ],
    });
    expect(normalisePlan(swallowed).sections.map((s) => s.id)).toEqual(['a']);
  });
});

describe('inferring a plan from tapping', () => {
  const bpm = 120;
  const beat = 60_000 / bpm;

  /** Taps every beat across a span. */
  const run = (fromMs: number, beats: number, every = 1) =>
    Array.from({ length: beats }, (_, i) => fromMs + i * beat * every);

  it('falls back to an even plan when nobody tapped', () => {
    const inferred = inferPlanFromTaps([], bpm, 0, 60_000);
    expect(inferred.sections).toHaveLength(1);
    expect(inferred.sections[0].kind).toBe('play');
  });

  /**
   * The headline: silence before the first tap is the intro, and it is skipped
   * because nobody tapped there. No audio was consulted to work that out.
   */
  it('marks an untapped intro as skipped', () => {
    const inferred = inferPlanFromTaps(run(20_000, 32), bpm, 0, 60_000);
    const first = inferred.sections[0];
    expect(first.kind).toBe('skip');
    expect(first.label).toBe('intro');
    expect(first.startMs).toBe(0);
    expect(first.endMs).toBeCloseTo(20_000, -2);
    expect(playsAt(inferred, 5_000)).toBe(false);
  });

  it('marks a gap in the middle as a break', () => {
    const taps = [...run(0, 16), ...run(30_000, 16)];
    const inferred = inferPlanFromTaps(taps, bpm, 0, 60_000);
    const breaks = inferred.sections.filter((s) => s.kind === 'skip');
    expect(breaks.some((s) => s.label === 'break')).toBe(true);
    expect(playsAt(inferred, 20_000)).toBe(false);
  });

  it('marks an untapped ending as an outro', () => {
    const inferred = inferPlanFromTaps(run(0, 16), bpm, 0, 60_000);
    expect(inferred.sections.at(-1)?.label).toBe('outro');
    expect(playsAt(inferred, 55_000)).toBe(false);
  });

  /**
   * Tapping twice as fast through a passage says that passage should be
   * denser — and the person tapping knows the song better than a detector.
   */
  it('reads a faster-tapped passage as a busier one', () => {
    const taps = [...run(0, 16), ...run(20_000, 32, 0.5)];
    const inferred = inferPlanFromTaps(taps, bpm, 0, 60_000);
    const play = inferred.sections.filter((s) => s.kind === 'play');
    expect(play.length).toBeGreaterThanOrEqual(2);
    expect(play[1].intensity).toBeGreaterThan(play[0].intensity);
  });

  it('never produces a plan that fails its own validation', () => {
    const cases = [
      run(0, 40),
      [...run(5_000, 16), ...run(40_000, 16)],
      [...run(0, 8), ...run(12_000, 8), ...run(30_000, 24, 0.5)],
      [1000],
    ];
    for (const taps of cases) {
      expect(validatePlan(inferPlanFromTaps(taps, bpm, 0, 60_000))).toEqual([]);
    }
  });

  it('keeps sections in order and inside the song', () => {
    const inferred = inferPlanFromTaps([...run(10_000, 16), ...run(40_000, 16)], bpm, 0, 60_000);
    let previousEnd = -1;
    for (const section of inferred.sections) {
      expect(section.startMs).toBeGreaterThanOrEqual(previousEnd);
      expect(section.endMs).toBeLessThanOrEqual(60_000);
      previousEnd = section.endMs;
    }
  });
});

describe('flatPlan', () => {
  it('plays the whole song evenly', () => {
    const flat = flatPlan(128, 250, 90_000);
    expect(flat.sections).toHaveLength(1);
    expect(playsAt(flat, 45_000)).toBe(true);
    expect(validatePlan(flat)).toEqual([]);
  });
});

describe('generating against a plan', () => {
  const bpm = 120;
  const analysis = analysisFromTempo({ bpm, firstBeatMs: 0, durationMs: 120_000 });
  const song = {
    id: 'planned',
    title: 'Planned',
    artist: 'x',
    playback: { provider: 'youtube' as const, videoId: 'abcdefghijk' },
  };

  it('places nothing in a skipped section', () => {
    const withIntro: SongPlan = {
      bpm,
      firstBeatMs: 0,
      durationMs: 120_000,
      sections: [
        { id: 'a', startMs: 0, endMs: 30_000, kind: 'skip', intensity: 0, label: 'intro' },
        { id: 'b', startMs: 30_000, endMs: 120_000, kind: 'play', intensity: 1 },
      ],
    };
    const chart = generateChart(analysis, { song, plan: withIntro, leadInMs: 0 });
    expect(chart.arrows.length).toBeGreaterThan(20);
    expect(chart.arrows.every((a) => a.timeMs >= 30_000)).toBe(true);
  });

  it('puts more arrows in a busier section than a quiet one', () => {
    const varied: SongPlan = {
      bpm,
      firstBeatMs: 0,
      durationMs: 120_000,
      sections: [
        { id: 'quiet', startMs: 0, endMs: 60_000, kind: 'play', intensity: 0.3 },
        { id: 'busy', startMs: 60_000, endMs: 120_000, kind: 'play', intensity: 2 },
      ],
    };
    const chart = generateChart(analysis, { song, plan: varied, leadInMs: 0 });
    const quiet = chart.arrows.filter((a) => a.timeMs < 60_000).length;
    const busy = chart.arrows.filter((a) => a.timeMs >= 60_000).length;
    expect(busy).toBeGreaterThan(quiet);
  });

  it('behaves as before when given no plan', () => {
    const withPlan = generateChart(analysis, { song, plan: flatPlan(bpm, 0, 120_000), leadInMs: 0 });
    const without = generateChart(analysis, { song, leadInMs: 0 });
    expect(withPlan.arrows.length).toBe(without.arrows.length);
  });

  /** Tapped shape all the way through to a chart, with no audio anywhere. */
  it('carries a tapped shape into the finished chart', () => {
    const beat = 60_000 / bpm;
    const taps = Array.from({ length: 40 }, (_, i) => 30_000 + i * beat);
    const inferred = inferPlanFromTaps(taps, bpm, 0, 120_000);

    const chart = generateChart(analysis, { song, plan: inferred, leadInMs: 0 });
    expect(chart.arrows.length).toBeGreaterThan(5);
    // Nobody tapped the first thirty seconds, so nothing was placed there.
    expect(chart.arrows.every((a) => a.timeMs >= 29_000)).toBe(true);
  });
});
