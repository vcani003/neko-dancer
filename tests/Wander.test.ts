import { describe, expect, it } from 'vitest';
import {
  ROOM_BOUNDS,
  WANDER_INTERVAL_MS,
  createWalker,
  depthScale,
  step,
  wanderTarget,
} from '../src/render/Wander.ts';

describe('wanderTarget', () => {
  /**
   * Seeded rather than random: two people watching the same room should be
   * watching the same room. Independent randomness per browser would mean
   * nobody could point at anything.
   */
  it('is the same for the same cat and step, on any machine', () => {
    expect(wanderTarget('player-a', 3)).toEqual(wanderTarget('player-a', 3));
  });

  it('differs between cats and between steps', () => {
    expect(wanderTarget('a', 1)).not.toEqual(wanderTarget('b', 1));
    expect(wanderTarget('a', 1)).not.toEqual(wanderTarget('a', 2));
  });

  it('stays inside the room', () => {
    for (const seed of ['a', 'b', 'c', 'vero', 'friend']) {
      for (let stepIndex = 0; stepIndex < 40; stepIndex++) {
        const point = wanderTarget(seed, stepIndex);
        expect(point.x).toBeGreaterThanOrEqual(ROOM_BOUNDS.minX);
        expect(point.x).toBeLessThanOrEqual(ROOM_BOUNDS.maxX);
        expect(point.y).toBeGreaterThanOrEqual(ROOM_BOUNDS.minY);
        expect(point.y).toBeLessThanOrEqual(ROOM_BOUNDS.maxY);
      }
    }
  });
});

describe('step', () => {
  it('moves toward the target', () => {
    let walker = createWalker('a', 0);
    walker = { ...walker, target: { x: 0.9, y: 0.9 }, position: { x: 0.1, y: 0.5 } };
    const moved = step(walker, 'a', 100, 100);
    expect(moved.position.x).toBeGreaterThan(0.1);
    expect(moved.position.y).toBeGreaterThan(0.5);
  });

  it('slows as it arrives rather than stopping dead', () => {
    let walker = createWalker('a', 0);
    walker = { ...walker, target: { x: 0.9, y: 0.9 }, position: { x: 0.1, y: 0.9 } };

    const first = step(walker, 'a', 50, 50);
    const firstMove = first.position.x - walker.position.x;
    const second = step(first, 'a', 100, 50);
    const secondMove = second.position.x - first.position.x;

    expect(secondMove).toBeLessThan(firstMove);
  });

  /** A slow frame should move a cat further, not move it slower. */
  it('covers the same ground however the frames fall', () => {
    const start = { ...createWalker('a', 0), target: { x: 0.9, y: 0.7 }, position: { x: 0.1, y: 0.5 } };

    let coarse = start;
    coarse = step(coarse, 'a', 200, 200);

    let fine = start;
    for (let i = 1; i <= 10; i++) fine = step(fine, 'a', i * 20, 20);

    expect(fine.position.x).toBeCloseTo(coarse.position.x, 2);
  });

  it('picks somewhere new once the interval has passed', () => {
    const walker = createWalker('a', 0);
    const same = step(walker, 'a', WANDER_INTERVAL_MS - 100, 16);
    expect(same.target).toEqual(walker.target);

    const moved = step(walker, 'a', WANDER_INTERVAL_MS + 100, 16);
    expect(moved.target).not.toEqual(walker.target);
  });

  it('faces the way it is walking, and does not moonwalk', () => {
    const walker = { ...createWalker('a', 0), position: { x: 0.5, y: 0.7 }, target: { x: 0.9, y: 0.7 } };
    expect(step(walker, 'a', 100, 50).facing).toBe(1);

    const other = { ...walker, target: { x: 0.1, y: 0.7 } };
    expect(step(other, 'a', 100, 50).facing).toBe(-1);
  });

  /** During a round the cats dance where they are; strolling pulls the eye. */
  it('stands still when frozen', () => {
    const walker = { ...createWalker('a', 0), target: { x: 0.9, y: 0.9 } };
    expect(step(walker, 'a', 5000, 500, { frozen: true })).toBe(walker);
  });

  it('never leaves the room, however long it walks', () => {
    let walker = createWalker('a', 0);
    for (let t = 0; t < 60_000; t += 100) {
      walker = step(walker, 'a', t, 100);
      expect(walker.position.x).toBeGreaterThanOrEqual(ROOM_BOUNDS.minX - 1e-9);
      expect(walker.position.x).toBeLessThanOrEqual(ROOM_BOUNDS.maxX + 1e-9);
      expect(walker.position.y).toBeGreaterThanOrEqual(ROOM_BOUNDS.minY - 1e-9);
      expect(walker.position.y).toBeLessThanOrEqual(ROOM_BOUNDS.maxY + 1e-9);
    }
  });
});

describe('depthScale', () => {
  /** A flat room reads as a strip of stickers; a little perspective fixes it. */
  it('draws cats at the back smaller than cats at the front', () => {
    expect(depthScale(ROOM_BOUNDS.maxY)).toBeGreaterThan(depthScale(ROOM_BOUNDS.minY));
  });

  it('stays within its range outside the room', () => {
    expect(depthScale(-5)).toBeCloseTo(0.68);
    expect(depthScale(5)).toBeCloseTo(1);
  });
});
