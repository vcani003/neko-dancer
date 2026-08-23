/**
 * The signatures API.md declares, pinned as code that must compile.
 *
 * Compiled by `types.test.ts`, which asserts zero diagnostics. Each
 * `@ts-expect-error` is an assertion with teeth: if the line it guards stops
 * being an error, TypeScript reports the directive as unused (TS2578).
 *
 * Deliberately silent about `ExpiredNote`, `ActiveNote` and `EngineState`.
 * API.md names all three in the `GameEngine` signature and defines none of
 * them, so any assertion here would be Validation inventing contract — which is
 * the one thing this agent must not do. They are reported as an Architecture
 * gap instead.
 */
import {
  GameEngine,
  MediaClock,
  fitTempo,
  judge,
  type EngineOptions,
  type PressResult,
  type TempoFit,
} from '@neko/game-core';
import {
  DEFAULT_WINDOWS,
  type ChartRevision,
  type Judgment,
  type JudgmentWindows,
  type Lane,
  type RoundResult,
} from '@neko/protocol';

declare const revision: ChartRevision;
declare const windows: JudgmentWindows;

// ---------------------------------------------------------------------------
// §2 judge — takes a distance and a window set, returns one of the five grades.
// ---------------------------------------------------------------------------

const grade: Judgment = judge(35, windows);
const withDefaults: Judgment = judge(35, DEFAULT_WINDOWS);

// @ts-expect-error the window set is required, not optional
const noWindows = judge(35);
// @ts-expect-error a distance is a number, not a string
const stringDelta = judge('35', windows);
// @ts-expect-error a partial window set is not a window set
const partialWindows = judge(35, { perfectMs: 10 });

// ---------------------------------------------------------------------------
// §1 MediaClock — fed numbers, never a player. ADR-007.
// ---------------------------------------------------------------------------

const clock = new MediaClock();
const configured = new MediaClock({ resyncThresholdMs: 250 });
clock.sample(1000, 5000);
const reading: number = clock.timeMs(5016);
clock.reset();

// @ts-expect-error sample needs the wall time the reading was taken at
clock.sample(1000);
// @ts-expect-error timeMs needs the wall time to interpolate to
const noWall: number = clock.timeMs();
// @ts-expect-error the clock is handed numbers, never an adapter
const fromAdapter = new MediaClock({ adapter: {} });

// ---------------------------------------------------------------------------
// §3 GameEngine — a revision, optional windows, optional calibration.
// ---------------------------------------------------------------------------

const engine = new GameEngine({ revision });
const tuned = new GameEngine({ revision, windows: DEFAULT_WINDOWS, calibrationMs: 50 });

const options: EngineOptions = { revision };
const optionsWithCalibration: EngineOptions = { revision, calibrationMs: -50 };

// @ts-expect-error a revision is required
const noRevision = new GameEngine({});
// @ts-expect-error the engine takes a revision, not a bare notes array
const bareNotes = new GameEngine({ revision: [] });
// @ts-expect-error calibration is a number of milliseconds
const stringCalibration = new GameEngine({ revision, calibrationMs: '50' });

/**
 * `press` returns `PressResult | null`. API.md states this twice and
 * inconsistently — the signature says the whole result may be null, while
 * `PressResult.noteId` is documented as "null when nothing was in range". The
 * signature is pinned here because the §3 invariant agrees with it: "A press
 * with nothing in range returns null and is not a miss."
 */
const pressed: PressResult | null = engine.press('up', 10_000);
const judgment: Judgment | undefined = pressed?.judgment;
const delta: number | undefined = pressed?.deltaMs;
const noteId: string | null | undefined = pressed?.noteId;

// @ts-expect-error the result is nullable and must be checked before use
const unchecked: PressResult = engine.press('up', 10_000);
// @ts-expect-error a lane is a direction, never a key — ADR-001
const keyAsLane = engine.press('W', 10_000);
// @ts-expect-error a press carries the media time it happened at
const noPressTime = engine.press('up');

const lane: Lane = 'up';
engine.release(lane, 10_000);
const over: boolean = engine.isOver();
const result: RoundResult = engine.result();

// The engine consumes a protocol RoundResult, so a finished run is exactly what
// the `finish` message carries — no adapter type in between.
const forTheWire: RoundResult = tuned.result();

// ---------------------------------------------------------------------------
// §5 fitTempo — tap times in, a fit or nothing out.
// ---------------------------------------------------------------------------

const fit: TempoFit | null = fitTempo([237, 737, 1237]);
const bpm: number | undefined = fit?.bpm;
const firstBeat: number | undefined = fit?.firstBeatMs;
const confidence: number | undefined = fit?.confidence;

// A readonly array is accepted, so a caller need not copy their taps.
const readonlyTaps: readonly number[] = [237, 737];
const fromReadonly: TempoFit | null = fitTempo(readonlyTaps);

// @ts-expect-error the result is nullable
const assumedFit: TempoFit = fitTempo([237, 737]);
// @ts-expect-error tap times are numbers
const stringTaps = fitTempo(['237', '737']);

export {
  bareNotes, bpm, clock, configured, confidence, delta, engine, firstBeat, fit,
  forTheWire, fromAdapter, fromReadonly, grade, judgment, keyAsLane, lane,
  noPressTime, noRevision, noWall, noWindows, noteId, options,
  optionsWithCalibration, over, partialWindows, pressed, reading, result,
  stringCalibration, stringDelta, stringTaps, tuned, unchecked, withDefaults,
  assumedFit,
};
