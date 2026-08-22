/**
 * Cats moving about the room.
 *
 * Between rounds the avatars wander rather than standing in a row, which is
 * most of what makes a lobby feel like a place instead of a list. During a
 * round they stop and dance where they are — moving while playing would pull
 * the eye away from the arrows.
 *
 * Pure functions over a position and a clock, so the movement can be tested.
 * "It looks about right" is not a claim anyone can check later.
 */

export interface Point {
  x: number;
  y: number;
}

export interface Walker {
  position: Point;
  target: Point;
  /** When the current target was chosen, in ms. */
  chosenAtMs: number;
  /** Facing: -1 left, 1 right. Kept so a cat does not moonwalk. */
  facing: -1 | 1;
}

/** Room coordinates are 0–1 on both axes, like everything else here. */
/**
 * Where a cat may stand.
 *
 * The floor starts at 0.42 and the near edge is 0.92; keeping cats inside
 * that, with a margin, stops one standing exactly on the horizon — which reads
 * as floating against the back wall rather than standing at the far end of a
 * room.
 */
export const ROOM_BOUNDS = { minX: 0.1, maxX: 0.9, minY: 0.52, maxY: 0.9 };

/** How long a cat holds a destination before picking another. */
export const WANDER_INTERVAL_MS = 3200;
/** Fraction of the remaining distance covered per second. */
const APPROACH_RATE = 1.6;
/** Below this, the cat has arrived and should stop rather than jitter. */
const ARRIVED = 0.004;

/**
 * A deterministic position from an id and a step number.
 *
 * Seeded rather than random so every client draws the same cat in the same
 * place. Two people watching the same room should be watching the same room —
 * if each browser wandered independently, nobody could point at anything.
 */
export function wanderTarget(seed: string, step: number): Point {
  let hash = 2166136261;
  const text = `${seed}:${step}`;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const a = ((hash >>> 0) % 10_000) / 10_000;
  const b = (((hash >>> 13) >>> 0) % 10_000) / 10_000;

  return {
    x: ROOM_BOUNDS.minX + a * (ROOM_BOUNDS.maxX - ROOM_BOUNDS.minX),
    y: ROOM_BOUNDS.minY + b * (ROOM_BOUNDS.maxY - ROOM_BOUNDS.minY),
  };
}

export function createWalker(seed: string, nowMs: number): Walker {
  const start = wanderTarget(seed, 0);
  return { position: { ...start }, target: start, chosenAtMs: nowMs, facing: 1 };
}

export interface WalkOptions {
  /** Frozen cats stay put — during a round, dancing beats strolling. */
  frozen?: boolean;
}

/**
 * Advance a walker.
 *
 * Exponential approach rather than constant speed: a cat slows as it arrives,
 * which reads as deciding to stop rather than hitting a wall. Framerate
 * independent, so a slow frame moves it further rather than moving it slower.
 */
export function step(
  walker: Walker,
  seed: string,
  nowMs: number,
  deltaMs: number,
  options: WalkOptions = {},
): Walker {
  if (options.frozen) return walker;

  let { target, chosenAtMs, facing } = walker;

  if (nowMs - chosenAtMs >= WANDER_INTERVAL_MS) {
    const stepIndex = Math.floor(nowMs / WANDER_INTERVAL_MS);
    target = wanderTarget(seed, stepIndex);
    chosenAtMs = nowMs;
  }

  const dx = target.x - walker.position.x;
  const dy = target.y - walker.position.y;

  if (Math.abs(dx) > ARRIVED) facing = dx > 0 ? 1 : -1;

  const t = 1 - Math.exp((-APPROACH_RATE * deltaMs) / 1000);
  const position = {
    x: clamp(walker.position.x + dx * t, ROOM_BOUNDS.minX, ROOM_BOUNDS.maxX),
    y: clamp(walker.position.y + dy * t, ROOM_BOUNDS.minY, ROOM_BOUNDS.maxY),
  };

  return { position, target, chosenAtMs, facing };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Scale by depth: a cat further up the room is further away.
 *
 * A flat room reads as a strip of stickers. A little perspective is all it
 * takes for it to read as a floor people are standing on.
 */
export function depthScale(y: number, near = 1, far = 0.68): number {
  const t = (y - ROOM_BOUNDS.minY) / (ROOM_BOUNDS.maxY - ROOM_BOUNDS.minY);
  return far + (near - far) * clamp(t, 0, 1);
}
