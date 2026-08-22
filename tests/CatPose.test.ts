import { describe, expect, it } from 'vitest';
import {
  LANE_POSES,
  POSE_HOLD_MS,
  REST_POSE,
  blend,
  decay,
  poseAt,
  type CatState,
} from '../src/render/CatPose.ts';
import { LANES } from '../src/charts/schema.ts';

const state = (over: Partial<CatState> = {}): CatState => ({
  lane: null,
  hitAtMs: 0,
  missAtMs: 0,
  bpm: 0,
  playbackMs: 0,
  nowMs: 1000,
  ...over,
});

describe('lane poses', () => {
  /**
   * A glance at the cat should say which arrow was hit — that is the reason a
   * dancing avatar earns its screen space instead of a score counter.
   */
  it('gives every lane a visibly different shape', () => {
    const shapes = LANES.map((lane) => JSON.stringify(LANE_POSES[lane]));
    expect(new Set(shapes).size).toBe(LANES.length);
  });

  it('leans the way the arrow points', () => {
    expect(LANE_POSES.left.lean).toBeLessThan(0);
    expect(LANE_POSES.right.lean).toBeGreaterThan(0);
  });

  it('reaches up for up and crouches for down', () => {
    expect(LANE_POSES.up.leftArm).toBeGreaterThan(0.5);
    expect(LANE_POSES.up.rightArm).toBeGreaterThan(0.5);
    expect(LANE_POSES.down.crouch).toBeGreaterThan(0.5);
  });
});

describe('blend', () => {
  it('returns each end exactly', () => {
    expect(blend(REST_POSE, LANE_POSES.up, 0)).toEqual(REST_POSE);
    expect(blend(REST_POSE, LANE_POSES.up, 1)).toEqual(LANE_POSES.up);
  });

  it('sits between the two halfway', () => {
    expect(blend(REST_POSE, LANE_POSES.right, 0.5).lean).toBeCloseTo(LANE_POSES.right.lean / 2);
  });

  it('clamps rather than overshooting', () => {
    expect(blend(REST_POSE, LANE_POSES.up, 5)).toEqual(LANE_POSES.up);
    expect(blend(REST_POSE, LANE_POSES.up, -5)).toEqual(REST_POSE);
  });
});

describe('decay', () => {
  it('is full at the moment of the hit and gone by the end', () => {
    expect(decay(0)).toBe(1);
    expect(decay(POSE_HOLD_MS)).toBe(0);
    expect(decay(POSE_HOLD_MS * 2)).toBe(0);
  });

  it('never increases', () => {
    let previous = Infinity;
    for (let t = 0; t <= POSE_HOLD_MS; t += 10) {
      const value = decay(t);
      expect(value).toBeLessThanOrEqual(previous);
      previous = value;
    }
  });

  /** Eases out: a movement lands sharply and relaxes slowly, as a body does. */
  it('spends most of its time near the pose', () => {
    expect(decay(POSE_HOLD_MS * 0.5)).toBeGreaterThan(0.5);
  });
});

describe('poseAt', () => {
  it('stands still when there is no music and no input', () => {
    expect(poseAt(state())).toEqual(REST_POSE);
  });

  it('bobs with the song rather than with the frame rate', () => {
    const a = poseAt(state({ bpm: 120, playbackMs: 0 }));
    const b = poseAt(state({ bpm: 120, playbackMs: 250 }));
    expect(a).not.toEqual(b);

    // Same playback position, different wall clock: the same pose.
    const c = poseAt(state({ bpm: 120, playbackMs: 250, nowMs: 99_999 }));
    expect(c).toEqual(b);
  });

  it('stops moving when the song stops', () => {
    const held = poseAt(state({ bpm: 120, playbackMs: 400, nowMs: 1000 }));
    const later = poseAt(state({ bpm: 120, playbackMs: 400, nowMs: 5000 }));
    expect(later).toEqual(held);
  });

  it('takes the lane pose at the moment of a hit', () => {
    const pose = poseAt(state({ lane: 'right', hitAtMs: 1000, nowMs: 1000 }));
    expect(pose.lean).toBeCloseTo(LANE_POSES.right.lean);
  });

  it('returns to idle once the hold has passed', () => {
    const pose = poseAt(state({ lane: 'right', hitAtMs: 1000, nowMs: 1000 + POSE_HOLD_MS + 1 }));
    expect(pose).toEqual(REST_POSE);
  });

  it('eases back rather than snapping', () => {
    const at = (offset: number) =>
      poseAt(state({ lane: 'left', hitAtMs: 1000, nowMs: 1000 + offset })).lean;
    const samples = [0, 60, 120, 180, 240].map(at);
    for (let i = 1; i < samples.length; i++) {
      // Leaning left is negative, so relaxing means rising toward zero.
      expect(samples[i]).toBeGreaterThan(samples[i - 1]);
    }
  });

  /** A miss should be felt, so it overrides whatever the cat was doing. */
  it('droops on a miss, over a hit', () => {
    const pose = poseAt(
      state({ lane: 'up', hitAtMs: 1000, missAtMs: 1000, nowMs: 1000, bpm: 120 }),
    );
    expect(pose.crouch).toBeGreaterThan(0.2);
    expect(pose.leftArm).toBeLessThan(LANE_POSES.up.leftArm);
  });

  it('recovers from a miss on its own', () => {
    const pose = poseAt(state({ missAtMs: 1000, nowMs: 1000 + 500 }));
    expect(pose).toEqual(REST_POSE);
  });

  it('never produces a value a renderer would choke on', () => {
    for (const lane of LANES) {
      for (let offset = 0; offset <= POSE_HOLD_MS; offset += 20) {
        const pose = poseAt(state({ lane, hitAtMs: 0, nowMs: offset, bpm: 128, playbackMs: offset }));
        for (const [key, value] of Object.entries(pose)) {
          expect(Number.isFinite(value), `${lane} ${key}`).toBe(true);
          expect(Math.abs(value), `${lane} ${key}`).toBeLessThanOrEqual(2);
        }
      }
    }
  });
});
