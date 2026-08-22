import { describe, expect, it } from 'vitest';
import { isTypingTarget, laneForKey } from '../src/input/KeyboardInput.ts';

/** A stand-in for a DOM element, since these tests run without a browser. */
class FakeElement {
  tagName: string;
  isContentEditable: boolean;
  constructor(tagName: string, isContentEditable = false) {
    this.tagName = tagName;
    this.isContentEditable = isContentEditable;
  }
}
// isTypingTarget checks `instanceof HTMLElement`, so give it one to check against.
(globalThis as { HTMLElement?: unknown }).HTMLElement = FakeElement;

describe('laneForKey', () => {
  it('maps the arrow keys', () => {
    expect(laneForKey('ArrowLeft')).toBe('left');
    expect(laneForKey('ArrowDown')).toBe('down');
    expect(laneForKey('ArrowUp')).toBe('up');
    expect(laneForKey('ArrowRight')).toBe('right');
  });

  it('maps WASD in either case', () => {
    expect(laneForKey('a')).toBe('left');
    expect(laneForKey('A')).toBe('left');
    expect(laneForKey('W')).toBe('up');
    expect(laneForKey('d')).toBe('right');
  });

  it('ignores everything else', () => {
    for (const key of ['q', 'Enter', ' ', 'Shift', '1']) {
      expect(laneForKey(key), key).toBeNull();
    }
  });
});

describe('isTypingTarget — the bug a playtester found', () => {
  /**
   * Lane keys are WASD and the arrows, which are also most of what a person
   * uses inside a text field: the letters themselves, and the arrows to move
   * the cursor. Swallowing them globally made the name and chat boxes
   * unusable — and worse, typing "d" in chat fired a right-lane hit mid-song.
   */
  it('recognises the fields a player types into', () => {
    expect(isTypingTarget(new FakeElement('INPUT') as unknown as EventTarget)).toBe(true);
    expect(isTypingTarget(new FakeElement('TEXTAREA') as unknown as EventTarget)).toBe(true);
    expect(isTypingTarget(new FakeElement('SELECT') as unknown as EventTarget)).toBe(true);
  });

  it('recognises a contenteditable element whatever its tag', () => {
    expect(isTypingTarget(new FakeElement('DIV', true) as unknown as EventTarget)).toBe(true);
  });

  it('does not mistake the playfield for a text box', () => {
    expect(isTypingTarget(new FakeElement('DIV') as unknown as EventTarget)).toBe(false);
    expect(isTypingTarget(new FakeElement('CANVAS') as unknown as EventTarget)).toBe(false);
    expect(isTypingTarget(new FakeElement('BODY') as unknown as EventTarget)).toBe(false);
  });

  it('handles a missing target rather than throwing', () => {
    expect(isTypingTarget(null)).toBe(false);
  });
});
