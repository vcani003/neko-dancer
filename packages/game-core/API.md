# `@neko/game-core` — the agreed surface

**Owned by Architecture. Phase 1 implements this; it does not redesign it.**

Both the Game Core agent and the Validation agent work from this file. If it is
wrong, that is a conversation with Architecture and an amendment here — not a
change made in passing by whichever agent noticed first.

---

## The one rule

**Game Core takes numbers.** ADR-007. It never imports `PlaybackAdapter`, never
holds a player, never calls `play()`. It is handed `mediaTimeMs` and returns
judgments.

Consequences worth stating, because they are the reason for the rule:

- It can be tested by passing `10_000`. No fake adapter, no mock, no clock.
- It cannot start, stop or seek anything, so it cannot fight the UI over
  playback state.
- Phase 1's import-graph gate becomes trivial: there is nothing
  playback-shaped in the package to import.

Forbidden imports, enforced by a test: `react`, `react-dom`, `pixi.js`, `ws`,
anything YouTube, anything database, and `apps/*`. `@neko/protocol` is the only
permitted dependency.

---

## 1. `MediaClock` — smoothing a coarse source

The clock a video gives you is bad: YouTube's `getCurrentTime()` moves in steps
of a few hundred milliseconds, stalls while buffering, and jumps on a seek.
Judging directly against it would quantise every hit to those steps.

This is the existing `GameClock`, restated as pure arithmetic over numbers. It
is **fed** samples rather than pulling them.

```ts
export interface MediaClockOptions {
  /** Beyond this much disagreement, stop correcting and jump. Default 250. */
  resyncThresholdMs?: number;
  /**
   * How long a source may report the same time before the clock stops.
   * Default 750, and it must stay comfortably above the source's coarsest step.
   *
   * **Amended after Phase 1.** The original document asked for two things that
   * could not both be built: "time advances between samples, it does not
   * freeze" and "a source that stalls must stop the clock". Those are only
   * reconcilable by distinguishing *no samples yet* from *samples that are not
   * moving* — and a stalled video and a coarse one that has not ticked are the
   * same observation until enough time has passed. That distinction needs a
   * timeout, which the document did not provide.
   */
  stallTimeoutMs?: number;
  slewRate?: number;
  slewDeadbandMs?: number;
}

export class MediaClock {
  constructor(options?: MediaClockOptions);

  /** A reading from the media source, and the wall time it was taken at. */
  sample(mediaTimeMs: number, atWallMs: number): void;

  /** Where the music is now, interpolated between samples. */
  timeMs(atWallMs: number): number;

  /** Forget everything. Called on seek, stop, and before a new round. */
  reset(): void;
}
```

**Behaviour that must be preserved** — it was arrived at by measurement and
losing it would be a regression:

- Between samples, time advances with wall time. It does not freeze.
- Persistent bias is corrected by **minimum drift**, not mean drift. A coarsely
  quantised source makes mean drift invent lag that is not there.
- A seek is **direction-aware**, and this was wrong in the original document.
  A quantised source is a *lower bound* on where the music is, so running ahead
  of it by up to one step is not disagreement — it is the expected state
  between ticks. A symmetric rule made the clock jump back a step just before
  each tick and forward again after: sawtoothing by a quarter-second while
  tracking a perfectly healthy video, and finishing 158 ms behind it. A seek is
  therefore a *forward* leap beyond the threshold, or a source reading that
  **decreases** — which playback never does at any coarseness.
- A source that stalls must stop the clock, not let it run on. Notes must not
  silently expire against a video that has stopped.

## 2. `judge` — one press against one window set

```ts
import type { Judgment, JudgmentWindows } from '@neko/protocol';

/** `absDeltaMs` is |press − note|. Returns MISS beyond `okayMs`. */
export function judge(absDeltaMs: number, windows: JudgmentWindows): Judgment;
```

Boundaries are **inclusive of the tier they name** — `35` is `PERFECT`, `36` is
`GREAT`. ADR-005 pins all four on both sides.

## 3. `GameEngine` — the round

```ts
import type { ChartRevision, Judgment, Lane, RoundResult } from '@neko/protocol';

export interface EngineOptions {
  revision: ChartRevision;
  windows?: JudgmentWindows;          // defaults to DEFAULT_WINDOWS
  /**
   * The player's calibration. §13, and the second of the three offsets.
   *
   * ADDED TO THE PLAYER'S PRESS TIME. A player who consistently hits 50 ms
   * early sets `+50`, which moves their presses later and lands them on the
   * note. It never touches the chart, and the chart's timing map never
   * reaches this class at all — note times are already absolute (ADR-003).
   *
   * **Amended after Phase 1: it applies to `update` as well as `press`.**
   * Applied to presses alone, a consistently-late player with `-50` is
   * stranded — their press at raw 10 200 judges as 10 150 and would be OKAY,
   * but the note expired at raw 10 160 and is already gone. Calibration shifts
   * the *player's whole timeline*, and expiry is a deadline measured against
   * that timeline. Rendering deliberately stays on raw media time, because the
   * player should see the note where the video puts it.
   */
  calibrationMs?: number;
}

export interface PressResult {
  judgment: Judgment;
  /** Signed: negative early, positive late. After calibration. */
  deltaMs: number;
  /** Never null — a press with nothing in range returns no PressResult at all. */
  noteId: string;
}

export class GameEngine {
  constructor(options: EngineOptions);

  /**
   * Advance to this moment. Returns notes that have just expired unhit.
   *
   * Must be idempotent for a given time and must tolerate a time that has not
   * moved — a stalled clock calls this repeatedly with the same number.
   */
  update(mediaTimeMs: number): readonly ExpiredNote[];

  /** A key went down. `atMediaTimeMs` is when it went down, not when it was handled. */
  press(lane: Lane, atMediaTimeMs: number): PressResult | null;

  /** A key came up. Only meaningful for holds; safe to call otherwise. */
  release(lane: Lane, atMediaTimeMs: number): void;

  /** Notes worth drawing right now, nearest first. */
  visible(mediaTimeMs: number, leadMs: number): readonly ActiveNote[];

  state(): EngineState;
  /** True once the run is over — completed OR failed. */
  isOver(): boolean;
  result(): RoundResult;
}
```

