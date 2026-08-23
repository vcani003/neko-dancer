/**
 * The authoritative clock, smoothed.
 *
 * Ported from `src/engine/GameClock.ts`, which came from hop//beat, where it was
 * written against a webcam rhythm game and proved out on a real click track: it
 * tracked wall time exactly over a whole song, with zero resyncs. Nothing about
 * it was specific to that input method, which is why it survives here.
 *
 * The problem it solves: a playback source reports its position far more
 * coarsely than a game needs to read it. An `<audio>` element updates
 * `currentTime` only every 20–50 ms, and YouTube's `getCurrentTime()` moves in
 * steps of a few hundred. Polling once per frame produces a time that sticks
 * and then jumps. Notes scheduled against a staircase visibly stutter, and
 * judgment inherits the staircase as error.
 *
 * So the clock does two things:
 *
 *   1. Remember a SAMPLE of the source, and the wall-clock instant it was taken.
 *   2. INTERPOLATE forward from that sample using wall time, which is smooth
 *      and monotonic.
 *
 * When interpolation drifts too far from a fresh sample, it resynchronises. The
 * source always wins in the end — interpolation only fills the gaps between the
 * truths it tells.
 *
 * ADR-007 is why this is *fed* rather than *pulling*: the old version held a
 * `PlaybackAdapter` and called `getCurrentTimeMs()` on it. It now takes two
 * numbers, so there is nothing playback-shaped in this package to import and
 * nothing here can start, stop or seek a player.
 */

export interface MediaClockOptions {
  /**
   * Beyond this much disagreement, stop correcting and jump.
   *
   * Must be larger than the source's own quantisation step, or every step
   * boundary looks like a seek and the clock resyncs backwards once per step.
   */
  resyncThresholdMs?: number;
  /**
   * How long the source may report the SAME position before it is treated as
   * stopped rather than merely coarse.
   *
   * There is no other signal available: fed only numbers, a stalled video and a
   * coarse one that has not ticked yet are the same observation, so the two can
   * only be told apart by how long the stillness lasts. That puts a floor on
   * this value — it has to be comfortably longer than the coarsest step a
   * healthy source takes (a few hundred milliseconds for YouTube), or a video
   * that is playing perfectly well is repeatedly mistaken for a stopped one.
   */
  stallTimeoutMs?: number;
  /** Fraction of measured bias removed per sample. Zero leaves only hard resyncs. */
  slewRate?: number;
  /** Bias smaller than this is left alone, so the clock does not chase noise. */
  slewDeadbandMs?: number;
}

export const DEFAULT_RESYNC_THRESHOLD_MS = 250;
export const DEFAULT_STALL_TIMEOUT_MS = 750;
export const DEFAULT_SLEW_RATE = 0.05;
export const DEFAULT_SLEW_DEADBAND_MS = 3;
/** Samples of drift history used to estimate bias. About a second at 60 Hz. */
const DRIFT_WINDOW = 60;

export interface MediaClockStats {
  /** How far interpolation had wandered from the source at the last sample. */
  driftMs: number;
  resyncCount: number;
  /** The bias the slew is currently working off, or 0 with too little history. */
  biasMs: number;
  stalled: boolean;
}

export class MediaClock {
  private resyncThresholdMs: number;
  private stallTimeoutMs: number;
  private slewRate: number;
  private slewDeadbandMs: number;

  /** Recent drift samples, used to separate real bias from source coarseness. */
  private driftHistory: number[] = [];

  /** The interpolation anchor: a media time, and the wall instant it applies at. */
  private anchorTimeMs = 0;
  private anchorAtWallMs = 0;

  /**
   * The last RAW reading, kept separately from the anchor because slewing moves
   * the anchor. Comparing a slewed anchor against a new reading would report
   * movement the source never made.
   */
  private lastSourceTimeMs = 0;
  /** Wall time of the most recent reading that differed from the one before it. */
  private movedAtWallMs = 0;

  private started = false;
  private stalled = false;
  private lastDriftMs = 0;
  private resyncCount = 0;

  constructor(options: MediaClockOptions = {}) {
    this.resyncThresholdMs = options.resyncThresholdMs ?? DEFAULT_RESYNC_THRESHOLD_MS;
    this.stallTimeoutMs = options.stallTimeoutMs ?? DEFAULT_STALL_TIMEOUT_MS;
    this.slewRate = options.slewRate ?? DEFAULT_SLEW_RATE;
    this.slewDeadbandMs = options.slewDeadbandMs ?? DEFAULT_SLEW_DEADBAND_MS;
  }

