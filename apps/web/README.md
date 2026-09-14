# @neko/web

The React client. Owned by the Client agent.

**What is here so far: playback** (Phase 2) and **the single-player run**
(Phase 4). The React screens, input handling, rendering and multiplayer
client state are still at the repository root in `src/`.

## `src/play/` — Phase 4

`PlaySession` is the order: list published charts, choose one, preload the
adapter, wait out a countdown (ADR-002), feed the adapter's media time into
Game Core, collect a `RoundResult`.

The Phase 4 gate is `tests/play-session.test.ts`: a scripted perfect run
on the seeded tutorial against `FakePlaybackAdapter` scores 61.

```
npm run play
```

## `src/playback/` — §11, ADR-006, ADR-007, ADR-009

Everything that knows a video exists. Game Core never imports any of it: the
engine is handed `mediaTimeMs`, a number, and cannot start, stop or seek
anything (ADR-007). That is the reason the engine can be tested by passing
`10_000`, and it is enforced by `packages/game-core`'s import-graph test rather
than trusted.

| File | |
|---|---|
| `PlaybackAdapter.ts` | The contract. §11's members plus `state()`, `durationMs()`, `dispose()` — ADR-009 says why |
| `MediaProvider.ts` | `resolve(input) → MediaSource`, and the three shapes a resolution failure can take |
| `YouTubeProvider.ts` | Reads an id out of anything anyone pastes; names the song from the video (§14), never from a field |
| `YouTubeAdapter.ts` | The player as a clock source |
| `YouTubeApi.ts` | The IFrame API, typed and loaded once |
| `YouTubeErrors.ts` | What YouTube's error codes mean, in words someone can act on |
| `checkVideoPlayable.ts` | The lobby preflight (§26). Restrictions are per-viewer, so each browser answers for itself |
| `FakePlaybackAdapter.ts` | A source made of numbers. What everything downstream is proven against |

### The rule that shapes all of it

**No automated test may require YouTube** (`IMPLEMENTATION-PLAN.md` Part 4). So
the API is injected, the oEmbed lookup is injected, the DOM is three methods on
a fake, and `tests/determinism.test.ts` reads the test sources off disk to make
sure it stays that way. A YouTube address written in a string is not a
violation — `youtube-provider.test.ts` is full of them, and every one is a
fixture for a pure parser. What is banned is *reaching*.

### The one exception: `smoke.html`

The Phase 2 gate — load, play, the clock advances, pause, seek, error detected —
against the real YouTube, in a real browser, run by a person.

```bash
npm run dev
```

Then open `http://<this-machine>.local:5180/smoke.html` and press Run.

**By hostname, never by IP.** YouTube refuses restriction-bearing videos on a
numeric origin; that cost an evening once already, and `npm run dev` prints the
name to use.

What it is checking is the half a fake cannot: that the assumptions the fakes
encode are true of the real player. Re-run it after any change to this layer.
