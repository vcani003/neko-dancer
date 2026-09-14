# Frontend design & the Storybook demo

How the client is put together, and how its decisions get shown to someone who
was not in the room when they were made.

Companion to `SYSTEM-DESIGN.md` (the contract) and `IMPLEMENTATION-PLAN.md`
(phases and gates). Everything here lives in `apps/web` — ADR-004 refuses UI
components a workspace of their own, and Storybook is a tool, not a package.

---

## Part 1 — Why Storybook, specifically for this game

The generic argument is component browsing. That is not the argument here.

### 1. Most of this game's interesting states are unreachable by hand

We have built a lot of failure UI, and almost none of it can be seen on demand:

| State | What it takes to see it today |
|---|---|
| "The uploader does not allow this video outside YouTube" | Find a genuinely embed-blocked video |
| A player sitting out because their video failed | A **second machine**, on a different origin, with a blocked video |
| The round watchdog firing | Wait 90 seconds while nobody finishes |
| Countdown aborted mid-count | Two people, one leaving at the right instant |
| The error boundary's notice | Deliberately break a render and rebuild |
| A stalled clock during buffering | Throttle a network at the right moment |
| A chart that fails validation | Hand-edit storage |

Every one of these is a click in Storybook. **That is the whole justification on
its own** — this session alone spent real time reproducing three of them, and one
required building a broken bundle and reverting it.

### 2. ADR-007 makes the gameplay itself a story

This is the part that makes it more than a component gallery, and it is a direct
payoff of a decision made for other reasons.

Game Core takes `mediaTimeMs` — a number. `MediaClock` is *fed* samples. So a
story can drive the entire playfield from a slider:

```tsx
<Playfield revision={fixture} mediaTimeMs={value} />
```

No video, no network, no waiting, no YouTube. **Scrub a chart backwards.** Park
on a single note and step through the judgment windows a millisecond at a time.
Run the same chart at three scroll speeds side by side. None of that is possible
against a real video, and all of it is how you actually tune feel.

It also means the story is a *second consumer* of the engine, which is the
cheapest way to find out that an API only works for the one caller it was
written against.

### 3. Decisions become demonstrable rather than described

`ADR-005` says the judgment windows are provisional and tuned by playtesting.
A story that shows `35/70/110/160` next to `45/90/140/180`, with the same
input, turns "provisional" into something you can have an opinion about.

Same for: scroll speed, lane colours under a colourblindness filter, calibration
sign, and the `OKAY`-breaks-combo oddity ADR-005 flagged.

### What a story's docs page must carry

Not "this is the lobby". The **decision**, the way `PLAYTEST-FINDINGS.md` does:

> **Ready and pick are separate buttons.**
> They were one. Picking a song un-readies the room — correctly, since agreeing
> to play one song is not agreeing to play another — so the second player to
> press ready silently un-readied the first and the countdown could never fire.
> With one player it worked perfectly, which is why it survived to a
> two-machine test.

That is the artefact worth having. It is also, not incidentally, the thing worth
showing someone looking at this as a portfolio piece.

---

## Part 2 — The catalogue

Organised by layer, not by screen, because that is how they get built.

### Primitives — `apps/web/src/ui/primitives/`

`Button` (primary/ghost/danger, disabled with a *reason*) · `Panel` ·
`TextField` (and the lane-key guard: typing `w` in chat must never be an input
event) · `Slider` (calibration, scroll speed, volume) · `Toast` · `Badge`
(version, difficulty, `private`/`shared`) · `EmptyState`.

Stories: every state including disabled, loading, error, and **too long** —
a 20-character display name, a 100-character title, a name of pure emoji.

### Game chrome — `apps/web/src/ui/game/`

`Playfield` (the Pixi canvas, driven by `mediaTimeMs`) · `JudgmentFlash` ·
`ComboCounter` · `HealthBar` · `ScoreReadout` · `Countdown` · `ResultsCard`.

