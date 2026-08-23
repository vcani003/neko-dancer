# @neko/web

**Empty until Phase 1.** The React client — UI, chart creation, playback
adapters, input handling, multiplayer client state — moves here from the
repository root (`src/`, `index.html`, `vite.config.ts`).

Not moved yet on purpose. Phase 0's gate is that the contracts compile and are
imported by nothing; relocating a working application is its own reviewable
change and does not belong in the same commit as the contracts it will later
import.

Owned by the Client agent. Playback lives at `src/playback/` inside this
workspace — ADR-004 explicitly refuses it a workspace of its own.
