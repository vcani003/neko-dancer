# Neko Dancer — Implementation Plan

Companion to `SYSTEM-DESIGN.md`. That document is the **what and why**; this one
is the **who, where, and how we prove it works**.

**Rule of the road:** agents implement *against* shared contracts. They do not
rewrite a shared contract to make their own task easier. Any contract change
goes back through the Architecture owner first and is recorded below as an ADR.

---

## Part 0 — Where the code actually is today

Written before any of the work below, because a plan that misstates the starting
position produces schedules nobody can hit.

### Already compliant — verified, not assumed

| Spec | Evidence |
|---|---|
| §27 chat never accepts a client username | `server/index.mjs` broadcasts `from: player.name`, read from the socket's own player |
| §10 position derived from media time | `LaneRenderer` computes `active.timeMs - state.playbackTimeMs` per frame; nothing accumulates |
| §13 chart offset ≠ player calibration | Calibration applied in `GameClock`; the chart offset is authoring metadata and never reaches playback (ADR-003) |
| §24 judgment on the local media clock | `GameClock` samples the adapter; the server's countdown never touches judging |
| §26 lobby video preflight | Built and tested — `checkVideoPlayable()` plus `CAN_PLAY`, 5 protocol tests |
| §9 engine independent of React/YouTube/WS | `src/engine/`, `src/charts/`, `src/analysis/` are already pure. 256 tests run with no browser |

### Survives, and moves

`GameClock` · `LaneJudge` · `ScoreSystem` · `GameEngine` · `ChartRecorder` ·
`SongPlan` · `analysis/*` · `validator` → **`packages/game-core`**, essentially
as-is. This is the single largest asset and it is already the right shape.

`PlaybackAdapter` + `YouTubeAdapter` → keeps its interface, gains
`MediaProvider` and `load(source)` per §11.

### Changes substantially

| Now | Becomes |
|---|---|
| `LocalChartStore` as the source of truth | Postgres repository; `localStorage` demoted to cache (§29) |
| `chartId` = `youtube:x#vero#v2` | Generated database ids; song/beatmap/author/revision identity separate (§30) |
| Flat `Chart` | `Song → Beatmap → ChartRevision` (§4–6) |
| Room holds one `chart` | Room holds a `queue` and an `activeBeatmapRevisionId` (§19) |
| `PICK_SONG` pushes a whole chart over the socket | `QUEUE_ADD` sends an id; clients fetch from the API (§22) |
| Browser `ownerKey` | `beatmap.authorId = user.id` (§3) |

### Deleted, and worth saying so

- **The `charts/` filesystem library was never built.** Stopping here saved that
  work rather than wasting it — Postgres replaces it wholesale.
- `builtInRecord` / `receivedRecord` / constructed-id helpers go with `chartId`.

### What carries forward regardless of storage

These were behaviour bugs, not persistence bugs, and their fixes survive the
rewrite. They are listed because the new implementation must not reintroduce
them — each has a test that should be ported, not deleted:

1. Picking a song and readying must be **separate actions** — bundling them made
   every player who readied un-ready everyone before them, so no round could
   ever start.
2. A round must **end itself** if nobody reports finishing.
3. A message handler throw **must not reach `ws`** — it becomes an uncaught
   exception, not an `error` event.
4. Any text a client supplies and another player sees must be **sanitised and
   bounded**, and the server must own the wording of anything that looks
   official.
5. One player's blocked video **must not block the room**.

---

## Part 1 — Architecture decisions

Three places where the spec was ambiguous or, in my reading, wrong. **All three
are now decided by Vero and closed.**

### ADR-001 — Lane identity is a direction, not a key. **ACCEPTED**

**Decision.** Charts store semantic lanes only: `left | down | up | right`, and
never a physical key. WASD **and** the arrow keys are both supported by default,
simultaneously and interchangeably — either key for a lane may be used, even
within the same song:

```
W or ↑ → up      A or ← → left      S or ↓ → down      D or → → right
```

Input maps physical keys to semantic lanes before anything reaches Game Core, so
future custom bindings can add or change keys without touching a single stored
beatmap.

**Status: already implemented.** `src/input/KeyboardInput.ts` maps both key sets,
in both cases, to semantic lanes. No work required.

<details><summary>Original argument</summary>

§8 defines `lane: "W" | "A" | "S" | "D"`. §29 also lists **key bindings** as a
stored user preference. Those two cannot both be true.

If a lane's identity *is* a key, then a player who rebinds to arrow keys is
playing a chart whose lanes are named after keys they no longer press — and
every persisted note in the database is wrong for them. Worse, the meaning of
stored data changes with a client-side setting, which is exactly the property a
database schema must not have.

**Recommendation:** `Lane = "left" | "down" | "up" | "right"`, with key bindings a
separate user preference mapping key → lane (default `W→up, A→left, S→down,
D→right`). This is DDR's own model, it is what the current code does, and it
leaves `hold` notes and future 6-lane modes unaffected.

