/**
 * Scoring, combo and health.
 *
 * Aiming to be faithful to the original. What is actually confirmed from the
 * Atelier 801 forums is narrow, and is marked below; the rest is a reasonable
 * ladder built around it and should be corrected once the real numbers are
 * known. Guessing is fine here as long as the guesses are labelled.
 *
 * Every function is pure and returns a new state, so a run can be replayed,
 * diffed, or asserted against without anything hidden accumulating.
 */
import type { Judgment } from '@neko/protocol';
import { JUDGMENTS } from '@neko/protocol';

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

/**
 * INFERRED: what letting go of a hold early costs.
 *
 * Its own constant rather than a reused judgment delta, because it is the one
 * number in the hold mechanic that is pure guesswork and it should be findable
 * when playtesting says it is wrong. Set at the `OKAY` penalty: the player did
 * hit the note, so it is harsher than nothing and gentler than a miss.
 */
export const HOLD_DROP_HEALTH_DELTA = -2;

export interface ScoreState {
  score: number;
  combo: number;
  maxCombo: number;
  health: number;
  /** True once health has hit zero. The run is over; nothing revives it. */
  failed: boolean;
  counts: Record<Judgment, number>;
  /** Presses with nothing in range. Counted, not penalised — see `countWrongKey`. */
  wrongKeys: number;
  /** Holds whose sustain ended early. */
  holdsDropped: number;
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
    holdsDropped: 0,
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
 * `GOOD` does; `OKAY` does not. The original resets combo "after errors", and
 * the fourth tier is where the player has plainly mistimed rather than merely
 * been imprecise. ADR-005 renamed these tiers — what breaks a combo is the tier
 * that used to be called `OOPS` — and flags the naming as the thing to revisit
 * if a grade called "Okay" that punishes you reads oddly in play. The
 * thresholds and this rule are unchanged from what the game has always done.
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

  // The multiplier is read from the combo BEFORE this note extends it, so a
  // note is never worth more in hindsight than it was on screen.
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

/**
 * Settle a hold's sustain. `fraction` is 0–1 of the duration actually held.
 *
 * The sustain pays the start judgment's base points again, scaled by how much
 * of the hold survived, so a hold is worth roughly twice a tap when held all
 * the way and roughly a tap when let go immediately.
 *
 * It deliberately does NOT touch `counts` or `judgedCount`: a hold is one note
 * and contributes one judgment, its start. Counting the sustain as a second
 * judgment would make accuracy mean something different on a chart with holds
 * than on a chart without.
 */
export function applyHoldSustain(
  state: ScoreState,
  startJudgment: Judgment,
  fraction: number,
): ScoreState {
  const held = Math.min(1, Math.max(0, fraction));
  const complete = held >= 1;
  const multiplier = comboMultiplier(state.combo);
  const health = complete ? state.health : clampHealth(state.health + HOLD_DROP_HEALTH_DELTA);

  return {
    ...state,
    score: state.score + Math.round(BASE_POINTS[startJudgment] * multiplier * held),
    // Letting go early breaks the combo for the same reason a mistimed press
    // does: the player stopped doing the thing the note asked for.
    combo: complete ? state.combo : 0,
    health,
    failed: state.failed || health <= 0,
    holdsDropped: complete ? state.holdsDropped : state.holdsDropped + 1,
  };
}

/**
 * A press with nothing in range. Counted for diagnostics, and free.
 *
 * The previous build drained 3 health and broke the combo here, on the argument
 * that a keypress is deliberate and the original punishes a wrong key. API.md
 * §3 overrules that: "mashing an empty lane costs nothing but wastes the press."
 * The count survives because a run full of them is a useful thing to see on a
 * results screen, and because bringing the penalty back should be a change to
 * one function rather than a new mechanic.
 */
export function countWrongKey(state: ScoreState): ScoreState {
  return { ...state, wrongKeys: state.wrongKeys + 1 };
}

export function applyCompletionBonus(state: ScoreState): ScoreState {
  return { ...state, score: state.score + COMPLETION_BONUS };
}

/** 0–1 over judged notes, weighted by what each was worth. */
export function accuracy(state: ScoreState): number {
  if (state.judgedCount === 0) return 1;
  const earned = JUDGMENTS.reduce(
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
 * The calibration that would centre this player's timing, or null if there is
 * not enough evidence or nothing worth correcting.
 *
 * A consistent bias is calibration, not skill. Someone hitting 40 ms early
 * every time is playing accurately against a clock that disagrees with them by
 * 40 ms, and no amount of practice fixes that — but one number does.
 *
 * Sign: delta is press time minus note time, so early is negative, and
 * calibration is ADDED to the press time (API.md §3). Subtracting the mean from
 * the current calibration therefore moves an early player's presses later,
 * which is what brings them to zero.
 */
export function suggestedCalibrationMs(
  state: ScoreState,
  currentCalibrationMs: number,
): number | null {
  const hits = state.judgedCount - state.counts.MISS;
  const mean = meanDeltaMs(state);
  if (hits < MIN_HITS_TO_CALIBRATE || mean === null) return null;
  if (Math.abs(mean) < CALIBRATION_DEADBAND_MS) return null;
  return Math.round(currentCalibrationMs - mean);
}
