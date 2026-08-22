/**
 * Keyboard to lanes.
 *
 * Arrow keys and WASD, as the original has. The timestamp on a KeyboardEvent
 * is what makes this worth doing carefully: it records when the key was
 * actually pressed, not when JavaScript got round to handling it, so judgment
 * can use the real instant rather than the next frame.
 */
import type { Lane } from '../charts/schema.ts';

const KEY_TO_LANE: Record<string, Lane> = {
  ArrowLeft: 'left',
  ArrowDown: 'down',
  ArrowUp: 'up',
  ArrowRight: 'right',
  a: 'left',
  s: 'down',
  w: 'up',
  d: 'right',
  A: 'left',
  S: 'down',
  W: 'up',
  D: 'right',
};

export function laneForKey(key: string): Lane | null {
  return KEY_TO_LANE[key] ?? null;
}

export interface LanePress {
  lane: Lane;
  /** When the key went down, in performance.now() terms. */
  atMs: number;
}

export interface KeyboardInputOptions {
  onPress: (press: LanePress) => void;
  onRelease?: (lane: Lane) => void;
}

/**
 * Is the player typing rather than playing?
 *
 * Lane keys are WASD and the arrows, which are also most of what a person uses
 * inside a text field — the letters themselves, and the arrows for moving the
 * cursor. Swallowing them globally made the name and chat boxes unusable, and
 * worse, typing "d" in chat fired a right-lane hit mid-song.
 *
 * Editable targets therefore get their keystrokes untouched: no preventDefault,
 * no lane press, no held-lane bookkeeping.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);
}

/**
 * Listens for lane keys and reports presses.
 *
 * Auto-repeat is suppressed: holding a key down must not machine-gun a lane.
 * The original has no hold notes today, so a held key is one press.
 */
export class KeyboardInput {
  private options: KeyboardInputOptions;
  private held = new Set<Lane>();
  private attached = false;

  private onKeyDown = (event: KeyboardEvent) => {
    // Checked before the lane lookup, so a typed key is never even considered
    // gameplay input.
    if (isTypingTarget(event.target)) return;

    const lane = laneForKey(event.key);
    if (lane === null) return;
    // Only now is it safe to swallow: arrows scroll the page and space would
    // activate a focused button, neither of which should happen mid-song.
    event.preventDefault();
    if (event.repeat || this.held.has(lane)) return;

    this.held.add(lane);
    this.options.onPress({
      lane,
      // KeyboardEvent.timeStamp shares performance.now()'s timebase and records
      // when the key went down, which can be a frame earlier than now.
      atMs: event.timeStamp || performance.now(),
    });
  };

  private onKeyUp = (event: KeyboardEvent) => {
    const lane = laneForKey(event.key);
    if (lane === null) return;
    // Released unconditionally, even from a text field. Focus can move between
    // keydown and keyup — click into chat mid-press and the keyup lands there
    // — and a lane left stuck "held" would light its receptor forever.
    this.held.delete(lane);
    this.options.onRelease?.(lane);
  };

  /** Lanes currently held down, for drawing the receptors lit. */
  heldLanes(): ReadonlySet<Lane> {
    return this.held;
  }

  constructor(options: KeyboardInputOptions) {
    this.options = options;
  }

  attach(target: Window = window): void {
    if (this.attached) return;
    target.addEventListener('keydown', this.onKeyDown);
    target.addEventListener('keyup', this.onKeyUp);
    this.attached = true;
  }

  detach(target: Window = window): void {
    if (!this.attached) return;
    target.removeEventListener('keydown', this.onKeyDown);
    target.removeEventListener('keyup', this.onKeyUp);
    this.held.clear();
    this.attached = false;
  }
}
