/**
 * A stored `Song` is already a `MediaSource` plus an id. The adapter only
 * wants the source — ADR-006: identity is `Song.id`, not something the
 * player invents.
 */
import type { MediaSource, Song } from '@neko/protocol';

export function mediaSourceOf(song: Song): MediaSource {
  return {
    provider: song.provider,
    providerMediaId: song.providerMediaId,
    title: song.title,
    creator: song.artist,
    durationMs: song.durationMs,
    ...(song.thumbnailUrl ? { thumbnailUrl: song.thumbnailUrl } : {}),
  };
}
