/**
 * One single-player run. Phase 4.
 *
 *     library → choose → preload → countdown → play → results
 *
 * The session owns the *order*. It does not own time: the adapter is the
 * media clock, the caller is the wall clock. A test drives both. That is
 * the Phase 4 gate — a scripted sequence, no network, a known final score.
 *
 * Game Core never sees the adapter (ADR-007). Countdown is a delay, not a
 * timestamp (ADR-002).
 */
import { GameEngine, type ActiveNote, type EngineState, type PressResult } from '@neko/game-core';
import {
  COUNTDOWN_MS,
  type BeatmapSummary,
  type Lane,
  type PlayableChart,
  type RevisionId,
  type RoundResult,
  type UserId,
} from '@neko/protocol';
import type { PlaybackAdapter } from '../playback/PlaybackAdapter.ts';
import type { Catalog } from './Catalog.ts';
import { mediaSourceOf } from './media.ts';

export type PlayPhase = 'idle' | 'ready' | 'countdown' | 'playing' | 'finished';

export class PlaySession {
  readonly catalog: Catalog;
  readonly adapter: PlaybackAdapter;
  readonly countdownMs: number;

  private phase: PlayPhase = 'idle';
  private chart: PlayableChart | null = null;
  private engine: GameEngine | null = null;
  private countdownStartedAt: number | null = null;
  private spectating = false;

  constructor(options: { catalog: Catalog; adapter: PlaybackAdapter; countdownMs?: number }) {
    this.catalog = options.catalog;
    this.adapter = options.adapter;
    this.countdownMs = options.countdownMs ?? COUNTDOWN_MS;
  }

  currentPhase(): PlayPhase {
    return this.phase;
  }

  isSpectating(): boolean {
    return this.spectating;
  }

  playable(): PlayableChart | null {
    return this.chart;
  }

  progress(): EngineState | null {
    return this.engine ? this.engine.state() : null;
  }

  /** Milliseconds left on the countdown, or 0 once it has fired. */
  countdownRemainingMs(atWallMs: number): number {
    if (this.phase !== 'countdown' || this.countdownStartedAt === null) return 0;
    return Math.max(0, this.countdownMs - (atWallMs - this.countdownStartedAt));
  }

  /**
   * Notes worth drawing, on the adapter's media time. Calibration does
   * not move the picture — Game Core's `visible` is the reason.
   */
  visible(leadMs: number): readonly ActiveNote[] {
    if (!this.engine) return [];
    return this.engine.visible(this.adapter.currentTimeMs(), leadMs);
  }

  async list(): Promise<BeatmapSummary[]> {
    return this.catalog.listPublished();
  }

  /**
   * Cue this revision. Does not start playback. Staging plays drafts;
   * Public only hands us published ones. Preload is its own step so a
   * later multiplayer preflight can sit here.
   */
  async choose(revisionId: RevisionId): Promise<PlayableChart> {
    const chart = await this.catalog.getPlayable(revisionId);
    if (!chart) throw new Error('No such chart.');
    if (!chart.revision) throw new Error('That beatmap has no revision yet.');
    await this.adapter.load(mediaSourceOf(chart.song));
    this.chart = chart;
    this.engine = new GameEngine({ revision: chart.revision });
    this.phase = 'ready';
    this.countdownStartedAt = null;
    this.spectating = false;
    return chart;
  }

  /** ADR-002: a duration from this moment, never a server timestamp. */
  beginCountdown(atWallMs: number): void {
    if (this.phase !== 'ready') throw new Error('Nothing is ready to play.');
    this.phase = 'countdown';
    this.countdownStartedAt = atWallMs;
  }

  /**
   * Join a song already in progress. Notes still draw. Presses do not
   * count. The engine is not advanced, so late notes are not scored as
   * misses against a run that is not theirs.
   */
  beginSpectate(elapsedMs: number): void {
    if (this.phase !== 'ready') throw new Error('Nothing is ready to play.');
    this.spectating = true;
    this.adapter.seek(Math.max(0, elapsedMs));
    this.adapter.play();
    this.phase = 'playing';
  }

  /**
   * Advance the session to this wall time.
   *
   * During countdown, crossing `countdownMs` calls `play()` and starts the
   * engine. During play, the adapter's media time is handed to the engine
   * as a number. The session never asks the system clock.
   */
  tick(atWallMs: number): void {
    if (this.phase === 'countdown') {
      const started = this.countdownStartedAt;
      if (started !== null && atWallMs - started >= this.countdownMs) {
        this.adapter.play();
        this.phase = 'playing';
      } else {
        return;
      }
    }
    if (this.phase !== 'playing' || !this.engine) return;
    if (this.spectating) {
      const duration = this.adapter.durationMs() ?? this.chart?.song.durationMs ?? Infinity;
      if (this.adapter.state() === 'ended' || this.adapter.currentTimeMs() >= duration) {
        this.adapter.pause();
        this.phase = 'finished';
      }
      return;
    }
    this.engine.update(this.adapter.currentTimeMs());
    const duration = this.adapter.durationMs() ?? this.chart?.song.durationMs ?? Infinity;
    const time = this.adapter.currentTimeMs();
    const mediaEnded = this.adapter.state() === 'ended' || (duration > 1_000 && time >= duration);
    if (this.engine.isOver() || mediaEnded) {
      this.adapter.pause();
      this.phase = 'finished';
    }
  }

  press(lane: Lane): PressResult | null {
    if (this.spectating || this.phase !== 'playing' || !this.engine) return null;
    const result = this.engine.press(lane, this.adapter.currentTimeMs());
    this.tickAfterInput();
    return result;
  }

  result(): RoundResult | null {
    if (!this.engine || (this.phase !== 'finished' && !this.engine.isOver())) return null;
    return this.engine.result();
  }

  async saveResult(userId: UserId): Promise<void> {
    if (this.spectating) return;
    const result = this.result();
    const chart = this.chart;
    if (!result || !chart || !this.catalog.recordScore) return;
    await this.catalog.recordScore(userId, chart.revision.id, result);
  }

  private tickAfterInput(): void {
    if (!this.engine) return;
    if (this.engine.isOver()) {
      this.adapter.pause();
      this.phase = 'finished';
    }
  }
}
