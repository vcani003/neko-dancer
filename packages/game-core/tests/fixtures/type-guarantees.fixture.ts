/**
 * The signatures API.md declares, pinned as code that must compile.
 *
 * Compiled by `types.test.ts`, which asserts zero diagnostics. Each
 * `@ts-expect-error` is an assertion with teeth: if the line it guards stops
 * being an error, TypeScript reports the directive as unused (TS2578).
 *
 * `ExpiredNote`, `ActiveNote` and `EngineState` were named in API.md's
 * signatures and left undefined — the gap this agent reported rather than
 * guessed at. API.md §5b now ratifies the declarations, so they are pinned here
 * like everything else.
 */
import {
  GameEngine,
  MediaClock,
  fitTempo,
  judge,
  type ActiveNote,
  type EngineOptions,
  type EngineState,
  type ExpiredNote,
  type PressResult,
  type TempoFit,
} from '@neko/game-core';
import {
  DEFAULT_WINDOWS,
  type ChartRevision,
  type Judgment,
  type JudgmentWindows,
  type Lane,
  type PlayerProgress,
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
// Amended after Phase 1: a stall and a coarse source that has not ticked are
// the same observation until enough time has passed, so the timeout is a
// parameter rather than a constant.
const fullyTuned = new MediaClock({
  resyncThresholdMs: 250, stallTimeoutMs: 750, slewRate: 0.05, slewDeadbandMs: 3,
});
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
 * `press` returns `PressResult | null`, and a `PressResult` always names a note.
 *
 * API.md originally said this twice and inconsistently — the signature made the
 * whole result nullable while `PressResult.noteId` was "null when nothing was
 * in range", which cannot both be true. Amended to `noteId: string`, and pinned
 * here so the nullable form cannot come back.
 */
const pressed: PressResult | null = engine.press('up', 10_000);
const judgment: Judgment | undefined = pressed?.judgment;
const delta: number | undefined = pressed?.deltaMs;
const noteId: string | undefined = pressed?.noteId;

/**
 * DEFECT — `GameEngine.ts:84` still declares `noteId: string | null`, while
 * API.md §3 (amended and ratified) declares `noteId: string`, "never null — a
 * press with nothing in range returns no PressResult at all". The behaviour is
 * right; the type is not. Every consumer is forced to handle a null that cannot
 * occur, which is the `?.`-as-silence that `ENGINEERING.md` §1 warns about.
 */
declare const claimed: PressResult;
const alwaysNamed: string = claimed.noteId;

// ---------------------------------------------------------------------------
// §5b The types API.md named and then defined. Ratified as the contract.
// ---------------------------------------------------------------------------

const expired: readonly ExpiredNote[] = engine.update(10_000);
const drawable: readonly ActiveNote[] = engine.visible(9_800, 1_000);

declare const anExpiry: ExpiredNote;
declare const aDrawable: ActiveNote;
const noteIdOfExpiry: string = anExpiry.note.id;
const when: number = aDrawable.note.timeMs;

/**
 * DEFECT — `ExpiredNote.judgment` is declared `Judgment` while both its own
 * comment and API.md §5b say it is "always MISS". A rule stated in a comment
 * and contradicted by the type is the Phase 0 tap-with-a-duration bug again:
 * an invariant enforced only where the design says not to rely on it. Typed as
 * the literal, a renderer switching on it needs no unreachable branches.
 */
const alwaysMiss: 'MISS' = anExpiry.judgment;

/**
 * `EngineState` extends `PlayerProgress`, so what the engine keeps is a
 * superset of what a room broadcasts — no adapter between the two.
 */
const engineState: EngineState = engine.state();
const asProgress: PlayerProgress = engineState;
const broadcastScore: number = asProgress.score;
const localOnly: number = engineState.wrongKeys;

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
// Amended after Phase 1: a measured millisecond figure is actionable in a way
// a 0-1 score is not, and the tap counts say how much was discarded.
const residual: number | undefined = fit?.residualMs;
const used: number | undefined = fit?.usedTaps;
const total: number | undefined = fit?.totalTaps;

// A readonly array is accepted, so a caller need not copy their taps.
const readonlyTaps: readonly number[] = [237, 737];
const fromReadonly: TempoFit | null = fitTempo(readonlyTaps);

// @ts-expect-error the result is nullable
const assumedFit: TempoFit = fitTempo([237, 737]);
// @ts-expect-error tap times are numbers
const stringTaps = fitTempo(['237', '737']);

export {
  alwaysMiss, alwaysNamed, asProgress, broadcastScore, drawable, engineState,
  expired, fullyTuned, localOnly, noteIdOfExpiry, residual, total, used, when,
  bareNotes, bpm, clock, configured, confidence, delta, engine, firstBeat, fit,
  forTheWire, fromAdapter, fromReadonly, grade, judgment, keyAsLane, lane,
  noPressTime, noRevision, noWall, noWindows, noteId, options,
  optionsWithCalibration, over, partialWindows, pressed, reading, result,
  stringCalibration, stringDelta, stringTaps, tuned, unchecked, withDefaults,
  assumedFit,
};
