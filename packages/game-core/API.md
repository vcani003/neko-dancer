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
- A disagreement beyond `resyncThresholdMs` is a seek, not drift: jump, do not
  slew.
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
   */
  calibrationMs?: number;
}

export interface PressResult {
  judgment: Judgment;
  /** Signed: negative early, positive late. After calibration. */
  deltaMs: number;
  noteId: string | null;              // null when nothing was in range
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

## 5. Tempo estimation — moved, not rewritten

```ts
export interface TempoFit { bpm: number; firstBeatMs: number; confidence: number }

/** Least-squares fit over tap times. Robust to human noise and one outlier. */
export function fitTempo(tapTimesMs: readonly number[]): TempoFit | null;
```

The existing implementation stands. It must satisfy the Part 4 fixtures:
`[237, 737, 1237, 1737, 2237]` → 120 BPM, offset ≈ 237 ms; the same with human
noise; and the same with a deliberate outlier.

## 6. Not in this package

`SongPlan` (a chart-authoring concept), chart generation, and anything that
reads a video. Generation moves in Phase 5; it is authoring, not gameplay.
