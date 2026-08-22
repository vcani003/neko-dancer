import { describe, expect, it } from 'vitest';
import { GameEngine } from '../src/engine/GameEngine.ts';
import { GameClock } from '../src/engine/GameClock.ts';
import { COMPLETION_BONUS, MAX_HEALTH } from '../src/engine/ScoreSystem.ts';
import { arrow, chartWith, FakeAdapter } from './helpers.ts';
import type { Lane } from '../src/charts/schema.ts';

function setup(arrows: ReturnType<typeof arrow>[]) {
  const adapter = new FakeAdapter();
  let wall = 10_000;
  const clock = new GameClock(adapter, { now: () => wall, slewRate: 0 });
  const engine = new GameEngine(clock, chartWith(arrows));
  clock.tick();
  return {
    adapter,
    clock,
    engine,
    wallNow: () => wall,
    advance: (ms: number) => {
      wall += ms;
      adapter.timeMs += ms;
      clock.tick();
    },
  };
}

describe('GameEngine — judging a keypress', () => {
  it('scores a press dead on time as PERFECT', () => {
    const { engine, advance, wallNow } = setup([arrow('a', 1000)]);
    advance(1000);
    const event = engine.pressLane('left', wallNow());
    expect(event).toMatchObject({ arrowId: 'a', judgment: 'PERFECT' });
    expect(engine.getScore().combo).toBe(1);
  });

  it('grades a late press down the tiers', () => {
    const { engine, advance, wallNow } = setup([arrow('a', 1000)]);
    advance(1090);
    expect(engine.pressLane('left', wallNow())?.judgment).toBe('OKAY');
  });

  it('reports early presses as negative delta', () => {
    const { engine, advance, wallNow } = setup([arrow('a', 1000)]);
    advance(970);
    const event = engine.pressLane('left', wallNow());
    expect(event?.deltaMs).toBeCloseTo(-30);
    expect(event?.judgment).toBe('PERFECT');
  });

  /**
   * The reason KeyboardEvent.timeStamp is used rather than the frame time: a
   * keypress is precise, and rounding it up to the next render would throw
   * away most of what makes a keyboard better than a camera here.
   */
  it('judges the press at the instant it happened, not when it was handled', () => {
    const { engine, advance, wallNow } = setup([arrow('a', 1000)]);
    advance(1000);
    const pressedAt = wallNow();

    advance(60); // a frame or two of handling delay
    const event = engine.pressLane('left', pressedAt);
    expect(event?.deltaMs).toBeCloseTo(0);
    expect(event?.judgment).toBe('PERFECT');
  });

  it('lets an arrow be claimed only once', () => {
    const { engine, advance, wallNow } = setup([arrow('a', 1000)]);
    advance(1000);
    expect(engine.pressLane('left', wallNow())?.judgment).toBe('PERFECT');
    expect(engine.pressLane('left', wallNow())?.wrongKey).toBe(true);
  });

  it('keeps lanes independent', () => {
    const { engine, advance, wallNow } = setup([arrow('a', 1000, 'left'), arrow('b', 1000, 'right')]);
    advance(1000);
    expect(engine.pressLane('right', wallNow())?.arrowId).toBe('b');
    expect(engine.pressLane('left', wallNow())?.arrowId).toBe('a');
  });
});

describe('GameEngine — wrong keys', () => {
  it('costs health and breaks the combo', () => {
    const { engine, advance, wallNow } = setup([arrow('a', 1000), arrow('b', 5000)]);
    advance(1000);
    engine.pressLane('left', wallNow());
    expect(engine.getScore().combo).toBe(1);

    advance(1500);
    const event = engine.pressLane('up', wallNow());
    expect(event?.wrongKey).toBe(true);
    expect(engine.getScore().combo).toBe(0);
    expect(engine.getScore().health).toBeLessThan(MAX_HEALTH);
  });
});

