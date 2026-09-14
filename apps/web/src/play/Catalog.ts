/**
 * What the play loop needs from persistence. A `Store` satisfies this;
 * `HttpCatalog` does too.
 *
 * `apps/web` must not import `@neko/server` — that pulls Drizzle and PGlite
 * into a browser bundle. The session talks to this shape. Tests pass a
 * real store; the play page passes `HttpCatalog`.
 */
import type {
  BeatmapSummary,
  PlayableChart,
  RevisionId,
  RoundResult,
  StoredScore,
  UserId,
} from '@neko/protocol';

export interface Catalog {
  listPublished(): Promise<BeatmapSummary[]>;
  getPlayable(revisionId: RevisionId): Promise<PlayableChart | null>;
  recordScore?(userId: UserId, revisionId: RevisionId, result: RoundResult): Promise<StoredScore>;
}