Stories that matter:
- **Every judgment**, parked, so the flash can be compared side by side.
- **Combo at 1, 9, 10, 99, 100** — where the styling changes.
- **Health at 100, 30, 5, 0** — the last one is the fail state.
- **Scroll speed × window set**, as a grid.
- **Density**: a 4-note chart and a 400-note chart at the same instant.

### Room — `apps/web/src/ui/room/`

`PlayerList` · `Chat` · `Queue` · `ReadyBar` · `SongBrowser`.

Stories are mostly **states you cannot stage**:
- One player `participating: false` with each `MediaFailure` reason.
- A player `connected: false`, seat held.
- 2 players, 8 players, 16 (the cap).
- Two players with the **same display name** — the real bug from this session.
- Chat with a system line, a long message, and a hostile one (bidi, zero-width)
  proving sanitisation visually.
- An empty queue, a full queue at `MAX_QUEUE_LENGTH`, the same song twice.

### Creation — `apps/web/src/ui/create/`

`TapTempo` · `TimingPreview` · `PublishDialog` (including *"You already have v1.
Delete it?"* defaulting to yes) · `DuplicateFound` (§3b: this song already has a
chart — use it, or chart your own).

### Failure — `apps/web/src/ui/feedback/`

The reason for all of this. One story per `MediaFailure` code, the error
boundary's notice, `roundAbort`, the preflight timeout, a chart that fails
`validateChartRevision` with the error rendered, and a socket that is `closed`
and retrying.

---

## Part 3 — Design tokens

### Where it is now

`src/index.css` has eleven CSS custom properties and no scale — spacing,
radius, type size, motion and elevation are all literals scattered through the
file. That is fine for a prototype and it will not survive four contributors.

### Where it should go

Room extras — plate URL, secondary, glow — are specified in `ROOM-THEME.md`.
They reassign the names below. They do not twin them.

Tokens in one file, consumed by both CSS and stories.

**Colour.** Keep the existing palette; give it roles. `--bg`, `--panel`,
`--line`, `--text`, `--muted` are structural. `--pink` is the brand and the
primary action. `--green`/`--gold`/`--bad` are semantic — success, reward,
failure — and must never be used decoratively, or a red thing that means nothing
teaches people to ignore the red thing that means something.

**Lane colour is semantic, not decorative.** Four lanes must be
distinguishable by people who cannot distinguish red from green, so lanes carry
**hue *and* shape** — the arrow glyph is the primary channel and colour is
reinforcement. Test with a deuteranopia filter as a story, not as an afterthought.

**Type.** One family, one mono family, a four-step scale. Numbers that change
every frame — score, combo, timing — use `tabular-nums`, already present as
`.mono`, or the layout jitters on every digit change.

**Motion.** A small named set: `--motion-instant` (feedback, ~80 ms),
`--motion-quick` (UI, ~160 ms), `--motion-considered` (panels, ~280 ms). Anything
in the playfield is not "motion" — it is gameplay, driven by `mediaTimeMs`, and
must not be tied to a CSS duration.

**`prefers-reduced-motion` is a hard requirement**, and subtler here than
usual — see Part 6.

---

## Part 4 — Component architecture

Three layers, and the rule is that a layer may only import downward:

```
screens/     Menu · Room · Play · Create · Results     — routing, data fetching
game/ room/  Playfield · PlayerList · TapTempo         — feature components
primitives/  Button · Panel · Slider · Toast           — no app knowledge
```

A primitive that knows what a `Beatmap` is has stopped being a primitive.

### The canvas/DOM boundary

Pixi appends its canvas **after** the React children, which puts it on top. It
gets `pointer-events: none` and the HUD gets an explicit `z-index`. This exact
bug has now shipped twice in two projects, so the rule lives next to a comment
explaining why, and a Storybook story parks a button under the canvas as a
standing check that a click still reaches it.

Nothing in the playfield is a React component. React owns chrome; Pixi owns the
field; they meet at one prop.

---

## Part 5 — State ownership — the fullstack seam

