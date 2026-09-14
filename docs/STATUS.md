# Where we are

The at-a-glance board. Phases live in full in `IMPLEMENTATION-PLAN.md` Part 3;
decisions live in full in its Part 1. This page is the index and the checklist.

**Updated as work lands. If it disagrees with the code, it is wrong — say so.**
Ideas that are not in flight live in `BACKLOG.md`.

---

## Now

> ### 🟡 Three pages — Home, Public/Staging, Create
> `npm run api` (5182) + `npm run dev` (5180). Open
> `http://<hostname>.local:5180/`. Friends off the LAN:
> `npm run tunnel` (laptop stays awake; URL is a secret). Later
> host is Fly or Railway — `docs/DEPLOY.md`. Home is the shelf (drafts +
> published). Public shuffles published charts, cap 6, chat on.
> Songs auto-start after a 10 s buffer. Mid-song join is spectate.
> Staging is Ready + a pausable YouTube player.
> Create pastes a YouTube URL on one page; Generate and test, Draft, and
> Publish all land in Staging. Staging can go Back or Regen the phrases.
> Hits play a short drum marker. Publish is a request until Staging confirms. The stage is
> still `LaneRenderer`. `ROOM-LOOPS.md` is pages and behaviour.
> `ROOM-THEME.md` is chrome, tokens, and the cat/bunny plates. The old
> prototype lives at `/prototype.html`. Hosted Postgres and the Phase 2
> smoke run are still ahead.

| | |
|---|---|
| ✅ | Drizzle schema: User, Song, Beatmap, ChartRevision, LibraryEntry, StoredScore |
| ✅ | Round-trip per entity on PGlite |
| ✅ | Published revision 1 stays byte-identical after revision 2 |
| ✅ | Save = reference, Fork = new beatmap |
| ✅ | httpOnly `neko.identity` cookie — the id is the person, the name is a label |
| ✅ | Seeded click-track chart for MVP 1 play |
| ✅ | Gate: no `localStorage` in `@neko/server` |
| ✅ | `PlaySession` — catalog + adapter + engine, wall time injected |
| ✅ | Gate: scripted fake-adapter run scores 61 on the tutorial |
| ✅ | Miss-all path and self-reported score write |
| ✅ | HTTP that exposes the store (`GET /api/me`, library, playable, scores) |
| ✅ | A playable React screen that calls `PlaySession` (`LaneRenderer`) |
| ✅ | Home / Public room / Create / Staging — `ROOM-LOOPS.md` |
| ✅ | Play-room visual system — `ROOM-THEME.md` (tokens, plates, component bans) |
| ⬜ | Hosted Postgres at deploy time |
| ⬜ | Phase 2 smoke run — still a person, still `smoke.html` |

**Also open, and now worth deciding: browser-level tests.** 1146 tests could not
see the Play-button bug, because the multiplayer suite drives raw sockets and
the bug was a button. Playwright with one browser context per player would catch
that class. It cannot catch real clock skew between two machines — two contexts
on one machine share a clock — so it replaces rung 5a, not 5b. It would also let
the smoke page above run itself, which is the second argument for it.

**P1 is still unstarted** — prepare-before-countdown, `roundAbort`, showing
disconnects. See `MULTIPLAYER-GAPS.md`, and note that Phase 7 rebuilds all of it
on the new contracts.

---

## Phases

| | Phase | Gate | State |
|---|---|---|---|
| ✅ | **0 — Freeze & contract** | Contracts compile, imported by nothing, Validation's tests pass | 657 tests |
| ✅ | **1 — Game Core** | Windows verified on a fake clock; BPM on noisy taps; import-graph gate | 219 tests |
| 🟡 | **2 — Playback** | One YouTube smoke test; everything else on the fake | 103 tests, smoke not run |
| 🟡 | **3 — Data & auth** | Round-trip per entity; published revisions provably immutable; Save ≠ Fork | 40 tests, HTTP on 5182 |
| 🟡 | **4 — Single player** | A full run against a fake adapter from a scripted input sequence | session + Home / rooms |
| 🟡 | **5 — Chart creation** | Same taps → same chart; publishing twice leaves v1 byte-identical | Create page + Staging |
| ⬜ | **6 — Global browsing** | Search by song, artist, author, difficulty, tags | |
| ⬜ | **7 — Multiplayer** | Full protocol suite + the failure matrix + a real two-machine round | |
| ⬜ | **8 — Creator tools** | Manual editing, holds, patterns, multiple timing points | Staging workshop: lanes + YouTube, CapCut bin, one-row timeline — `CHART-EDITOR.md` |

The three pages are in. Phase 5's Create screen exists; the advanced editor does not. Hosted Postgres and `smoke.html` are still ahead.

---

## Decisions

Full reasoning in `IMPLEMENTATION-PLAN.md` Part 1.

