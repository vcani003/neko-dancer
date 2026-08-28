/**
 * The playback contract. System design §11, amended by ADR-009.
 *
 * Everything the game knows about time arrives through this interface. Game
 * Core never sees it — ADR-007 says the engine takes a *number* — so this is
 * the only place that knows a video exists, and the seam that lets a click
 * track, a local file and a YouTube embed drive exactly the same engine.
 *
 * ## Why an adapter is loaded rather than constructed around a source
 *
 * §11 says `load(source)`, and the prototype did the opposite: it built a whole
 * new player per song. That is fine when a session is one song long and wrong
 * the moment there is a queue (§19) — every advance would tear down an iframe
 * and build another inside the ~15 second setup window, which is the part of a
 * round least able to afford it. An adapter here is a mounted player; `load`
 * cues a different video into it.
 */
import type { MediaSource } from '@neko/protocol';

/**
 * What the source is doing, as far as it will say.
 *
 * `buffering` is a state of its own and not a flavour of `playing`, because the
 * clock must stop while a video stalls. Reporting a stalled video as playing is
 * how notes expire against a frozen picture — the engine would go on judging
 * arrows the player cannot see. §11 lists only `isPlaying()`, which cannot
 * express this; ADR-009 records why the interface grew.
 *
 * `ended` is likewise not `paused`. A chart can outlive its video, and the run
 * has to be able to end on that fact rather than wait forever for arrows the
 * video will never reach — the deadlock in `PLAYTEST-FINDINGS.md` §7.
 */
export type PlaybackState = 'idle' | 'loading' | 'playing' | 'paused' | 'buffering' | 'ended';

export interface PlaybackAdapter {
  /**
   * Cue a source and resolve when it is ready to play.
   *
   * Rejects if the source cannot be played *here* — restrictions are
   * per-viewer, so this is an answer about this browser and no other.
   * Calling it a second time replaces whatever was loaded.
   */
  load(source: MediaSource): Promise<void>;

  play(): void;
  pause(): void;
  seek(timeMs: number): void;

  /** Position within the source, in milliseconds. Zero before it is ready. */
  currentTimeMs(): number;

  /** Total length in ms, or `null` while the source has not said. */
  durationMs(): number | null;

  state(): PlaybackState;

  /** §11's name for it. `state()` is the same answer with more resolution. */
  isReady(): boolean;
  isPlaying(): boolean;

  /** Release the player. An adapter is not usable afterwards. */
  dispose(): void;
}