**Invariants:**

- **Input time is the press time, never the handling time.** A press carries the
  moment the key went down; a frame of handling delay must not become 16 ms of
  error.
- **One press claims at most one note**, the nearest unjudged one in that lane
  within `okayMs`. A press with nothing in range returns `null` and is not a
  miss — mashing an empty lane costs nothing but wastes the press.

  The old engine charged −3 health and broke the combo for a press with nothing
  in range, and this document removed that without arguing for it. **Measured
  before accepting the removal**: pressing all four lanes every 20 ms for a
  40-note chart scores 40 × `OKAY`, 14% accuracy, 85 points. Mashing is not an
  auto-play exploit, because the earliest press inside the window claims the
  note and a note is judged once — so mashing *guarantees the worst passing
  grade*, which is a better deterrent than a health penalty and needs no rule.

  What it does still guarantee is **survival**: a masher never fails. Whether
  that matters is a game-design call rather than a correctness one, and it is
  open — see the note in `IMPLEMENTATION-PLAN.md`.
- **A note is judged once.** Never re-judged, never un-judged.
- **The engine walks forward.** It never looks back at a note it has passed,
  which is why note order is validated upstream.
- **A failed run stops judging** and never reports `completed: true`.

## 4. Holds — new in Phase 1

A `HoldNote` is judged twice: its **start**, exactly like a tap, and its
**sustain**. Keep the first version simple:

- Missing the start misses the whole hold.
- Releasing early ends it; the hold scores by the fraction held.
- Still holding at the end scores it in full.

Anything cleverer — re-grabbing a dropped hold, partial credit curves — is
Phase 8. Say so in a comment rather than building it.

## 5. Tempo estimation — **rewritten**, and the original instruction was wrong

```ts
export interface TempoFit { bpm: number; firstBeatMs: number; confidence: number }

/** Least-squares fit over tap times. Robust to human noise and one outlier. */
export function fitTempo(tapTimesMs: readonly number[]): TempoFit | null;
```

This section originally said "the existing implementation stands". It could
not: the old fit was a least squares over **array positions**, and positions are
not beats. A doubled tap renumbers every beat after it, a missed beat renumbers
them the other way, and a late tap drags the slope. Measured against the Part 4
fixtures it produced 156, 111.6, 92.3 and 43.0 BPM — so the document demanded
outlier robustness from an implementation structurally incapable of it.

The replacement takes the **median gap** as the period, assigns each tap a beat
number by rounding, re-centres the phase on the **median offset** so a wildly
early first tap cannot throw every other tap off the grid, discards taps more
than a quarter-beat off it, and only then fits least squares over `(beat,
time)`. All five Part 4 fixtures land on 120.000 BPM / 237 ms.

```ts
export interface TempoFit {
  bpm: number;
  firstBeatMs: number;
  /** Agreement × coverage: how well the used taps fit, scaled by how many were usable. */
  confidence: number;
  /** Kept because a measured millisecond figure is actionable in a way a 0–1 score is not. */
  residualMs: number;
  usedTaps: number;
  totalTaps: number;
}
```

## 5b. Types this document named and failed to define

`ExpiredNote`, `ActiveNote` and `EngineState` were referenced in signatures and
never declared — an Architecture bug, and the most likely place an
implementation would have diverged from intent. They now live in
`src/GameEngine.ts` and `src/notes.ts`, and **those declarations are ratified as
the contract.** Notable in them:

- `ExpiredNote.judgment` is always `MISS`, named rather than implied so a
  renderer can feed an expiry and a judged press through one code path.
- `EngineState` extends `PlayerProgress` from `@neko/protocol`, so the shape
  broadcast to a room is a subset of the shape the engine already keeps.
- `wrongKeys`, `holdsDropped`, `meanDeltaMs` are engine-local. `meanDeltaMs` is
  what makes an offset suggestion possible: signed mean error is the number to
  hand a player who keeps hitting early.

## 6. Not in this package

`SongPlan` (a chart-authoring concept), chart generation, and anything that
reads a video. Generation moves in Phase 5; it is authoring, not gameplay.
