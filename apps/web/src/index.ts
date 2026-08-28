/**
 * `@neko/web` — the client.
 *
 * Only the playback layer lives here so far (Phase 2). The React application,
 * input handling, rendering and multiplayer client state are still at the
 * repository root in `src/`, and move here as their phases land — relocating a
 * working application is its own reviewable change and does not belong in the
 * same commit as the layer it will later import.
 */
export * as playback from './playback/index.ts';
