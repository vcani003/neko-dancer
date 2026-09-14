/**
 * The sheet order is load-bearing. If someone lines the frames up as
 * left/down/up/right because that is how the lanes are drawn, every
 * arrow will pose the wrong limb.
 */
import { describe, expect, it } from 'vitest';
import { DANCE_SHEET_ORDER, danceFrameIndex } from '../src/play/dancer.ts';

describe('the dance sheet', () => {
  it('is idle, then up, down, left, right', () => {
    expect(DANCE_SHEET_ORDER).toEqual(['idle', 'up', 'down', 'left', 'right']);
  });

  it('maps each lane onto that order', () => {
    expect(danceFrameIndex('idle')).toBe(0);
    expect(danceFrameIndex('up')).toBe(1);
    expect(danceFrameIndex('down')).toBe(2);
    expect(danceFrameIndex('left')).toBe(3);
    expect(danceFrameIndex('right')).toBe(4);
  });
});
