/**
 * Drizzle tables for the domain in `@neko/protocol`.
 *
 * Song → Beatmap → ChartRevision, plus the people who write them, the
 * references they save, and the scores they claim. Playlists stay out of
 * MVP 1. `current_revision_id` is a uuid without a foreign key so the
 * beatmap and revision tables do not have to create each other.
 */
import { boolean, integer, jsonb, pgTable, primaryKey, real, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import type { Judgment, Note, TimingMap } from '@neko/protocol';

const stamps = {
  withTimezone: true,
  mode: 'date',
} as const;

export const users = pgTable('users', {
  id: uuid('id').primaryKey(),
  displayName: text('display_name').notNull(),
  createdAt: timestamp('created_at', stamps).notNull(),
});

export const songs = pgTable(
  'songs',
  {
    id: uuid('id').primaryKey(),
    provider: text('provider').notNull(),
    providerMediaId: text('provider_media_id').notNull(),
    title: text('title').notNull(),
    artist: text('artist').notNull(),
    durationMs: integer('duration_ms').notNull(),
    thumbnailUrl: text('thumbnail_url'),
    createdAt: timestamp('created_at', stamps).notNull(),
  },
  (table) => [unique('songs_provider_media').on(table.provider, table.providerMediaId)],
);

export const beatmaps = pgTable('beatmaps', {
  id: uuid('id').primaryKey(),
  songId: uuid('song_id')
    .notNull()
    .references(() => songs.id),
  authorId: uuid('author_id')
    .notNull()
    .references(() => users.id),
  title: text('title'),
  difficulty: text('difficulty').notNull(),
  tags: jsonb('tags').$type<string[]>().notNull(),
  status: text('status').notNull(),
  currentRevisionId: uuid('current_revision_id'),
  createdAt: timestamp('created_at', stamps).notNull(),
  publishedAt: timestamp('published_at', stamps),
  forkedFromBeatmapId: uuid('forked_from_beatmap_id'),
  forkedFromRevisionId: uuid('forked_from_revision_id'),
});

export const chartRevisions = pgTable(
  'chart_revisions',
  {
    id: uuid('id').primaryKey(),
    beatmapId: uuid('beatmap_id')
      .notNull()
      .references(() => beatmaps.id),
    schemaVersion: integer('schema_version').notNull(),
    revision: integer('revision').notNull(),
    timing: jsonb('timing').$type<TimingMap>().notNull(),
    notes: jsonb('notes').$type<readonly Note[]>().notNull(),
    generatorVersion: text('generator_version'),
    generatorSeed: integer('generator_seed'),
    createdAt: timestamp('created_at', stamps).notNull(),
  },
  (table) => [unique('chart_revisions_beatmap_revision').on(table.beatmapId, table.revision)],
);

export const libraryEntries = pgTable(
  'library_entries',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    beatmapId: uuid('beatmap_id')
      .notNull()
      .references(() => beatmaps.id),
    savedAt: timestamp('saved_at', stamps).notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.beatmapId] })],
);

export const scores = pgTable('scores', {
  id: uuid('id').primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  revisionId: uuid('revision_id')
    .notNull()
    .references(() => chartRevisions.id),
  score: integer('score').notNull(),
  combo: integer('combo').notNull(),
  accuracy: real('accuracy').notNull(),
  health: integer('health').notNull(),
  maxCombo: integer('max_combo').notNull(),
  counts: jsonb('counts').$type<Readonly<Record<Judgment, number>>>().notNull(),
  completed: boolean('completed').notNull(),
  createdAt: timestamp('created_at', stamps).notNull(),
});
