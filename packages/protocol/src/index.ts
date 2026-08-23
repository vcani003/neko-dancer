/**
 * `@neko/protocol` — the contracts both sides share.
 *
 * Imported by `apps/web` and `apps/server` alike. Nothing here may import from
 * either of them, or from `@neko/game-core`: this package is the bottom of the
 * dependency graph, and it stays there.
 *
 * Owned by Architecture (ADR-004). A change here is a change to the agreement
 * between the client and the server, so it is a reviewed diff rather than an
 * edit made in passing to unblock something else.
 */
export * from './ids.ts';
export * from './domain.ts';
export * from './judgments.ts';
export * from './limits.ts';
export * from './messages.ts';
export * from './validate.ts';
