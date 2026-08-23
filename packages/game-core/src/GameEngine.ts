/**
 * The round.
 *
 *   the media is at T          -> notes whose window closed unhit are misses
 *   a key went down in a lane  -> judge it against the nearest note there
 *   a key came up              -> settle the hold it was sustaining, if any
 *
 * Same shape as the prototype's engine, and for the same reasons: it takes the
 * time an input HAPPENED rather than the time the loop next runs, and it never
 * looks back at a note it has passed.
 *
 * **It takes a number, not a player.** ADR-007. The old version held a
 * `GameClock`, which held a `PlaybackAdapter`, which held a YouTube iframe; this
 * one is handed `mediaTimeMs` and can therefore be driven by passing `10_000`.
 * Nothing here can start, stop or seek anything, so it cannot fight the UI over
 * playback state.
 */
import type {
  ChartRevision,
  Judgment,
  JudgmentWindows,
  Lane,
  Note,
  PlayerProgress,
  RoundResult,
} from '@neko/protocol';
import { DEFAULT_WINDOWS } from '@neko/protocol';
import { judge } from './judge.ts';
import {
  findClaimable,
  isHold,
  noteEndMs,
  trackNotes,
  type ActiveNote,
  type TrackedNote,
} from './notes.ts';
import {
  accuracy,
  applyCompletionBonus,
  applyHoldSustain,
  applyJudgment,
  countWrongKey,
  grade,
  initialScoreState,
  meanAbsDeltaMs,
  meanDeltaMs,
  type Grade,
  type ScoreState,
} from './ScoreSystem.ts';

export interface EngineOptions {
  revision: ChartRevision;
  windows?: JudgmentWindows;
  /**
   * The player's calibration. System design §13, and the second of the three
   * offsets.
   *
   * ADDED TO THE PLAYER'S PRESS TIME. A player who consistently hits 50 ms
   * early sets `+50`, which moves their presses later and lands them on the
   * note. It never touches the chart, and the chart's timing map never reaches
   * this class at all — note times are already absolute (ADR-003).
   *
   * It is applied to `update` as well as to `press`, which API.md does not say
   * and which is not a second rule but the same one: calibration shifts the
   * PLAYER'S timeline, and expiry is the deadline that timeline is measured
   * against. Applying it to presses only would strand a consistently-late
   * player — with `-50`, a press at 200 ms judges as 150 ms and is inside the
   * `OKAY` window, but the note it was aimed at expired at 160 ms and is gone.
   * Rendering deliberately stays on raw media time; see `visible`.
   */
  calibrationMs?: number;
}

export interface PressResult {
  judgment: Judgment;
  /** Signed: negative early, positive late. After calibration. */
  deltaMs: number;
  /**
   * Declared `string | null` by API.md. In practice always a note id: a press
   * with nothing in range returns `null` for the whole result rather than a
   * result with no note, because it is not a miss and there is nothing to
   * report about it.
   *
   * So this is never null — and saying `string | null` made every consumer
   * handle a case that cannot happen. A type that under-states what the code
   * guarantees is the same defect as a type that over-states it: both make the
   * compiler stop being able to help.
   */
  noteId: string;
}

/** A note that ran out of time. */
export interface ExpiredNote {
  readonly note: Note;
  /**
   * Always `MISS`, and typed as the literal so the comment cannot drift from
   * the type. Named rather than implied so a renderer can feed an expiry and a
   * judged press through the same code path.
   */
  readonly judgment: 'MISS';
  /** The media time it was retired at — `update`'s own argument, calibrated. */
  readonly mediaTimeMs: number;
}

/** The live numbers. A superset of what a room broadcasts as `PlayerProgress`. */
export interface EngineState extends PlayerProgress {
  readonly maxCombo: number;
  readonly failed: boolean;
  /** Every note settled, with the player still alive. */
  readonly completed: boolean;
  readonly counts: Readonly<Record<Judgment, number>>;
  readonly judgedCount: number;
  readonly noteCount: number;
  readonly wrongKeys: number;
  readonly holdsDropped: number;
  readonly meanAbsDeltaMs: number | null;
  readonly meanDeltaMs: number | null;
  readonly grade: Grade;
}

/**
 * How long a note stays worth drawing after its own instant.
 *
 * Long enough that the judgment banner and the note it belongs to are on screen
 * together; short enough that the receptor is not permanently cluttered.
 */