| | Decision | Why it mattered |
|---|---|---|
| **001** | Lanes are directions (`left/down/up/right`), never keys | Naming a lane `W` makes every stored note wrong for anyone who rebinds |
| **002** | Round start is a **delay**, not a server timestamp | Two machines' clocks differ by seconds; a duration means the same on both |
| **003** | Note times are **absolute**; the timing map is authoring metadata | Applying an offset to already-absolute times counts it twice |
| **004** | Four npm workspaces, one lockfile | `apps/server` becoming TypeScript dissolved the validator-drift problem |
| **005** | Five grades `PERFECT/GREAT/GOOD/OKAY/MISS` at 35/70/110/160 | The old test matrix demanded `+120 → Okay` while `okayMs` was 110 |
| **006** | `MediaSource` has no id; identity is `Song.id` | Two identities for one piece of media answers no question well |
| **007** | Game Core takes `mediaTimeMs`, never a `PlaybackAdapter` | An engine given a number cannot call `play()` and is tested by passing `10_000` |
| **008** | Chart schema v1 abandoned, no migration | Charts were exported by hand first; the backup gets one manual reshape |
| **009** | `PlaybackAdapter` is §11 plus `state()`, `durationMs()`, `dispose()` | `isPlaying()` has to answer *no* for buffering, ended and never-started, and two of those already cost a round |

### Open — waiting on a decision

| Question | Where |
|---|---|
| Should `OKAY` break the combo? It is the tier that does, and the name reads wrong | ADR-005 |
| Should a masher be able to *fail*? Today they clear at 14% accuracy | `MULTIPLAYER-GAPS.md`, API.md §3 |
| How is the game served long-term — mDNS, tunnel, or a real deployment? | `DIAGNOSIS-media.md` |
| Sprite cats: tint greyscale parts per player, or accept one shared look? | `ART-BRIEF.md` §13b — deferred, procedural recolours for free |
| Set up Playwright? 1146 tests could not see the Play-button bug — and it would let `smoke.html` run itself | `MULTIPLAYER-GAPS.md` |
| Does `MediaClock`'s 250 ms resync threshold match YouTube's real step? The smoke page measures it | ADR-009, `smoke.html` |

---

## Avatar animation

`ART-BRIEF.md` is the direction: a cut-out rig extended into a social-RPG avatar
system. Four layers compose — world transform, locomotion, gesture, expression —
and three of them already exist in some form (`Wander.ts`, `CatPose.ts`,
`depthScale`/`y`-sorting in `LaneRenderer`).

**The first art sheet arrived on 27 August**, and a standing cat is assembled
from it: `scripts/cut-parts.py` cuts twelve parts out of the sheet and measures
them, `CatSprite` stands them up, `/cat.html` shows it in the real renderer.

It is a **pose sheet rather than the part library** the brief asks for, and
`ART-BRIEF.md` §14 records exactly what that costs — faces baked into three
heads, limbs drawn already-curved, four finished tails instead of three
segments. None of it blocks standing; all of it blocks posing. Four more parts
would convert it into a rig, and §14 names them.

Nothing else changes. §12 still holds — avatar phases 1–6 (click-to-move, the
walk cycle, idles, blinking, expression as a layer, emotes) need no art and are
still the better thing to build first, and `CatDancer` still draws every
animated cat in the game. What the sheet buys is that the swap is no longer
hypothetical: the cut, the assembly and the layer order are proven.

---

## Things learned the hard way

Each of these cost real time. Full write-ups in `PLAYTEST-FINDINGS.md` and
`SECURITY.md`.

- **Three correct rules can deadlock.** The clock stops when the video stops,
  completion needs every arrow judged, and a chart can outlive its song — so a
  run with arrows past the end could never finish. None of the three was wrong
  alone.
- **Tapping the tempo is not describing the song.** Forty taps to find a BPM
  were read as the song's structure, so everything after the last tap became a
  skipped passage and a four-minute song charted as thirteen seconds. The two
  readings are now separate buttons.
- **A bare IP is not a domain.** YouTube refuses restriction-bearing videos on a
  numeric origin. Share the `.local` hostname. Measured 6/6 vs 5/5.
- **Picking and readying must be separate actions.** Bundled, every player who
  readied un-readied everyone before them, and the countdown could never fire.
- **Three single-message crashes** before anyone added a barrier around the
  handler. `ws` dispatches from `Receiver._write`, so a throw is an uncaught
  exception, not an `error` event.
- **The tests were correct while the game was broken**, three times. Focus,
  hit-testing and message ordering are decided by the browser.
- **`npx tsc --noEmit` does not check this project.** Use `npm run build`.
- **A gate that scans source has to tell code from the description of code.**
  The determinism gate is one of the files it reads, and every banned pattern
  appears in it by definition — they *are* the patterns. It failed on itself
  until it blanked strings, comments and regex literals first. The same lesson
  `packages/game-core`'s import-graph test learned against prose.
- **A YouTube URL in a test is not a test that reaches YouTube.** The first
  version of that gate banned the addresses and flagged a parser's own fixtures.
  A gate that flags correct tests is a gate someone switches off; ban the calls.

---

## Numbers

| | |
|---|---|
| Tests | **1350** across 55 files |
| Contracts | `@neko/protocol` — 657 tests |
| Engine | `@neko/game-core` — 219 tests |
| Playback | `@neko/web` — 114 tests, zero of them reaching YouTube |
| Data | `@neko/server` — 40 tests, PGlite, no network |
| Protocol suite | 25 real-socket tests |
| Bundle | ~513 KB, one chunk |
| Cat parts | 12 PNGs, 936 KB, cut and measured by one script |