Three kinds of state, and mixing them is how a rhythm game gets slow.

| Kind | Lives in | Rate | Rule |
|---|---|---|---|
| **Server state** | `RoomState` over the socket | ~10 Hz | Rendered, never edited locally. The server is right. |
| **Engine state** | `GameEngine`, in a ref | 60 Hz | **Never `setState`.** A slow HUD publishes a summary on an interval. |
| **Client preference** | `localStorage` | on change | Calibration, scroll speed, volume, key bindings. §29 — and the *only* thing storage owns. |

The rule that produced this: sixty `setState` calls a second through React's
scheduler is a stutter, and a stutter in a rhythm game is a wrong note.

**Persistent data is fetched, not pushed.** §22 — the socket carries a
`RevisionId`; the chart comes from the API. A chart in a broadcast is tens of
kilobytes multiplied by the room, and we have already made that mistake once.

---

## Part 6 — Accessibility

Rhythm games are hostile by default. Some of this is cheap and some is real
design work; none of it is optional if other people are going to play it.

**Reduced motion is subtle here.** A player who requests reduced motion has not
requested a game with no scrolling notes — the scroll *is* the game. What they
have asked to stop is the *decorative* motion: the wandering cat, the background
drift, the combo pop, screen shake. Honour it precisely. Getting this wrong in
either direction is bad: ignoring it causes harm, over-applying it removes the
game.

**Colour is never the only channel.** Lanes carry arrow glyphs; judgments carry
words as well as colour; `participating: false` carries text as well as red.

**Timing windows are an accessibility feature.** A generous window set is the
difference between playable and not for a lot of people, and ADR-005 already
made them configurable. Frame it as a difficulty option, not a concession.

**Audio is currently load-bearing and should not be the only channel.** A visual
beat indicator — a pulse on the receptor line at each beat from the timing map —
costs little and makes the game legible without sound.

**Keyboard is already native**, which is a rare freebie. Do not lose it: every
dialog closes on Escape, focus is visible and trapped in modals, and the lane
keys stay guarded inside text fields.

---

## Part 7 — Performance budget

A 60 Hz frame is 16.7 ms; the whole client should be under ~8 ms of it, leaving
room for the browser and the video decoder.

- **No allocation in the hot path.** Reuse arrays and sprite objects; a garbage
  collection pause is a dropped frame, and a dropped frame during a run is a
  missed note the player will blame on themselves.
- **Position is derived from `mediaTimeMs` every frame** (§10) — never
  accumulated. A dropped frame then costs nothing, because the next frame
  computes the truth.
- The bundle is ~513 KB in one chunk today. Pixi is most of it. Code-split the
  creator and the browser away from the play path before this matters.
- A Storybook story that renders 400 notes is the standing performance check.

---

## Part 8 — Cost, and what I would cut

Storybook is a real dependency: several hundred packages and its own build. It
earns that here because of Part 1.1 — the failure states — and would not earn it
for a nine-component app with no unreachable states.

If it turns out to be too much, the fallback keeps most of the value: a `/dev`
route in the app itself, behind the same gate as admin mode, rendering the same
fixtures. Less polish, no docs pages, no dependency, and the interesting half
still works because the interesting half is the fixtures rather than the tool.

**Fixtures are the actual asset.** A `RoomState` with a player sitting out, a
chart with a tempo change, a 400-note chart, a chat log containing hostile text
— those are worth writing whatever renders them, and they should live in
`apps/web/src/fixtures/` so tests and stories share them.

---

## Part 9 — When

Not now. This belongs with Phase 4 (single player) and Phase 7 (multiplayer
rooms) — a component gallery for components that do not exist yet is a plan, not
a tool. What can be done early and cheaply:

1. **Tokens**, during Phase 4. They are needed regardless and the cost of doing
   them late is every literal already written.
2. **Fixtures**, as each phase lands, because tests want them anyway.
3. **Storybook itself**, once the room UI exists and there are unreachable
   states to point it at.
