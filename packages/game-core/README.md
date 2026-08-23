# @neko/game-core

**Empty until Phase 1.** The rhythm engine moves here: `GameClock`,
`LaneJudge`, `ScoreSystem`, `GameEngine`, `ChartRecorder`, `SongPlan` and the
analysis pipeline — currently at `src/engine/`, `src/charts/` and
`src/analysis/`, and already free of React, YouTube, sockets and the database.

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
