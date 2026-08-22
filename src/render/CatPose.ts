/**
 * The cat's pose, as numbers.
 *
 * Separated from the drawing so the movement can be tested. A dancer that
 * jitters, snaps, or forgets to return to rest is a bug you can only see by
 * staring at it — unless the pose is a function, in which case it is a bug you
 * can assert about.
 *
 * The cat is drawn procedurally rather than from a sprite sheet. That is partly
 * hop//beat's instinct — generate the figure from numbers, no rigged asset —
 * and partly a hard requirement: the original's cat belongs to Atelier 801, and
 * this one has to be ours.
 */
import type { Lane } from '../charts/schema.ts';

export interface CatPose {
  /** Body lean, -1 fully left to 1 fully right. */
  lean: number;
  /** Crouch, 0 standing to 1 down. */
  crouch: number;
  /** Arm raise, 0 down to 1 overhead. Left and right move independently. */
  leftArm: number;
  rightArm: number;
  /** Vertical bounce in body-heights, positive is up. */
  hop: number;
  /** Head tilt in radians. */
  tilt: number;
  /** Tail sway, -1 to 1. */
  tail: number;
}

export const REST_POSE: CatPose = {
  lean: 0,
  crouch: 0,
  leftArm: 0,
  rightArm: 0,
  hop: 0,
  tilt: 0,
  tail: 0,
};

/**
 * What each lane looks like.
 *
 * One distinct shape per lane, so a glance at the cat tells you which arrow
 * was hit — that is the entire reason a dancing avatar earns its screen space
 * rather than a score counter.
 */
export const LANE_POSES: Record<Lane, CatPose> = {
  left: { ...REST_POSE, lean: -1, leftArm: 0.75, tilt: -0.18, tail: -0.8 },
  right: { ...REST_POSE, lean: 1, rightArm: 0.75, tilt: 0.18, tail: 0.8 },
  up: { ...REST_POSE, leftArm: 1, rightArm: 1, hop: 0.22, tilt: 0 },
  down: { ...REST_POSE, crouch: 1, leftArm: -0.2, rightArm: -0.2, tilt: 0.05 },
};

export function blend(a: CatPose, b: CatPose, t: number): CatPose {
  const k = Math.min(1, Math.max(0, t));
  const mix = (x: number, y: number) => x + (y - x) * k;
  return {
    lean: mix(a.lean, b.lean),
    crouch: mix(a.crouch, b.crouch),
    leftArm: mix(a.leftArm, b.leftArm),
    rightArm: mix(a.rightArm, b.rightArm),
    hop: mix(a.hop, b.hop),
    tilt: mix(a.tilt, b.tilt),
    tail: mix(a.tail, b.tail),
  };
}

/** How long a lane pose takes to decay back to idle. */
export const POSE_HOLD_MS = 260;

/**
 * Ease out, so a movement lands sharply and relaxes slowly.
 *
 * Linear decay reads as mechanical: the cat would return to rest at the same
 * speed it left, which no body does. Cubic ease-out spends most of its time
 * near the pose and drifts back, which is what a held beat looks like.
 */
export function decay(elapsedMs: number, holdMs = POSE_HOLD_MS): number {
  if (elapsedMs <= 0) return 1;
  if (elapsedMs >= holdMs) return 0;
  const t = elapsedMs / holdMs;
  return 1 - t * t * t;
}

export interface CatState {
  /** The lane most recently hit, or null if nothing yet. */
  lane: Lane | null;
  /** When that hit happened, in the same clock as `nowMs`. */
  hitAtMs: number;
  /** Set on a miss, which droops rather than poses. */
  missAtMs: number;
  /** Beats per minute, for the idle bob. Zero means stand still. */
  bpm: number;
  /** Playback position, so the bob is on the music rather than on the frame. */
  playbackMs: number;
  nowMs: number;
}

const MISS_DROOP_MS = 400;

/**
 * The pose right now: idle bob, plus whatever the last input did to it.
 *
 * The bob is driven by PLAYBACK time rather than wall time, so the cat moves
 * with the song and not with the frame rate — and stops when the song does.
 */
export function poseAt(state: CatState): CatPose {
  const beatMs = state.bpm > 0 ? 60_000 / state.bpm : 0;

  // Idle: a shallow two-beat sway with a bounce on each beat.
  let pose: CatPose = { ...REST_POSE };
  if (beatMs > 0) {
    const beats = state.playbackMs / beatMs;
    pose = {
      ...pose,
      lean: Math.sin((beats / 2) * Math.PI) * 0.18,
      hop: Math.abs(Math.sin(beats * Math.PI)) * 0.05,
      tail: Math.sin((beats / 2) * Math.PI + 0.6) * 0.5,
      tilt: Math.sin((beats / 4) * Math.PI) * 0.05,
    };
  }

  // A miss droops, and takes priority — the player should feel it.
  const sinceMiss = state.nowMs - state.missAtMs;
  if (state.missAtMs > 0 && sinceMiss < MISS_DROOP_MS) {
    const amount = decay(sinceMiss, MISS_DROOP_MS);
    return blend(pose, { ...REST_POSE, crouch: 0.35, tilt: 0.4, leftArm: -0.3, rightArm: -0.3 }, amount);
  }

  if (!state.lane) return pose;

  const sinceHit = state.nowMs - state.hitAtMs;
  const amount = decay(sinceHit);
  if (amount <= 0) return pose;

  return blend(pose, LANE_POSES[state.lane], amount);
}
