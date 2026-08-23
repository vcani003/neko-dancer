/**
 * `@neko/game-core` — timing, judgment, scoring.
 *
 * The one rule (ADR-007): **Game Core takes numbers.** It never imports
 * `PlaybackAdapter`, never holds a player, never calls `play()`. It is handed
 * `mediaTimeMs` and returns judgments. `@neko/protocol` is its only dependency,
 * and that is enforced by a test rather than trusted.
 *
 * Everything reachable from here is pure arithmetic over numbers and plain
 * data, which is why the whole package can be tested by passing `10_000`.
 */
export { MediaClock } from './MediaClock.ts';
export type { MediaClockOptions, MediaClockStats } from './MediaClock.ts';
export {
  DEFAULT_RESYNC_THRESHOLD_MS,
  DEFAULT_STALL_TIMEOUT_MS,
  DEFAULT_SLEW_RATE,
  DEFAULT_SLEW_DEADBAND_MS,
} from './MediaClock.ts';

export { judge } from './judge.ts';

export { noteEndMs } from './notes.ts';
export type { ActiveNote } from './notes.ts';

export { GameEngine } from './GameEngine.ts';
export type { EngineOptions, EngineState, ExpiredNote, PressResult } from './GameEngine.ts';

export {
  BASE_MULTIPLIER,
  BASE_POINTS,
  COMPLETION_BONUS,
  GRADE_THRESHOLDS,
  HEALTH_DELTA,
  HOLD_DROP_HEALTH_DELTA,
  KEEPS_COMBO,
  MAX_HEALTH,
  accuracy,
  comboMultiplier,
  grade,
  meanAbsDeltaMs,
  meanDeltaMs,
  nextGrade,
  suggestedCalibrationMs,
} from './ScoreSystem.ts';
export type { Grade, ScoreState } from './ScoreSystem.ts';

export { MIN_TAPS, fitTempo } from './tempo.ts';
export type { TempoFit } from './tempo.ts';