**Cost of the alternative:** if `W|A|S|D` is kept, rebinding must be forbidden,
or every chart must be rewritten whenever the default binding changes.

</details>

### ADR-002 — Round start is a relative delay. **ACCEPTED**

**Decision.** A raw `serverTimestamp` is not the start signal. The round start
message carries a relative delay:

```ts
ROUND_START { beatmapRevisionId, startInMs: 3000 }
```

Each client begins its countdown when the message arrives. Differences in
network delivery are acceptable for MVP. Scoring uses each player's **local
media playback clock**, never the server clock — start synchronisation keeps
players approximately aligned and is not a judging clock. If playtesting shows
visible drift, upgrade to a clock-offset system using ping/round-trip
measurement.

**Status: already implemented**, and covered by the three-clocks test in Part 4.

<details><summary>Original argument</summary>

§23 sends `ROUND_START { startAt: serverTimestamp }`. A server timestamp is only
actionable if the client can convert it to its own clock, and two machines'
`Date.now()` routinely differ by seconds — occasionally by minutes. Compared
naively, a client either starts instantly or waits a very long time.

Two honest options:

- **(a) Send a duration.** "Start in 3000 ms." Needs no clock synchronisation and
  is exact to the message's own transit time — a millisecond or two on a LAN.
  This is what the current implementation does.
- **(b) Send a timestamp and estimate the offset** with a ping/pong exchange
  (`t0/t1/t2/t3`, NTP-style) at join, then convert.

**Recommendation: (a) now, with the message shaped so (b) can replace it without
touching Game Core.** §24's actual requirement — the server decides *when*, the
client's media clock decides *where* — is satisfied by either. (b) becomes worth
it only when rounds start across the internet rather than a LAN.

</details>

### ADR-003 — Note times are absolute; the timing map is authoring metadata. **ACCEPTED**

**Decision: approved as written.** A `Note.timeMs` is an absolute media time.
The timing map describes the grid the notes were authored against, is used by
the editor and by analysis, and is **never added to a note time at playback**.
Changing a chart's offset in the editor rewrites note times and produces a new
revision.

**Status: implemented.** `arrowTimeMs()` no longer adds the offset, a stored
chart carrying a non-zero offset has it folded into its note times once on read
so it keeps playing identically, and the test that asserted the old behaviour
has been inverted rather than deleted.

**Correction to the original argument below:** it claimed the judge and the
renderer could disagree. They could not — both read the single value
`toActiveArrows` computes, so they always agreed with each other. The real
defect was narrower and still worth fixing: `Arrow.timeMs` meant "relative to
the grid" while `ActiveArrow.timeMs` meant "absolute". One name, two meanings,
waiting to be confused.

<details><summary>Original argument</summary>

§8 gives each note an absolute `timeMs`. §7 gives the chart an `offsetMs`. If
both are applied at playback, **the offset is counted twice** and every note is
early or late by the offset. The current code does exactly this
(`arrow.timeMs + chart.analysis.offsetMs`), which is correct only because its
generator writes note times *without* the offset baked in — an invariant held by
convention and by nothing else.

**Recommendation, stated as a rule the schema enforces:**

> A `Note.timeMs` is an **absolute media time in milliseconds**. The timing map
> describes the grid the notes were authored against. It is used by the editor
> and by analysis. **It is never added to a note time at playback.**

Changing a chart's offset in the editor rewrites note times and produces a new
revision — which §6 already requires, since published revisions are immutable.

</details>

### ADR-004 — Four workspaces, npm, one lockfile. **ACCEPTED**

**Decision.** One Git repository, npm workspaces, exactly four workspaces:

```
neko-dancer/
├── apps/web/            React + TS client · UI · chart creation · playback
│                        adapters · input · multiplayer client state
├── apps/server/         API · auth · Postgres/Supabase · rooms · chat ·
│                        queues · ready state · WebSocket server
├── packages/game-core/  timing · judgment · scoring · combo · playback
│                        calculations · provider-independent BPM utilities
├── packages/protocol/   shared domain contracts · WS message types · room
│                        schemas · identifiers · validation identical on both
│                        sides
└── package.json         one root lockfile; install from the root
```

Everything else stays a folder **inside** one of the four. Explicitly **not**
separate workspaces: playback, auth, database, chart editor, UI components,
rooms, testing, utilities. A fifth workspace needs its own ADR.

Agents are assigned ownership **by workspace** and do not modify another one
without a documented dependency reason.

npm stays the package manager; changing it is a separate tooling decision.

**This supersedes the five-package sketch in Part 2 below**, which had a
separate `contracts` and `playback`. `contracts` is renamed `protocol`;
`playback` folds into `apps/web`.

