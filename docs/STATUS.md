# Where we are

The at-a-glance board. Phases live in full in `IMPLEMENTATION-PLAN.md` Part 3;
decisions live in full in its Part 1. This page is the index and the checklist.

**Updated as work lands. If it disagrees with the code, it is wrong — say so.**

---

## Now

> ### ✅ P0 done — needs a two-machine playtest
> A detour before Phase 2, because a game nobody can play together does not get
> playtested. See `MULTIPLAYER-GAPS.md`.

| | |
|---|---|
| ✅ | Gate the Play button — no independent start while in a room |
| ✅ | Shared ranked results — everyone sees everyone, live while others finish |
| ✅ | Back to the lobby after a round, un-readied |
| ✅ | **Rung 5: a round played together, confirmed synchronised** |
| ✅ | Everyone's cat moves on everyone's screen |

P0 is not "passing" until that last line is ticked. Rungs 1–3 are green and have
been green through every failure so far — see `DIAGNOSIS-media.md`.

**Next up: P1** — prepare-before-countdown (so nobody starts mid-buffer),
`roundAbort`, and showing disconnects.

Also open, and now worth deciding: **browser-level tests**. 1146 tests could not
see the Play-button bug, because the multiplayer suite drives raw sockets and
the bug was a button. Playwright with one browser context per player would
catch that class. It cannot catch real clock skew between two machines — two
contexts on one machine share a clock — so it replaces rung 5a, not 5b.

---

## Phases

| | Phase | Gate | State |
|---|---|---|---|
| ✅ | **0 — Freeze & contract** | Contracts compile, imported by nothing, Validation's tests pass | 657 tests |
| ✅ | **1 — Game Core** | Windows verified on a fake clock; BPM on noisy taps; import-graph gate | 219 tests |
| ⬜ | **2 — Playback** | One YouTube smoke test; everything else on the fake | |
| ⬜ | **3 — Data & auth** | Round-trip per entity; published revisions provably immutable; Save ≠ Fork | |
| ⬜ | **4 — Single player** | A full run against a fake adapter from a scripted input sequence | |
| ⬜ | **5 — Chart creation** | Same taps → same chart; publishing twice leaves v1 byte-identical | |
| ⬜ | **6 — Global browsing** | Search by song, artist, author, difficulty, tags | |
| ⬜ | **7 — Multiplayer** | Full protocol suite + the failure matrix + a real two-machine round | |
| ⬜ | **8 — Creator tools** | Manual editing, holds, patterns, multiple timing points | |

Phases 2 and 3 can run in parallel; both are unblocked.

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

### Open — waiting on a decision

| Question | Where |
|---|---|
| Should `OKAY` break the combo? It is the tier that does, and the name reads wrong | ADR-005 |
| Should a masher be able to *fail*? Today they clear at 14% accuracy | `MULTIPLAYER-GAPS.md`, API.md §3 |
| How is the game served long-term — mDNS, tunnel, or a real deployment? | `DIAGNOSIS-media.md` |
| Sprite cats: tint greyscale parts per player, or accept one shared look? | `ART-BRIEF.md` §13 |
| Set up Playwright? 1146 tests could not see the Play-button bug | `MULTIPLAYER-GAPS.md` |

---

## Avatar animation

`ART-BRIEF.md` is the direction: a cut-out rig extended into a social-RPG avatar
system. Four layers compose — world transform, locomotion, gesture, expression —
and three of them already exist in some form (`Wander.ts`, `CatPose.ts`,
`depthScale`/`y`-sorting in `LaneRenderer`).

Not started; art does not exist yet. Phase 1 is swapping procedural drawing for
segmented sprites with `CatPose` behaviour preserved exactly, and nothing later
should be designed until that is validated.

---

## Things learned the hard way

Each of these cost real time. Full write-ups in `PLAYTEST-FINDINGS.md` and
`SECURITY.md`.

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

---

## Numbers

| | |
|---|---|
| Tests | **1146** across 35 files |
| Contracts | `@neko/protocol` — 657 tests |
| Engine | `@neko/game-core` — 219 tests |
| Protocol suite | 25 real-socket tests |
| Bundle | ~513 KB, one chunk |