const TRAIL_MS = 150;

export class GameEngine {
  private windows: JudgmentWindows;
  private calibrationMs: number;
  private tracked: TrackedNote[];
  private score: ScoreState = initialScoreState();
  /** Index of the earliest note that is not settled. Never moves backwards. */
  private cursor = 0;
  private completed = false;
  /** The hold currently being sustained in each lane, if any. */
  private holds = new Map<Lane, TrackedNote>();

  constructor(options: EngineOptions) {
    this.windows = options.windows ?? DEFAULT_WINDOWS;
    this.calibrationMs = options.calibrationMs ?? 0;
    // Note order is validated upstream by `validateChartRevision`, which is why
    // this can walk forward and never look back.
    this.tracked = trackNotes(options.revision.notes);
  }

  /**
   * Advance to this moment. Returns notes that have just expired unhit.
   *
   * Idempotent for a given time, and safe to call with a time that has not
   * moved: a stalled clock calls this repeatedly with the same number, and the
   * second call finds everything already settled.
   */
  update(mediaTimeMs: number): readonly ExpiredNote[] {
    // A failed run stops judging. Health reaching zero ends the run, and
    // continuing to retire notes afterwards would keep changing a score nobody
    // can affect any more.
    if (this.score.failed) return [];

    const atMs = mediaTimeMs + this.calibrationMs;
    const expired: ExpiredNote[] = [];

    for (let i = this.cursor; i < this.tracked.length; i++) {
      const active = this.tracked[i];
      if (!active) break;
      // Nothing beyond here can have expired, and nothing beyond here can be a
      // hold in progress — a hold cannot be held before it is reachable.
      if (active.note.timeMs > atMs + this.windows.okayMs) break;
      if (active.settled) continue;

      if (active.judgment === null) {
        // Only missed once the player can no longer reach it. Marking earlier
        // would steal presses they were still entitled to make.
        if (atMs > active.note.timeMs + this.windows.okayMs) {
          active.judgment = 'MISS';
          active.settled = true;
          this.score = applyJudgment(this.score, 'MISS', 0);
          expired.push({ note: active.note, judgment: 'MISS', mediaTimeMs: atMs });
        }
        continue;
      }

      // A hold still held when its tail passes is held in full. Settling it at
      // its own end rather than at `atMs` keeps the credited fraction at
      // exactly 1 regardless of how late the frame that noticed arrives.
      if (active.holding && isHold(active.note)) {
        const endMs = noteEndMs(active.note);
        if (atMs >= endMs) this.settleHold(active, endMs);
      }
    }

    this.advanceCursor();
    this.payCompletionBonus();
    return expired;
  }

  /**
   * A key went down.
   *
   * `atMediaTimeMs` is when it went down, not when it was handled. A keypress
   * is precise, and rounding it up to the next rendered frame would throw away
   * most of what makes a keyboard better than a camera here — a frame of
   * handling delay must not become 16 ms of error.
   *
   * Returns `null` when there was nothing in range. That is not a miss:
   * mashing an empty lane costs nothing but wastes the press.
   */
  press(lane: Lane, atMediaTimeMs: number): PressResult | null {
    if (this.isOver()) return null;

    const atMs = atMediaTimeMs + this.calibrationMs;
    const claimed = findClaimable(this.tracked, this.cursor, lane, atMs, this.windows);
    if (!claimed) {
      this.score = countWrongKey(this.score);
      return null;
    }

    const deltaMs = atMs - claimed.note.timeMs;
    // `findClaimable` bounds by `okayMs`, so this is never a MISS.
    const judgment = judge(Math.abs(deltaMs), this.windows);
    claimed.judgment = judgment;
    claimed.deltaMs = deltaMs;

    if (isHold(claimed.note)) {
      // The start is judged exactly like a tap; the sustain is settled later,
      // by `release` or by the tail passing in `update`.
      claimed.holding = true;
      claimed.heldFraction = 0;
      this.holds.set(lane, claimed);
    } else {
      claimed.settled = true;
    }

    this.score = applyJudgment(this.score, judgment, deltaMs);
    this.advanceCursor();
    this.payCompletionBonus();

    return { judgment, deltaMs, noteId: claimed.note.id };
  }

