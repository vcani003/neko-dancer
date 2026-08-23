# @neko/game-core

**Built in Phase 1.** `MediaClock`, `judge`, note bookkeeping, `ScoreSystem`,
`GameEngine` and `fitTempo`. The surface is fixed by `API.md`, which is the
contract; this file is orientation.

`SongPlan`, chart generation and the analysis pipeline are **not** here and are
not coming — they are authoring rather than gameplay, and they move in Phase 5
(API.md §6). An earlier version of this file said otherwise.

The originals under `src/engine/` and `src/charts/` are still in place and still
passing, because the prototype has to keep running until `apps/web` is wired up.
They are deleted then, not now.

That independence is the reason 256 tests run with no browser, and it is a
property to be **enforced rather than trusted**: Phase 1's gate includes a test
that reads this package's own import graph and fails if React, a YouTube
symbol, `ws` or a database client appears in it.

**It takes a number, not a player** — ADR-007. Game Core consumes `mediaTimeMs`
and nothing else about playback; `PlaybackAdapter` lives in `apps/web` and must
never be imported here. An engine that receives a number cannot accidentally
call `play()`, cannot hold a reference to a player, and can be tested by passing
`10_000`.

Owned by the Game Core agent.
