/**
 * A playback source made of numbers. Part 4's determinism rule made concrete.
 *
 * **No automated test may require YouTube.** Everything the game does with time
 * is proven against this instead: the time is whatever the test says it is, and
 * it changes only when the test says so.
 *
 *     const fake = new FakePlaybackAdapter();
 *     await fake.load(fakeSource());
 *     fake.play();
 *     fake.setTime(10_000);        // the chart's note is at 10_000 → PERFECT
 *
 * There is deliberately no internal timer. A fake that advanced itself would
 * make every test depend on how long it took to run, which is the property a
 * fake exists to remove. Wall time never enters here; `setTime` and `advance`
 * are the only ways the clock moves.
 */
import type { MediaSource } from '@neko/protocol';
import type { PlaybackAdapter, PlaybackState } from './PlaybackAdapter.ts';

export interface FakePlaybackOptions {
  /** Reported by `durationMs()`. `null` models a source that will not say. */
  durationMs?: number | null;
  /** Make `load` reject, to exercise the unplayable-video path. */
  failLoad?: Error;
}

/** A `MediaSource` for tests, describing media that does not exist. */
export function fakeMediaSource(overrides: Partial<MediaSource> = {}): MediaSource {
  return {
    provider: 'clickTrack',
    providerMediaId: 'fake',
    title: 'Fake Source',
    ...overrides,
  };
}

export class FakePlaybackAdapter implements PlaybackAdapter {
  private timeMs = 0;
  private playbackState: PlaybackState = 'idle';
  private loaded: MediaSource | null = null;
  private duration: number | null;
  private readonly failLoad: Error | undefined;

  /** Every call made on this adapter, in order. Assert against it. */
  readonly calls: string[] = [];

  constructor(options: FakePlaybackOptions = {}) {
    this.duration = options.durationMs ?? null;
    this.failLoad = options.failLoad;
  }

  async load(source: MediaSource): Promise<void> {
    this.calls.push(`load:${source.provider}:${source.providerMediaId}`);
    if (this.failLoad) {
      this.playbackState = 'idle';
      throw this.failLoad;
    }
    this.loaded = source;
    this.timeMs = 0;
    this.playbackState = 'paused';
    if (source.durationMs !== undefined) this.duration = source.durationMs;
  }

  play(): void {
    this.calls.push('play');
    if (this.loaded) this.playbackState = 'playing';
  }

  pause(): void {
    this.calls.push('pause');
    if (this.playbackState === 'playing') this.playbackState = 'paused';
  }

  seek(timeMs: number): void {
    this.calls.push(`seek:${timeMs}`);
    // Clamped at zero because a real player cannot hold a negative position,
    // and a test that could produce one would be proving something no source
    // can do.
    this.timeMs = Math.max(0, timeMs);
  }

  currentTimeMs(): number {
    return this.timeMs;
  }

  durationMs(): number | null {
    return this.duration;
  }

  state(): PlaybackState {
    return this.playbackState;
  }

  isReady(): boolean {
    return this.loaded !== null;
  }

  isPlaying(): boolean {
    return this.playbackState === 'playing';
  }

  dispose(): void {
    this.calls.push('dispose');
    this.loaded = null;
    this.playbackState = 'idle';
  }

  // ---------------------------------------------------------- test control --

  /** Put the clock exactly here. */
  setTime(timeMs: number): void {
    this.timeMs = timeMs;
  }

  /** Move the clock forward, the way a frame loop would. */
  advance(deltaMs: number): void {
    this.timeMs += deltaMs;
  }

  /**
   * Stall, the way a real source does mid-song.
   *
   * The clock keeps its position and stops being `playing`, which is what makes
   * a buffering video distinguishable from a playing one that has not ticked.
   */
  buffer(): void {
    this.playbackState = 'buffering';
  }

  /** The source has run out. The run must be able to end on this. */
  end(): void {
    this.playbackState = 'ended';
  }

  setDurationMs(durationMs: number | null): void {
    this.duration = durationMs;
  }
}