describe('GameEngine — misses', () => {
  it('misses an arrow once its window has fully closed', () => {
    const { engine, advance } = setup([arrow('a', 1000)]);
    advance(1160);
    expect(engine.update()).toEqual([]);
    advance(2);
    expect(engine.update().map((e) => e.judgment)).toEqual(['MISS']);
  });

  it('ends the run when health reaches zero', () => {
    const { engine, advance } = setup(
      Array.from({ length: 30 }, (_, i) => arrow(`a${i}`, 1000 + i * 300)),
    );
    for (let i = 0; i < 40; i++) {
      advance(300);
      engine.update();
    }
    expect(engine.getScore().failed).toBe(true);
  });

  it('accepts no input once failed', () => {
    const { engine, advance, wallNow } = setup(
      Array.from({ length: 30 }, (_, i) => arrow(`a${i}`, 500 + i * 200)),
    );
    for (let i = 0; i < 40; i++) {
      advance(200);
      engine.update();
    }
    expect(engine.pressLane('left', wallNow())).toBeNull();
  });
});

describe('GameEngine — stopped playback', () => {
  /** Judgment must not advance against a stopped player. */
  it('emits no misses while paused, however long', () => {
    const { engine, adapter, clock, advance } = setup([arrow('a', 1000)]);
    advance(500);
    adapter.state = 'paused';
    clock.tick();
    for (let i = 0; i < 50; i++) expect(engine.update()).toEqual([]);
  });

  it('accepts no keypress while paused', () => {
    const { engine, adapter, clock, advance, wallNow } = setup([arrow('a', 1000)]);
    advance(1000);
    adapter.state = 'paused';
    clock.tick();
    expect(engine.pressLane('left', wallNow())).toBeNull();
  });
});

describe('GameEngine — completion', () => {
  it('pays the completion bonus once, when the last arrow settles', () => {
    const { engine, advance, wallNow } = setup([arrow('a', 1000)]);
    advance(1000);
    engine.pressLane('left', wallNow());
    const beforeBonus = engine.getScore().score;

    advance(500);
    engine.update();
    expect(engine.getScore().score).toBe(beforeBonus + COMPLETION_BONUS);

    advance(500);
    engine.update();
    expect(engine.getScore().score).toBe(beforeBonus + COMPLETION_BONUS);
  });

  it('pays no bonus to a failed run', () => {
    const { engine, advance } = setup(
      Array.from({ length: 30 }, (_, i) => arrow(`a${i}`, 200 + i * 200)),
    );
    for (let i = 0; i < 40; i++) {
      advance(200);
      engine.update();
    }
    expect(engine.getScore().failed).toBe(true);
    expect(engine.getScore().score).toBe(0);
  });

  /**
   * Failing stops judgment, so the chart never finishes. A screen watching
   * isComplete would wait forever for a completion that cannot arrive — which
   * is why isOver exists and is the signal to watch.
   */
  it('is over when failed, even though the chart never completed', () => {
    const { engine, advance } = setup(
      Array.from({ length: 30 }, (_, i) => arrow(`a${i}`, 200 + i * 200)),
    );
    for (let i = 0; i < 40; i++) {
      advance(200);
      engine.update();
    }
    expect(engine.isComplete()).toBe(false);
    expect(engine.isOver()).toBe(true);
  });

  it('is over when the chart completes without failing', () => {
    const { engine, advance, wallNow } = setup([arrow('a', 1000)]);
    advance(1000);
    engine.pressLane('left', wallNow());
    advance(500);
    engine.update();
    expect(engine.getScore().failed).toBe(false);
    expect(engine.isOver()).toBe(true);
  });

  it('drops settled arrows from the pending list', () => {
    const { engine, advance, wallNow } = setup([arrow('a', 1000), arrow('b', 9000)]);
    expect(engine.pendingArrows()).toHaveLength(2);
    advance(1000);
    engine.pressLane('left', wallNow());
    expect(engine.pendingArrows().map((a) => a.arrow.id)).toEqual(['b']);
  });

  it('restores a fresh chart on reset', () => {
    const { engine, advance, wallNow } = setup([arrow('a', 1000)]);
    advance(1000);
    engine.pressLane('left', wallNow());
    engine.reset();
    expect(engine.getScore().score).toBe(0);
    expect(engine.getScore().health).toBe(MAX_HEALTH);
    expect(engine.isComplete()).toBe(false);
  });
});

describe('GameEngine — every lane works', () => {
  it('accepts all four', () => {
    const lanes: Lane[] = ['left', 'down', 'up', 'right'];
    const { engine, advance, wallNow } = setup(lanes.map((l) => arrow(l, 1000, l)));
    advance(1000);
    for (const lane of lanes) {
      expect(engine.pressLane(lane, wallNow())?.judgment, lane).toBe('PERFECT');
    }
  });
});
