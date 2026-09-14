/**
 * A clock that moves with wall time. For click-track charts, and for any
 * source that is not a video player.
 *
 * `now` is injected so a test can drive it. The browser passes
 * `performance.now`. There is no audio here — that is a later courtesy.
 */
import type { MediaSource } from '@neko/protocol';
import type { PlaybackAdapter, PlaybackState } from './PlaybackAdapter.ts';

export class RealtimeAdapter implements PlaybackAdapter {
  private readonly now: () => number;
  private duration: number | null;
  private loaded: MediaSource | null = null;
  private playbackState: PlaybackState = 'idle';
  private originMs = 0;
  private heldMs = 0;

  constructor(options: { now: () => number; durationMs?: number | null } ) {
    this.now = options.now;
    this.duration = options.durationMs ?? null;
  }

  async load(source: MediaSource): Promise<void> {
    this.loaded = source;
    this.heldMs = 0;
    this.originMs = 0;
    this.playbackState = 'paused';
    if (source.durationMs !== undefined) this.duration = source.durationMs;
  }

  play(): void {
    if (!this.loaded) return;
    this.originMs = this.now() - this.heldMs;
    this.playbackState = 'playing';
  }

  pause(): void {
    if (this.playbackState !== 'playing') return;
    this.heldMs = this.currentTimeMs();
    this.playbackState = 'paused';
  }

  seek(timeMs: number): void {
    this.heldMs = Math.max(0, timeMs);
    if (this.playbackState === 'playing') this.originMs = this.now() - this.heldMs;
  }

  currentTimeMs(): number {
    if (this.playbackState === 'playing') return Math.max(0, this.now() - this.originMs);
    return this.heldMs;
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
    this.loaded = null;
    this.playbackState = 'idle';
  }
}
