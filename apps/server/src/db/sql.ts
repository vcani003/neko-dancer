/**
 * The schema as Postgres sees it.
 *
 * Applied on every in-memory database before Drizzle talks to it. The Drizzle
 * tables in `schema.ts` must match these names and types — they are two
 * descriptions of one thing, and the round-trip tests fail if they drift.
 *
 * Production later is the same SQL against a real Postgres. PGlite is that
 * dialect in-process, which is why the Phase 3 gate does not need a live
 * Supabase project.
 */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY,
  display_name text NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS songs (
  id uuid PRIMARY KEY,
  provider text NOT NULL,
  provider_media_id text NOT NULL,
  title text NOT NULL,
  artist text NOT NULL,
  duration_ms integer NOT NULL,
  thumbnail_url text,
  created_at timestamptz NOT NULL,
  UNIQUE (provider, provider_media_id)
);

CREATE TABLE IF NOT EXISTS beatmaps (
  id uuid PRIMARY KEY,
  song_id uuid NOT NULL REFERENCES songs(id),
  author_id uuid NOT NULL REFERENCES users(id),
  title text,
  difficulty text NOT NULL,
  tags jsonb NOT NULL DEFAULT '[]',
  status text NOT NULL,
  current_revision_id uuid,
  created_at timestamptz NOT NULL,
  published_at timestamptz,
  forked_from_beatmap_id uuid REFERENCES beatmaps(id),
  forked_from_revision_id uuid
);

CREATE TABLE IF NOT EXISTS chart_revisions (
  id uuid PRIMARY KEY,
  beatmap_id uuid NOT NULL REFERENCES beatmaps(id),
  schema_version integer NOT NULL,
  revision integer NOT NULL,
  timing jsonb NOT NULL,
  notes jsonb NOT NULL,
  generator_version text,
  generator_seed integer,
  created_at timestamptz NOT NULL,
  UNIQUE (beatmap_id, revision)
);

CREATE TABLE IF NOT EXISTS library_entries (
  user_id uuid NOT NULL REFERENCES users(id),
  beatmap_id uuid NOT NULL REFERENCES beatmaps(id),
  saved_at timestamptz NOT NULL,
  PRIMARY KEY (user_id, beatmap_id)
);

CREATE TABLE IF NOT EXISTS scores (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  revision_id uuid NOT NULL REFERENCES chart_revisions(id),
  score integer NOT NULL,
  combo integer NOT NULL,
  accuracy real NOT NULL,
  health integer NOT NULL,
  max_combo integer NOT NULL,
  counts jsonb NOT NULL,
  completed boolean NOT NULL,
  created_at timestamptz NOT NULL
);
`;