  /** A key came up. Only meaningful for holds; safe to call otherwise. */
  release(lane: Lane, atMediaTimeMs: number): void {
    if (this.score.failed) return;
    const held = this.holds.get(lane);
    if (!held) return;

    this.settleHold(held, atMediaTimeMs + this.calibrationMs);
    this.advanceCursor();
    this.payCompletionBonus();
  }

  /**
   * Notes worth drawing right now, nearest first.
   *
   * On RAW media time, with no calibration applied. Calibration compensates for
   * a player's input arriving early or late; the note itself belongs where the
   * music puts it, and shifting the picture as well would move the target the
   * player is calibrating against.
   */
  visible(mediaTimeMs: number, leadMs: number): readonly ActiveNote[] {
    const showing: TrackedNote[] = [];
    for (const active of this.tracked) {
      const remaining = active.note.timeMs - mediaTimeMs;
      if (remaining > leadMs) break;
      // A hold stays on screen for its whole tail, not just for its head.
      if (noteEndMs(active.note) + TRAIL_MS < mediaTimeMs) continue;
      showing.push(active);
    }
    return showing.sort(
      (a, b) =>
        Math.abs(a.note.timeMs - mediaTimeMs) - Math.abs(b.note.timeMs - mediaTimeMs),
    );
  }

  state(): EngineState {
    return {
      score: this.score.score,
      combo: this.score.combo,
      accuracy: accuracy(this.score),
      health: this.score.health,
      maxCombo: this.score.maxCombo,
      failed: this.score.failed,
      completed: this.isComplete() && !this.score.failed,
      counts: this.score.counts,
      judgedCount: this.score.judgedCount,
      noteCount: this.tracked.length,
      wrongKeys: this.score.wrongKeys,
      holdsDropped: this.score.holdsDropped,
      meanAbsDeltaMs: meanAbsDeltaMs(this.score),
      meanDeltaMs: meanDeltaMs(this.score),
      grade: grade(this.score),
    };
  }

  /**
   * True once the run is over — completed OR failed.
   *
   * This is the signal a screen should watch. Health reaching zero stops
   * judgment, so a failed run never finishes its chart and would otherwise sit
   * on the play screen for ever waiting for a completion that cannot arrive.
   */
  isOver(): boolean {
    return this.score.failed || this.isComplete();
  }

  result(): RoundResult {
    return {
      score: this.score.score,
      combo: this.score.combo,
      accuracy: accuracy(this.score),
      health: this.score.health,
      maxCombo: this.score.maxCombo,
      counts: this.score.counts,
      // A failed run never reports `completed: true`, whatever else is true of
      // it. The server stores this claim without verifying it (§25), so it is
      // the one field that must not be able to say something flattering.
      completed: !this.score.failed && this.isComplete(),
    };
  }

  /** Every note settled: judged, and — for a hold — its sustain resolved too. */
  private isComplete(): boolean {
    return this.cursor >= this.tracked.length;
  }

  /**
   * Credit a hold's sustain by the fraction of its duration that was held.
   *
   * FIRST VERSION, deliberately. API.md §4: missing the start misses the whole
   * hold, releasing early ends it and scores the fraction, still holding at the
   * end scores it in full. Re-grabbing a dropped hold and partial-credit curves
   * are Phase 8 — a dropped hold here is over, and pressing the lane again will
   * look for the next note rather than resuming this one.
   *
   * The fraction is measured from the note's own start, not from the press that
   * claimed it, so a player who grabbed the hold 30 ms late is not charged for
   * those 30 ms twice — once in the start judgment and again in the sustain.
   */
  private settleHold(active: TrackedNote, atMs: number): void {
    if (!isHold(active.note)) return;
    const fraction = (atMs - active.note.timeMs) / active.note.durationMs;
    const held = Math.min(1, Math.max(0, fraction));

    active.heldFraction = held;
    active.holding = false;
    active.settled = true;
    this.holds.delete(active.note.lane);
    this.score = applyHoldSustain(this.score, active.judgment ?? 'MISS', held);
  }

  /** Charts are ordered, so settled leading notes never need looking at again. */
  private advanceCursor(): void {
    while (this.cursor < this.tracked.length && this.tracked[this.cursor]?.settled === true) {
      this.cursor += 1;
    }
  }

  /** Paid once, when the last note settles and the player is still alive. */
  private payCompletionBonus(): void {
    if (this.completed || this.score.failed || !this.isComplete()) return;
    this.completed = true;
    this.score = applyCompletionBonus(this.score);
  }
}
