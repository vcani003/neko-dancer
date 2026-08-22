import type { Chart, Lane } from '../src/charts/schema.ts';
import type { PlaybackAdapter, PlaybackState } from '../src/playback/PlaybackAdapter.ts';

/** A playback source whose reported time only moves when a test says so. */
export class FakeAdapter implements PlaybackAdapter {
  timeMs = 0;
  state: PlaybackState = 'playing';
  play() {}
  pause() {}
  getCurrentTimeMs() { return this.timeMs; }
  getState() { return this.state; }
  getDurationMs() { return 120_000; }
  dispose() {}
}

export const arrow = (id: string, timeMs: number, lane: Lane = 'left') =>
  ({ id, timeMs, lane, type: 'tap' as const });

export const chartWith = (arrows: ReturnType<typeof arrow>[], offsetMs = 0): Chart => ({
  schemaVersion: 1,
  song: { id: 's', title: 'T', artist: 'A', playback: { provider: 'clickTrack', bpm: 120 } },
  analysis: { bpm: 120, offsetMs, generatorVersion: 'test' },
  difficulty: 'normal',
  source: 'handmade',
  arrows,
});
