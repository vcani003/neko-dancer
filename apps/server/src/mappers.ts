/**
 * Rows to domain values. Every read goes through a validator, because
 * stored data outlives the code that wrote it — `ENGINEERING.md` §0.
 */
import {
  asId,
  cleanDisplayName,
  MEDIA_PROVIDERS,
  validateBeatmapMetadata,
  validateChartRevision,
  validateRoundResult,
  type Beatmap,
  type BeatmapId,
  type ChartRevision,
  type LibraryEntry,
  type MediaProviderName,
  type RevisionId,
  type ScoreId,
  type Song,
  type SongId,
  type StoredScore,
  type User,
  type UserId,
} from '@neko/protocol';
import { ValidationError } from './errors.ts';
import type { beatmaps, chartRevisions, libraryEntries, scores, songs, users } from './db/schema.ts';

export function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function requireId<T extends UserId | SongId | BeatmapId | RevisionId | ScoreId>(
  value: string,
  kind: string,
): T {
  const id = asId<T>(value);
  if (!id) throw new ValidationError([`Stored ${kind} id is not a uuid.`]);
  return id;
}

export function toUser(row: typeof users.$inferSelect): User {
  return {
    id: requireId<UserId>(row.id, 'user'),
    displayName: cleanDisplayName(row.displayName),
    createdAtIso: iso(row.createdAt),
  };
}

export function toSong(row: typeof songs.$inferSelect): Song {
  if (!MEDIA_PROVIDERS.includes(row.provider as MediaProviderName)) {
    throw new ValidationError([`Stored song has unknown provider "${row.provider}".`]);
  }
  return {
    id: requireId<SongId>(row.id, 'song'),
    provider: row.provider as MediaProviderName,
    providerMediaId: row.providerMediaId,
    title: row.title,
    artist: row.artist,
    durationMs: row.durationMs,
    ...(row.thumbnailUrl ? { thumbnailUrl: row.thumbnailUrl } : {}),
    createdAtIso: iso(row.createdAt),
  };
}

export function toBeatmap(row: typeof beatmaps.$inferSelect): Beatmap {
  const meta = validateBeatmapMetadata({
    title: row.title ?? undefined,
    difficulty: row.difficulty,
    status: row.status,
    tags: row.tags,
  });
  if (!meta.ok) throw new ValidationError(meta.errors);

  return {
    id: requireId<BeatmapId>(row.id, 'beatmap'),
    songId: requireId<SongId>(row.songId, 'song'),
    authorId: requireId<UserId>(row.authorId, 'user'),
    ...(meta.value.title ? { title: meta.value.title } : {}),
    difficulty: meta.value.difficulty,
    tags: meta.value.tags,
    status: meta.value.status,
    ...(row.currentRevisionId
      ? { currentRevisionId: requireId<RevisionId>(row.currentRevisionId, 'revision') }
      : {}),
    createdAtIso: iso(row.createdAt),
    ...(row.publishedAt ? { publishedAtIso: iso(row.publishedAt) } : {}),
    ...(row.forkedFromBeatmapId
      ? { forkedFromBeatmapId: requireId<BeatmapId>(row.forkedFromBeatmapId, 'beatmap') }
      : {}),
    ...(row.forkedFromRevisionId
      ? { forkedFromRevisionId: requireId<RevisionId>(row.forkedFromRevisionId, 'revision') }
      : {}),
  };
}

export function toRevision(row: typeof chartRevisions.$inferSelect): ChartRevision {
  const checked = validateChartRevision({
    id: row.id,
    beatmapId: row.beatmapId,
    schemaVersion: row.schemaVersion,
    revision: row.revision,
    timing: row.timing,
    notes: row.notes,
    ...(row.generatorVersion ? { generatorVersion: row.generatorVersion } : {}),
    ...(row.generatorSeed !== null ? { generatorSeed: row.generatorSeed } : {}),
    createdAtIso: iso(row.createdAt),
  });
  if (!checked.ok) throw new ValidationError(checked.errors);
  return checked.value;
}

export function toLibraryEntry(row: typeof libraryEntries.$inferSelect): LibraryEntry {
  return {
    userId: requireId<UserId>(row.userId, 'user'),
    beatmapId: requireId<BeatmapId>(row.beatmapId, 'beatmap'),
    savedAtIso: iso(row.savedAt),
  };
}

export function toScore(row: typeof scores.$inferSelect): StoredScore {
  const result = validateRoundResult({
    score: row.score,
    combo: row.combo,
    accuracy: row.accuracy,
    health: row.health,
    maxCombo: row.maxCombo,
    counts: row.counts,
    completed: row.completed,
  });
  if (!result.ok) throw new ValidationError(result.errors);
  return {
    id: requireId<ScoreId>(row.id, 'score'),
    userId: requireId<UserId>(row.userId, 'user'),
    revisionId: requireId<RevisionId>(row.revisionId, 'revision'),
    result: result.value,
    createdAtIso: iso(row.createdAt),
  };
}
