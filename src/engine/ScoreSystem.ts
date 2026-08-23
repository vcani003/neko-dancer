/**
 * Scoring, combo and health.
 *
 * Aiming to be faithful to the original. What is actually confirmed from the
 * Atelier 801 forums is narrow, and is marked below; the rest is a reasonable
 * ladder built around it and should be corrected once the real numbers are
 * known. Guessing is fine here as long as the guesses are labelled.
 */
import type { Judgment } from './LaneJudge.ts';

/**
 * Base points per judgment.
 *
 * CONFIRMED: a Perfect at zero combo is worth 7, shown as 14 after an ×2
 * multiplier. INFERRED: everything below Perfect, as a descending ladder.
 */
export const BASE_POINTS: Record<Judgment, number> = {
  PERFECT: 7,
  GREAT: 5,
  GOOD: 3,
  OKAY: 1,
  MISS: 0,
};

/** CONFIRMED: finishing a song is worth 5. */
export const COMPLETION_BONUS = 5;

/**
 * The multiplier starts at 2 rather than 1 — that is what makes a Perfect at
 * zero combo read as 14 rather than 7.
 */
export const BASE_MULTIPLIER = 2;

/** INFERRED: combo tiers. Capped so a long song cannot run away. */
const COMBO_TIERS = [
  { combo: 200, multiplier: 8 },
  { combo: 100, multiplier: 6 },
  { combo: 50, multiplier: 4 },
  { combo: 20, multiplier: 3 },
  { combo: 0, multiplier: BASE_MULTIPLIER },
];

export const MAX_HEALTH = 100;

/**
 * Health change per judgment.
 *
 * The mechanic hop//beat never had, and it changes the shape of a run: it can
 * end badly rather than merely scoring low. Recovery is deliberately slower
 * than damage, so a bad patch is felt without being unrecoverable.
 */
export const HEALTH_DELTA: Record<Judgment, number> = {
  PERFECT: 2,
  GREAT: 1.5,
  GOOD: 1,
  OKAY: -2,
  MISS: -6,
};

/** A key pressed in a lane with no arrow to claim. */
export const WRONG_KEY_HEALTH_DELTA = -3;

export interface ScoreState {
  score: number;
  combo: number;
  maxCombo: number;
  health: number;
  /** True once health has hit zero. The run is over; nothing revives it. */
  failed: boolean;
  counts: Record<Judgment, number>;
  wrongKeys: number;
  totalAbsDeltaMs: number;
  totalDeltaMs: number;
  judgedCount: number;
}

export function initialScoreState(): ScoreState {
  return {
    score: 0,
    combo: 0,
    maxCombo: 0,
    health: MAX_HEALTH,
    failed: false,
    counts: { PERFECT: 0, GREAT: 0, GOOD: 0, OKAY: 0, MISS: 0 },
    wrongKeys: 0,
    totalAbsDeltaMs: 0,
    totalDeltaMs: 0,
    judgedCount: 0,
  };
}

export function comboMultiplier(combo: number): number {
  return COMBO_TIERS.find((tier) => combo >= tier.combo)?.multiplier ?? BASE_MULTIPLIER;
}

const clampHealth = (value: number): number => Math.min(MAX_HEALTH, Math.max(0, value));

/**
 * Which judgments keep a combo alive.
 *
 * Okay does; Oops does not. The original resets combo "after errors", and an
 * Oops is the tier where the player has plainly mistimed rather than merely
 * been imprecise.
 */
export const KEEPS_COMBO: Record<Judgment, boolean> = {
  PERFECT: true,
  GREAT: true,
  GOOD: true,
  OKAY: false,
  MISS: false,
};

export function applyJudgment(
  state: ScoreState,
  judgment: Judgment,
  deltaMs: number,
): ScoreState {
  const keepsCombo = KEEPS_COMBO[judgment];
  const scored = judgment !== 'MISS';

  // The multiplier is read from the combo BEFORE this arrow extends it, so an
  // arrow is never worth more in hindsight than it was on screen.
  const multiplier = comboMultiplier(state.combo);
  const combo = keepsCombo ? state.combo + 1 : 0;
  const health = clampHealth(state.health + HEALTH_DELTA[judgment]);

  return {
    ...state,
    score: state.score + BASE_POINTS[judgment] * multiplier,
    combo,
    maxCombo: Math.max(state.maxCombo, combo),
    health,
    failed: state.failed || health <= 0,
    counts: { ...state.counts, [judgment]: state.counts[judgment] + 1 },
    totalAbsDeltaMs: scored ? state.totalAbsDeltaMs + Math.abs(deltaMs) : state.totalAbsDeltaMs,
    totalDeltaMs: scored ? state.totalDeltaMs + deltaMs : state.totalDeltaMs,
    judgedCount: state.judgedCount + 1,
  };
}