**One consequence worth naming.** `apps/server` becomes TypeScript, so it can
import `packages/protocol` directly — which dissolves the validator-drift
problem the previous plan had to work around. There is now one validator,
imported by both sides, rather than two that must be tested against each other.

### Decided, and not deviations

### ADR-005 — Five judgment grades. **ACCEPTED**

**Decision.** `PERFECT | GREAT | GOOD | OKAY | MISS`, at the current
`35 / 70 / 110 / 160` thresholds, with `MISS` everything outside the `OKAY`
window. Provisional and configurable; tuned by playtesting.

```
|error| ≤  35 → PERFECT      ≤ 110 → GOOD       > 160 → MISS
        ≤  70 → GREAT        ≤ 160 → OKAY
```

Raised because the contracts shipped five grades (`PERFECT NICE OKAY OOPS
MISS`) where §12's example listed four, and because Part 4's own test matrix
demanded assertions that could not hold — it required `+120 → Okay` while
`okayMs` was 110, so two of its four boundary tests were unwritable. A test
matrix that contradicts the code it tests is worse than no matrix.

**One consequence to watch in playtesting.** The tier now called `OKAY` is the
one that breaks a combo — `PERFECT`, `GREAT` and `GOOD` keep it. A grade named
"Okay" that punishes you reads oddly, and it is a naming question rather than a
behaviour one: the thresholds and the combo rule are unchanged from what the
game has always done. If it feels wrong in play, the cheap fixes are to let
`OKAY` keep the combo, or to rename that tier again.

### Decided, and not deviations
- **Client-reported scores are accepted for MVP.** The server saves what the
  client claims. That is fine for casual multiplayer, and it means a future
  competitive leaderboard needs server-side validation before anyone calls it
  cheat-resistant. Recorded so nobody later mistakes a stored number for a
  verified one.
- **Supabase free-tier pausing is a hosting concern, not a design one.** Fine
  for development; production needs a plan that does not pause on inactivity.

---

## Part 2 — Ownership

### Packages

Superseded by ADR-004. The layout is the four workspaces above; `db/` (Drizzle
schema and migrations) is a folder inside `apps/server`.

### Agents and their boundaries

| Agent | Owns | Must not touch |
|---|---|---|
| **Architecture** | `packages/protocol`, ADRs | Implementation, unless a contract forces it |
| **Game Core** | `packages/game-core` | UI, server, database |
| **Playback** | `apps/web/src/playback` | Game Core logic |
| **Data** | `apps/server/src/db`, repositories, auth | Gameplay |
| **Realtime** | `apps/server/src/rooms` — queue, chat, ready, round | Scoring |
| **Client** | `apps/web` UI and state | Core algorithms |
| **Validation** | All tests, adversarial cases, acceptance gates | Production behaviour, to make a test pass |
| **Review** | Integration review | Feature implementation |

**Validation is deliberately not the implementer.** An agent that writes both a
feature and its tests proves only that the feature does what that agent expected.
Validation reads `SYSTEM-DESIGN.md` and this document, and tries to break what
was built.

Each agent works on its own branch or worktree. Contract changes are a pull
request against `packages/contracts`, reviewed by Architecture, never an
in-passing edit.

---

## Part 3 — Phases

Ordered by dependency, not by appetite. Nothing in a phase starts until the
previous phase's gate is green.

### Phase 0 — Freeze and contract

Feature work stops. Architecture writes `packages/contracts`: `Song`, `Beatmap`,
`ChartRevision`, `Note`, `TimingPoint`, `User`, `Playlist`, room messages,
judgments. ADR-001/002/003 resolved by Vero.

**Gate:** contracts compile, are imported by nothing yet, and Validation has
written type-level and fixture tests against them.

### Phase 1 — Game Core (parallel with 2 and 3)

Move the existing pure modules into `packages/game-core` behind the new
contracts. Add `hold` notes. Adopt the timing map per ADR-003.

**Gate:** every judgment window verified with a `FakePlaybackAdapter`; BPM
estimation verified on synthetic taps, noisy taps, and taps with an outlier; no
import of React, YouTube, `ws` or the database anywhere in the package —
**enforced by a test that reads the package's own import graph**, not by
convention.

### Phase 2 — Playback (parallel)

`MediaProvider` + `PlaybackAdapter` + `YouTubeAdapter` per §11. Keep
`checkVideoPlayable`.

**Gate:** one YouTube smoke test — load, play, `currentTimeMs()` advances, pause,
seek, error detected. Everything else runs on the fake.

### Phase 3 — Data and auth (parallel)

Supabase project, Drizzle schema, migrations, repositories, auth.

**Gate:** a round-trip test per entity; a published revision is provably
immutable; Save creates a reference and Fork creates a beatmap (§17); no
`localStorage` write is authoritative anywhere.

### Phase 4 — Single player

