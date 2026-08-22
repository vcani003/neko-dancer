/**
 * The game loop's core.
 *
 *   playbackTime = clock.getTimeMs()
 *   a key was pressed in a lane -> judge it against the nearest arrow there
 *   an arrow's window closed    -> miss
 *
 * Same shape as hop//beat's engine, and for the same reason: it takes the time
 * an input HAPPENED rather than the time the loop next runs, and it does not
 * advance while playback is stopped. No DOM, no input library, no renderer.
 */
import type { GameClock } from './GameClock.ts';
import type { Chart, Lane } from '../charts/schema.ts';
import {
  DEFAULT_WINDOWS,
  collectExpiredArrows,
  findClaimableArrow,
  judgeDelta,
  toActiveArrows,
  type ActiveArrow,
  type Judgment,
  type TimingWindows,
} from './LaneJudge.ts';
import {
  applyCompletionBonus,
  applyJudgment,
  applyWrongKey,
  initialScoreState,
  type ScoreState,
} from './ScoreSystem.ts';

export interface JudgmentEvent {
  arrowId: string | null;
  lane: Lane;
  judgment: Judgment | null;
  /** Signed: negative early, positive late. Null for an expiry or a wrong key. */
  deltaMs: number | null;
  playbackTimeMs: number;
  /** True when a key was pressed with nothing to claim. */
  wrongKey?: boolean;
}

export interface GameEngineOptions {
  windows?: TimingWindows;
}

export class GameEngine {
  private clock: GameClock;
  private chart: Chart;
  private windows: TimingWindows;
  private arrows: ActiveArrow[];
  private score: ScoreState = initialScoreState();
  private cursor = 0;
  private completed = false;

  constructor(clock: GameClock, chart: Chart, options: GameEngineOptions = {}) {
    this.clock = clock;
    this.chart = chart;
    this.windows = options.windows ?? DEFAULT_WINDOWS;
    this.arrows = toActiveArrows(chart);
  }

  getArrows(): readonly ActiveArrow[] {
    return this.arrows;
  }

  getScore(): ScoreState {
    return this.score;
  }

  getChart(): Chart {
    return this.chart;
  }

  getWindows(): TimingWindows {
    return this.windows;
  }

  isComplete(): boolean {
    return this.arrows.every((a) => a.judgment !== null);
  }

  reset(): void {
    this.arrows = toActiveArrows(this.chart);
    this.score = initialScoreState();
    this.cursor = 0;
    this.completed = false;
  }

  /**
   * A key was pressed in a lane.
   *
   * @param atMs when the press HAPPENED, in wall-clock terms. Judged against
   *   the playback position at that instant rather than at the next frame — a
   *   keypress is precise, and rounding it up to the next render would throw
   *   away most of what makes a keyboard better than a camera here.
   */
  pressLane(lane: Lane, atMs: number): JudgmentEvent | null {
    if (!this.clock.isRunning() || this.score.failed) return null;

    const playbackTimeMs = this.clock.playbackTimeAtMs(atMs);
    const claimed = findClaimableArrow(this.arrows, lane, playbackTimeMs, this.windows);

    // Nothing to hit. Unlike hop//beat — where extra movement was free, because
    // moving is the point — a keypress is deliberate, and the original drains
    // health for a wrong key.
    if (!claimed) {
      this.score = applyWrongKey(this.score);
      return { arrowId: null, lane, judgment: null, deltaMs: null, playbackTimeMs, wrongKey: true };
    }

    const deltaMs = playbackTimeMs - claimed.timeMs;
    const judgment = judgeDelta(Math.abs(deltaMs), this.windows);
    claimed.judgment = judgment;
    claimed.deltaMs = deltaMs;
    this.score = applyJudgment(this.score, judgment, deltaMs);
    this.advanceCursor();

    return { arrowId: claimed.arrow.id, lane, judgment, deltaMs, playbackTimeMs };
  }

  /** Retire arrows whose window has closed. Call once per frame. */
  update(): JudgmentEvent[] {
    if (!this.clock.isRunning() || this.score.failed) return [];

    const playbackTimeMs = this.clock.getTimeMs();
    const expired = collectExpiredArrows(this.arrows, playbackTimeMs, this.windows);

    const events: JudgmentEvent[] = [];
    for (const active of expired) {
      active.judgment = 'MISS';
      this.score = applyJudgment(this.score, 'MISS', 0);
      events.push({
        arrowId: active.arrow.id,
        lane: active.arrow.lane,
        judgment: 'MISS',
        deltaMs: null,
        playbackTimeMs,
      });
    }

    // The completion bonus is paid once, when the last arrow settles and the
    // player is still alive.
    if (!this.completed && this.isComplete() && !this.score.failed) {
      this.completed = true;
      this.score = applyCompletionBonus(this.score);
    }

    this.advanceCursor();
    return events;
  }

  /** Charts are sorted, so settled leading arrows never need looking at again. */
  private advanceCursor(): void {
    while (this.cursor < this.arrows.length && this.arrows[this.cursor].judgment !== null) {
      this.cursor += 1;
    }
  }

  pendingArrows(): readonly ActiveArrow[] {
    return this.arrows.slice(this.cursor);
  }
}