/** A key pressed with nothing to hit: costs health and breaks the combo. */
export function applyWrongKey(state: ScoreState): ScoreState {
  const health = clampHealth(state.health + WRONG_KEY_HEALTH_DELTA);
  return {
    ...state,
    combo: 0,
    health,
    failed: state.failed || health <= 0,
    wrongKeys: state.wrongKeys + 1,
  };
}

export function applyCompletionBonus(state: ScoreState): ScoreState {
  return { ...state, score: state.score + COMPLETION_BONUS };
}

/** 0–1 over judged arrows, weighted by what each was worth. */
export function accuracy(state: ScoreState): number {
  if (state.judgedCount === 0) return 1;
  const earned = (Object.keys(state.counts) as Judgment[]).reduce(
    (total, judgment) => total + state.counts[judgment] * BASE_POINTS[judgment],
    0,
  );
  return earned / (state.judgedCount * BASE_POINTS.PERFECT);
}

export function meanAbsDeltaMs(state: ScoreState): number | null {
  const hits = state.judgedCount - state.counts.MISS;
  return hits === 0 ? null : state.totalAbsDeltaMs / hits;
}

/** Negative is consistently early, positive consistently late. */
export function meanDeltaMs(state: ScoreState): number | null {
  const hits = state.judgedCount - state.counts.MISS;
  return hits === 0 ? null : state.totalDeltaMs / hits;
}

export type Grade = 'S' | 'A' | 'B' | 'C' | 'D' | 'F';

/**
 * What each grade needs, best first.
 *
 * Exported because a grade the player cannot predict is a grade they cannot
 * chase. The results screen shows the next one up and how far away it is.
 */
export const GRADE_THRESHOLDS: ReadonlyArray<{ grade: Grade; min: number }> = [
  { grade: 'S', min: 0.95 },
  { grade: 'A', min: 0.9 },
  { grade: 'B', min: 0.8 },
  { grade: 'C', min: 0.7 },
  { grade: 'D', min: 0 },
];

export function grade(state: ScoreState): Grade {
  if (state.failed) return 'F';
  const value = accuracy(state);
  return GRADE_THRESHOLDS.find((t) => value >= t.min)?.grade ?? 'D';
}

/** The next grade up, and the accuracy it needs. Null at the top. */
export function nextGrade(state: ScoreState): { grade: Grade; min: number } | null {
  if (state.failed) return null;
  const value = accuracy(state);
  const better = [...GRADE_THRESHOLDS].reverse().find((t) => value < t.min);
  return better ?? null;
}

/** Not worth suggesting a correction below this many hits — it would be noise. */
const MIN_HITS_TO_CALIBRATE = 8;
/** Below this, the player is centred and nudging them would make it worse. */
const CALIBRATION_DEADBAND_MS = 8;

/**
 * The offset that would centre this player's timing, or null if there is not
 * enough evidence or nothing worth correcting.
 *
 * A consistent bias is calibration, not skill. Someone hitting 40 ms early
 * every time is playing accurately against a clock that disagrees with them by
 * 40 ms, and no amount of practice fixes that — but one number does.
 *
 * Sign: delta is press time minus arrow time, so early is negative. Shifting
 * judged time forward by the negation of the mean brings them to zero.
 */
export function suggestedOffsetMs(state: ScoreState, currentOffsetMs: number): number | null {
  const hits = state.judgedCount - state.counts.MISS;
  const mean = meanDeltaMs(state);
  if (hits < MIN_HITS_TO_CALIBRATE || mean === null) return null;
  if (Math.abs(mean) < CALIBRATION_DEADBAND_MS) return null;
  return Math.round(currentOffsetMs - mean);
}