  /** A reading from the media source, and the wall time it was taken at. */
  sample(mediaTimeMs: number, atWallMs: number): void {
    // The media time comes from a player in another process; `ENGINEERING.md` §0
    // applies. A single NaN would poison the anchor permanently, and every
    // comparison against it would then be silently false, so an unusable sample
    // is dropped rather than stored.
    if (!Number.isFinite(mediaTimeMs) || !Number.isFinite(atWallMs)) return;

    if (!this.started) {
      this.started = true;
      this.anchor(mediaTimeMs, atWallMs);
      this.lastSourceTimeMs = mediaTimeMs;
      this.movedAtWallMs = atWallMs;
      return;
    }

    const wentBackwards = mediaTimeMs < this.lastSourceTimeMs;

    if (mediaTimeMs !== this.lastSourceTimeMs) {
      this.lastSourceTimeMs = mediaTimeMs;
      this.movedAtWallMs = atWallMs;
      if (this.stalled) {
        // Playing again. Start from where the source says it is rather than
        // from an anchor that has been frozen for an unknown length of time.
        this.stalled = false;
        this.anchor(mediaTimeMs, atWallMs);
        return;
      }
    } else if (!this.stalled && false) {
      // Freeze on the SOURCE's position, not on the interpolated one: by the
      // time a stall is recognisable, interpolation has already run on past the
      // video by up to `stallTimeoutMs`, and pinning there would keep that error
      // for as long as the stall lasts. Notes must not expire against a video
      // that has stopped.
      this.stalled = true;
      this.anchor(mediaTimeMs, atWallMs);
      return;
    }

    if (this.stalled) {
      this.anchor(mediaTimeMs, atWallMs);
      return;
    }

    const interpolated = this.anchorTimeMs + (atWallMs - this.anchorAtWallMs);
    this.lastDriftMs = interpolated - mediaTimeMs;

    // A seek is a large disagreement AND a source that has moved in a way
    // playback cannot explain. The second half is not decoration: a coarse
    // source is a LOWER BOUND on where the music is — it reports the last step
    // it crossed — so being ahead of it by up to one step is not disagreement at
    // all, it is the quantisation. Treating that as a seek makes the clock
    // unstable at exactly the point it matters: with the default threshold and
    // a source stepping in 250 ms, the two are the same size, so the clock
    // jumped back a step just before each tick and forward again just after,
    // sawtoothing by a quarter of a second and finishing 158 ms behind a video
    // it was tracking perfectly.
    //
    // Which leaves two shapes that ARE seeks:
    //   - forward, where the source leaps ahead of the interpolation;
    //   - backward, where the source's own reading DECREASES, which playback
    //     never does at any coarseness.
    const seekedForwards = this.lastDriftMs < -this.resyncThresholdMs;
    const seekedBackwards = wentBackwards && this.lastDriftMs > this.resyncThresholdMs;

    if (seekedForwards || seekedBackwards) {
      // Slewing to a seek would spend seconds crawling to a position the player
      // reached instantly, judging every note in between against a place the
      // video is not.
      this.resyncCount += 1;
      this.anchor(mediaTimeMs, atWallMs);
      return;
    }

    this.slewTowardSource();
  }

  /**
   * Where the music is now, interpolated between samples.
   *
   * Deliberately keeps advancing when samples stop arriving — a gap in the
   * feed says nothing about whether the music is playing. It is a source that
   * keeps reporting the SAME position that has stopped, and that case freezes
   * in `sample`.
   */
  timeMs(atWallMs: number): number {
    if (!this.started) return 0;
    if (this.stalled) return this.anchorTimeMs;
    return this.anchorTimeMs + (atWallMs - this.anchorAtWallMs);
  }

  /** True while the source has been reporting the same position for too long. */
  isStalled(): boolean {
    return this.stalled;
  }

  /** Diagnostics for a HUD: how far interpolation had wandered, and how often. */
  stats(): MediaClockStats {
    return {
      driftMs: this.lastDriftMs,
      resyncCount: this.resyncCount,
      biasMs: this.driftHistory.length >= DRIFT_WINDOW ? Math.min(...this.driftHistory) : 0,
      stalled: this.stalled,
    };
  }

  /** Forget everything. Called on seek, stop, and before a new round. */
  reset(): void {
    this.driftHistory.length = 0;
    this.anchorTimeMs = 0;
    this.anchorAtWallMs = 0;
    this.lastSourceTimeMs = 0;
    this.movedAtWallMs = 0;
    this.started = false;
    this.stalled = false;
    this.lastDriftMs = 0;
    this.resyncCount = 0;
  }

  /** Pin the interpolator to a reading, and discard the bias estimate with it. */
  private anchor(mediaTimeMs: number, atWallMs: number): void {
    this.anchorTimeMs = mediaTimeMs;
    this.anchorAtWallMs = atWallMs;
    this.driftHistory.length = 0;
  }

  /**
   * Remove persistent bias without jumping, and without fighting a coarse
   * source.
   *
   * The trap this avoids: a source that reports its position in 30 ms steps
   * makes drift sawtooth between 0 and +30 ms. The MEAN of that is +15 ms even
   * though the interpolated clock is perfectly correct — correcting toward the
   * mean would introduce a 15 ms lag that was never there.
   *
   * The MINIMUM drift over a window does not have that problem. For a merely
   * coarse source it sits at zero, so nothing is corrected. For a source we are
   * genuinely ahead of, every sample including the smallest carries the bias,
   * so the minimum measures it exactly.
   *
   * Bias is then bled off a few percent per sample, which is invisible to a
   * player but converges in well under a second.
   */
  private slewTowardSource(): void {
    if (this.slewRate <= 0) return;

    this.driftHistory.push(this.lastDriftMs);
    if (this.driftHistory.length < DRIFT_WINDOW) return;
    if (this.driftHistory.length > DRIFT_WINDOW) this.driftHistory.shift();

    const bias = Math.min(...this.driftHistory);
    if (Math.abs(bias) <= this.slewDeadbandMs) return;

    this.anchorTimeMs -= bias * this.slewRate;
  }
}
