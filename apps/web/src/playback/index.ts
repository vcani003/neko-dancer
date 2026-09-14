/**
 * The playback layer. System design §11, ADR-006, ADR-007, ADR-009.
 *
 * One rule holds the whole thing together: **Game Core never sees any of
 * this.** The engine is handed `mediaTimeMs`, a number, and cannot start, stop
 * or seek anything. Everything that knows a video exists is behind this file,
 * which is why a click track, a local file and a YouTube embed drive the same
 * engine, and why the engine can be tested by passing `10_000`.
 */
export type { PlaybackAdapter, PlaybackState } from './PlaybackAdapter.ts';
export type { MediaProvider, ResolveFailure } from './MediaProvider.ts';
export { MediaResolveError } from './MediaProvider.ts';

export { YouTubeProvider, youTubeVideoId, fetchOEmbed } from './YouTubeProvider.ts';
export type { OEmbedFetch, YouTubeProviderOptions } from './YouTubeProvider.ts';

export { YouTubeAdapter, LoadReplacedError, DEFAULT_LOAD_TIMEOUT_MS } from './YouTubeAdapter.ts';
export type { YouTubeAdapterOptions } from './YouTubeAdapter.ts';

export { YouTubePlaybackError, describeYouTubeError, youTubeError } from './YouTubeErrors.ts';
export { YT_STATE, loadYouTubeApi } from './YouTubeApi.ts';
export type { YouTubeApi, YouTubePlayer, YouTubePlayerOptions } from './YouTubeApi.ts';

export { checkVideoPlayable, DEFAULT_SETTLE_MS } from './checkVideoPlayable.ts';
export type { VideoCheck, CheckOptions } from './checkVideoPlayable.ts';

export { FakePlaybackAdapter, fakeMediaSource } from './FakePlaybackAdapter.ts';
export type { FakePlaybackOptions } from './FakePlaybackAdapter.ts';

export { RealtimeAdapter } from './RealtimeAdapter.ts';