Global/library → choose beatmap → preload → countdown → gameplay → results.

**Gate:** a full run against a fake adapter, asserting the final score from a
scripted input sequence. Deterministic, no network.

### Phase 5 — Chart creation

URL → tap → BPM + offset → generate → test → draft → publish. Titles come from
the video (§14), never typed.

**Gate:** the same taps always produce the same chart; publishing a second time
creates revision 2 and leaves revision 1 byte-identical.

### Phase 6 — Global browsing

Search by song, artist, author, difficulty, tags. Multiple beatmaps per song.

### Phase 7 — Multiplayer orchestration

Rooms, queue, ready, chat, preflight, synchronised start, live progress.

**Gate:** the full protocol suite and the failure matrix below.

### Phase 8 — Advanced creator tools

Manual editing, holds, patterns, multiple timing points, deeper analysis.

---

## Part 4 — Test matrix

Validation runs **from Phase 0 onward**, in parallel with implementation — not
as a final phase.

| Level | Validates | How |
|---|---|---|
| Game Core | scoring, timing, BPM | Vitest + fake clocks |
| WebSocket server | rooms, queue, ready, chat | Programmatic WS clients |
| Multiplayer integration | 2–5 players interacting | Real server + simulated clients |
| Browser multiplayer | UI + sockets + game | Playwright browser contexts |
| Media integration | real YouTube behaviour | One small smoke test |
| Real world | two physical machines | Manual playtest |

### The determinism rule

**No automated test may require YouTube.** Game Core is proven against
`FakePlaybackAdapter`:

```ts
fake.setTime(10_000);
game.press('up');        // chart has { timeMs: 10_000, lane: 'up' } → Perfect
```

with the window boundaries walked exactly, per ADR-005, and each tested on
**both sides** so a window cannot be moved by accident:

```
  0 → PERFECT     71 → GOOD      161 → MISS
 35 → PERFECT    110 → GOOD      250 → MISS
 36 → GREAT      111 → OKAY
 70 → GREAT      160 → OKAY
```

BPM estimation gets synthetic taps at a known tempo (`237, 737, 1237, 1737,
2237` → 120 BPM, offset ≈ 237 ms), then the same with human noise
(`237, 740, 1233, 1745, 2235`), then with a deliberate outlier. It must still
land near 120.

External services bring network failures, deleted videos, embedding and regional
restrictions, API changes and rate limits. None of those belong in the signal
that tells us our arithmetic is right.

### The multiplayer test that needs no browser

Start the real server; connect three programmatic clients; run the real protocol:

```
JOIN → queue Song A → queue Song B → chat → all READY
→ ROUND_PREPARE → all report media ready → ROUND_START
```

Assert: all three received an identical queue; an identical
`beatmapRevisionId`; an identical start signal; chat reached only that room's
members; the round did not begin before everyone was ready; the queue advanced
after the round.

### The three-clocks test — proves ADR-002 and §24

Three fake playback clocks starting at `+0 ms`, `+80 ms`, `+150 ms`. Each player
hits the same musical note relative to **their own** playback. **All three must
receive the same judgment.** If they do not, server timing has contaminated
scoring.

### Failure matrix — required, not optional

- A player disconnects during the countdown
- A player cannot load the media
- A player sends `READY` twice
- Two users queue songs simultaneously
- A malformed chat message
- A client receives messages 300 ms late
- A player disconnects and reconnects
- Two rooms are active simultaneously
- A client presents the wrong chart revision

### Multiroom isolation — tested early

```
Room A: Vero, Levi        Room B: Cat1, Cat2, Cat3
```

Prove that chat, queue, ready, round and scores **never** leak between them.
Early, because it is foundational and because it is cheap to test and expensive
to discover.

### Browser level

Playwright, three independent contexts as three users: join, chat, queue, ready,
countdown, gameplay, live scores, finish, queue advances. One test runs **two
rooms at once**.

---

## Part 5 — Definition of done

A phase is done when **all** of these hold. Not most.

1. Every contract it touches is implemented as written, or the deviation is an
   ADR in Part 1 with Vero's decision recorded.
2. Validation's tests pass, and Validation wrote them without reading the
   implementation.
3. Each regression test **has been shown to fail without its fix.**
4. No new authoritative state in `localStorage` or on the filesystem.
5. `npm run build` is clean. (`npx tsc --noEmit` does not check this project —
   the root config is a solution file and reports success while the app is
   broken.)
6. The failure matrix entries relevant to the phase are covered.
7. `SECURITY.md` is accurate for what now exists — in particular §3 "no secrets"
   and §5 "no persistence" both become false the moment auth and Postgres land.
8. Review has read the integration, not just the diff.

### Out of scope until explicitly scheduled

Server-authoritative judging · replays and spectating · ranked play · moderation
tools · TLS · anything that makes a score a public claim.
