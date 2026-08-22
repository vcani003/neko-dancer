/**
 * Turning detected beats into something worth playing.
 *
 * Beat detection answers "when could something happen?". It does not answer
 * "what should the player do?", and that gap is the actual game design. A
 * chart that places an arrow on every onset is accurate and horrible.
 *
 * The rules here are hop//beat's §9, carried over because they were about
 * choreography rather than about cameras:
 *
 *   - take a subset of the beats, chosen by difficulty
 *   - pick a lane the player can actually get to in time
 *   - refuse transitions that are unpleasant rather than merely hard
 *   - prefer readable patterns and intentional repetition over randomness
 *   - seed the randomness, so the same song always produces the same chart
 *
 * That last one matters more than it sounds. A regenerated chart that differs
 * every time cannot be practised, cannot be compared between players, and
 * cannot be debugged.
 */
import type { AudioAnalysis } from './analyze.ts';
import { LANES, type Arrow, type Chart, type Lane } from '../charts/schema.ts';

/**
 * Which hand plays which lane.
 *
 * Left hand takes the two left lanes, right hand the two right. Alternating
 * hands is what makes a fast passage playable, and knowing the mapping is what
 * lets the generator alternate on purpose rather than by luck.
 */
const HAND: Record<Lane, 'left' | 'right'> = {
  left: 'left',
  down: 'left',
  up: 'right',
  right: 'right',
};

export type GeneratedDifficulty = 'easy' | 'normal' | 'hard';

interface DifficultyRules {
  /** Fraction of candidate beats that become arrows. */
  density: number;
  /** Shortest gap allowed between any two arrows. */
  minGapMs: number;
  /** Shortest gap allowed before the SAME lane repeats. */
  minSameLaneGapMs: number;
  /** Below this gap, the next arrow must use the other hand. */
  alternateBelowMs: number;
  /** Allow two arrows at once. */
  allowChords: boolean;
}

const RULES: Record<GeneratedDifficulty, DifficultyRules> = {
  easy: {
    density: 0.5,
    minGapMs: 300,
    // A finger cannot retrigger a key quickly and comfortably; a different
    // lane can be hit far sooner than the same one twice.
    minSameLaneGapMs: 600,
    alternateBelowMs: 0,
    allowChords: false,
  },
  normal: {
    density: 0.8,
    minGapMs: 150,
    minSameLaneGapMs: 300,
    alternateBelowMs: 200,
    allowChords: false,
  },
  hard: {
    density: 1,
    minGapMs: 90,
    minSameLaneGapMs: 200,
    alternateBelowMs: 130,
    allowChords: true,
  },
};

/**
 * A small deterministic generator.
 *
 * Seeded so a song always produces the same chart. `Math.random()` would make
 * every regeneration a different game.
 */
function makeRandom(seed: number): () => number {
  let state = seed || 1;
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return state / 0x7fffffff;
  };
}

/** A stable seed from the song's identity, so it survives a reload. */
export function seedFromString(text: string): number {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export interface GenerateOptions {
  difficulty?: GeneratedDifficulty;
  seed?: number;
  /** Leave the opening alone so the player can settle. */
  leadInMs?: number;
}

/**
 * Choose the moments an arrow could land on.
 *
 * Onsets are preferred where they line up with the beat grid — an onset ON a
 * beat is almost certainly a drum, while one between beats is as likely to be
 * a vocal or a stray transient. Falling back to the grid keeps a chart playing
 * in time through a passage the detector found nothing in.
 */
export function candidateTimes(analysis: AudioAnalysis, toleranceMs = 60): number[] {
  const times = new Set<number>();

  for (const beat of analysis.beatsMs) {
    const nearby = analysis.onsetsMs.find((onset) => Math.abs(onset - beat) <= toleranceMs);
    times.add(Math.round(nearby ?? beat));
  }

  return [...times].sort((a, b) => a - b);
}

export interface GenerateChartOptions extends GenerateOptions {
  song: Chart['song'];
}

export function generateChart(
  analysis: AudioAnalysis,
  options: GenerateChartOptions,
): Chart {
  const difficulty = options.difficulty ?? 'normal';
  const rules = RULES[difficulty];
  const leadInMs = options.leadInMs ?? 2000;
  const random = makeRandom(options.seed ?? seedFromString(options.song.id));

  const candidates = candidateTimes(analysis).filter((t) => t >= leadInMs);

  const arrows: Arrow[] = [];
  const lastUsedAt: Record<Lane, number> = { left: -Infinity, down: -Infinity, up: -Infinity, right: -Infinity };
  let previous: { timeMs: number; lane: Lane } | null = null;

  for (const timeMs of candidates) {
    // Thin the chart by difficulty, but keep it musical rather than random:
    // every fourth beat always survives, so the pattern stays anchored to the
    // bar instead of dissolving into scattered notes.
    const onDownbeat = arrows.length % 4 === 0;
    if (!onDownbeat && random() > rules.density) continue;

    if (previous && timeMs - previous.timeMs < rules.minGapMs) continue;

    const options_: Lane[] = LANES.filter((lane) => {
      if (timeMs - lastUsedAt[lane] < rules.minSameLaneGapMs) return false;
      if (
        previous &&
        timeMs - previous.timeMs < rules.alternateBelowMs &&
        HAND[lane] === HAND[previous.lane]
      ) {
        // Too fast to play with the same hand twice.
        return false;
      }
      return true;
    });

    if (options_.length === 0) continue;

    // Prefer not to reuse the lane just played, even when the timing allows
    // it. Spec §9 asks for readable patterns, and a run of the same arrow
    // reads as a stutter rather than as a phrase — it also stops the player
    // using both hands, which is most of what makes a chart feel like dancing.
    // Only a preference: if it is the sole legal option, it is still played.
    const justPlayed = previous?.lane;
    const notJustPlayed: Lane[] = justPlayed
      ? options_.filter((candidate) => candidate !== justPlayed)
      : options_;
    const pool: Lane[] = notJustPlayed.length > 0 ? notJustPlayed : options_;

    const lane: Lane = pool[Math.floor(random() * pool.length) % pool.length];
    arrows.push({
      id: `a${(arrows.length + 1).toString().padStart(4, '0')}`,
      timeMs: Math.round(timeMs),
      lane,
      type: 'tap',
    });
    lastUsedAt[lane] = timeMs;
    previous = { timeMs, lane };
  }

  return {
    schemaVersion: 1,
    song: options.song,
    analysis: {
      bpm: analysis.bpm,
      offsetMs: 0,
      generatorVersion: 'flux-autocorrelation-1',
    },
    difficulty,
    source: 'generated',
    arrows,
  };
}
