/**
 * `GameEngine` — every invariant in API.md §3, as a test.
 *
 * These are the rules that decide whether a round is fair. Each one is stated
 * in API.md as a sentence; a sentence in a document does not survive a
 * refactor, and none of these would be noticed by playing — a note judged twice
 * or a press credited to the wrong note looks exactly like being bad at the
 * game.
 */
import { describe, expect, it } from 'vitest';
import { GameEngine } from '@neko/game-core';
import { DEFAULT_WINDOWS } from '@neko/protocol';
import { chartOf, singleTapChart, tap } from './helpers.ts';

const engineOf = (chart = singleTapChart(), calibrationMs?: number) =>
  new GameEngine({ revision: chart, ...(calibrationMs === undefined ? {} : { calibrationMs }) });

describe('a press is judged at the moment the key went down', () => {
  /**
   * "A press carries the moment the key went down; a frame of handling delay
   * must not become 16 ms of error." The engine is given the press time
   * explicitly for exactly this reason — an engine that judged against the last
   * `update()` would charge every player a frame of latency they did not spend.
   */
  it('judges against the press time, not the last update time', () => {
    const engine = engineOf();
    // The frame arrives late: the engine is updated to 10,040 but the key went
    // down at 10,000. That is a PERFECT, not a GREAT.
    engine.update(10_040);
    expect(engine.press('up', 10_000)?.judgment).toBe('PERFECT');
  });

  it('reports a delta measured from the press time', () => {
    const engine = engineOf();
    engine.update(10_100);
    expect(engine.press('up', 10_020)?.deltaMs).toBeCloseTo(20, 5);
  });

  it('judges a press that arrives before the engine has been updated at all', () => {
    const engine = engineOf();
    expect(engine.press('up', 10_000)?.judgment).toBe('PERFECT');
  });
});

describe('deltaMs is signed: negative early, positive late', () => {
  it.each([
    ['early', 9_950, -50],
    ['late', 10_050, 50],
    ['exact', 10_000, 0],
  ])('a press %s of the note reports %i ms', (_label, pressAt, expected) => {
    const engine = engineOf();
    expect(engine.press('up', pressAt)?.deltaMs).toBeCloseTo(expected, 5);
  });

  it('grades an early and a late press of the same distance identically', () => {
    expect(engineOf().press('up', 9_950)?.judgment).toBe(engineOf().press('up', 10_050)?.judgment);
  });
});

describe('one press claims at most one note', () => {
  it('claims the nearest unjudged note in the lane', () => {
    /**
     * Nearest rather than earliest. With two notes close together, crediting
     * the earlier one consumes the note the player was not aiming at and leaves
     * the intended one to expire — the player is punished twice for one
     * accurate press.
     */
    const engine = engineOf(chartOf([tap('early', 10_000), tap('late', 10_120)]));
    expect(engine.press('up', 10_110)?.noteId).toBe('late');
  });

  it('does not consume a second note with one press', () => {
    const engine = engineOf(chartOf([tap('a', 10_000), tap('b', 10_040)]));
    const first = engine.press('up', 10_000);
    const second = engine.press('up', 10_040);
    expect(first?.noteId).not.toBe(second?.noteId);
    expect([first?.noteId, second?.noteId].sort()).toEqual(['a', 'b']);
  });

  it('only claims a note in the lane that was pressed', () => {
    const engine = engineOf(chartOf([tap('up1', 10_000, 'up'), tap('left1', 10_000, 'left')]));
    expect(engine.press('left', 10_000)?.noteId).toBe('left1');
  });

  it('does not let a press in one lane judge a note in another', () => {
    const engine = engineOf(chartOf([tap('up1', 10_000, 'up')]));
    expect(engine.press('down', 10_000)).toBeNull();
  });
});

describe('a press with nothing in range costs nothing', () => {
  /**
   * "Returns null and is not a miss — mashing an empty lane costs nothing but
   * wastes the press." A press that registered a MISS would let a player
   * destroy their own score by drumming during a rest, which is not a mistake
   * the chart asked them to avoid.
   */
  it('returns null when the nearest note is beyond okayMs', () => {
    const engine = engineOf();
    expect(engine.press('up', 10_000 + DEFAULT_WINDOWS.okayMs + 1)).toBeNull();
  });

  it('returns null when there are no notes at all', () => {
    expect(engineOf(chartOf([])).press('up', 10_000)).toBeNull();
  });

  it('does not record a judgment for a press that claimed nothing', () => {
    const engine = engineOf();
    engine.press('up', 5_000);
    engine.press('up', 5_000);
    engine.press('up', 5_000);
    const counts = engine.result().counts;
    expect(counts.MISS).toBe(0);
  });

  /**
   * "Costs nothing" is the whole sentence, and the tally is only half of it.
   * The engine this replaces docked health for a wrong key, so a player
   * drumming through a rest could fail a run they were playing perfectly —
   * which is a rule the chart never told them about.
   */
  it('takes no health and no score from a press that claimed nothing', () => {
    const engine = engineOf();
    const before = engine.result();
    for (let i = 0; i < 40; i++) engine.press('down', 5_000 + i);
    const after = engine.result();
    expect(after.health).toBe(before.health);
    expect(after.score).toBe(before.score);
  });

  it('cannot be failed by mashing an empty lane', () => {
    const engine = engineOf();
    for (let i = 0; i < 500; i++) engine.press('left', 5_000 + i);
    expect(engine.isOver()).toBe(false);
  });

  it('leaves the note claimable after a wasted press nearby', () => {
    const engine = engineOf();
    engine.press('up', 9_000);
    expect(engine.press('up', 10_000)?.judgment).toBe('PERFECT');
  });

  it('claims a note exactly at the edge of okayMs', () => {
    const engine = engineOf();
    expect(engine.press('up', 10_000 + DEFAULT_WINDOWS.okayMs)?.judgment).toBe('OKAY');
  });
});

describe('a note is judged once, never re-judged and never un-judged', () => {
  it('does not award a second judgment for the same note', () => {
    const engine = engineOf();
    expect(engine.press('up', 10_000)).not.toBeNull();
    expect(engine.press('up', 10_010)).toBeNull();
  });

  /**
   * Two notes in one lane, and the player hits the LATER one first.
   *
   * The single-note version of this test passes even with the "already judged"
   * check removed, because the engine's forward cursor has already stepped past
   * the note — so it proves the cursor works, not the rule. Here the cursor
   * cannot help: the earlier note is still unjudged, so it must stay where it
   * is, and the note just claimed must not be claimable a second time.
   */
  it('does not re-claim a judged note while an earlier one is still open', () => {
    const engine = engineOf(chartOf([tap('a', 10_000), tap('b', 10_100)]));
    expect(engine.press('up', 10_100)?.noteId).toBe('b');
    // Nearest is 'b' again at distance 0, but 'b' is spent — this must fall to 'a'.
    expect(engine.press('up', 10_100)?.noteId).toBe('a');
    expect(engine.press('up', 10_100)).toBeNull();
  });

  it('judges each of two notes exactly once, whichever order they are hit in', () => {
    const engine = engineOf(chartOf([tap('a', 10_000), tap('b', 10_100)]));
    engine.press('up', 10_100);
    engine.press('up', 10_100);
    engine.update(20_000);
    const counts = engine.result().counts;
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(2);
  });

  it('does not expire a note that was already hit', () => {
    const engine = engineOf();
    engine.press('up', 10_000);
    const expired = engine.update(20_000);
    expect(expired.map((e) => (e as { id?: string; noteId?: string }).id
      ?? (e as { noteId?: string }).noteId)).not.toContain('n1');
  });

  it('counts a hit note exactly once in the result', () => {
    const engine = engineOf();
    engine.press('up', 10_000);
    engine.update(20_000);
    const counts = engine.result().counts;
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    expect(total).toBe(1);
  });

  it('expires an unhit note exactly once however many times update is called', () => {
    const engine = engineOf();
    engine.update(20_000);
    expect(engine.update(20_001)).toHaveLength(0);
    expect(engine.update(30_000)).toHaveLength(0);
    expect(engine.result().counts.MISS).toBe(1);
  });
});

describe('update is idempotent and tolerates a clock that has not moved', () => {
  /**
   * "A stalled clock calls this repeatedly with the same number." An engine
   * that expired notes per call rather than per note would empty a whole chart
   * during a buffering pause.
   */
  it('reports an expiry once, not on every call at the same time', () => {
    const engine = engineOf();
    const first = engine.update(20_000);
    const second = engine.update(20_000);
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(0);
  });

  it('survives a hundred calls at an unchanging time', () => {
    const engine = engineOf();
    for (let i = 0; i < 100; i++) engine.update(20_000);
    expect(engine.result().counts.MISS).toBe(1);
  });

  it('tolerates time going backwards without re-judging anything', () => {
    // A backwards seek is the UI's business, but the engine must not corrupt
    // its own tally if it sees one.
    const engine = engineOf();
    engine.update(20_000);
    expect(() => engine.update(5_000)).not.toThrow();
    expect(engine.result().counts.MISS).toBe(1);
  });

  it('does not expire a note whose window is still open', () => {
    const engine = engineOf();
    expect(engine.update(10_000 + DEFAULT_WINDOWS.okayMs)).toHaveLength(0);
    expect(engine.press('up', 10_000 + DEFAULT_WINDOWS.okayMs)).not.toBeNull();
  });
});

describe('calibration moves the press, never the chart — §13, ADR-003', () => {
  /**
   * "ADDED TO THE PLAYER'S PRESS TIME. A player who consistently hits 50 ms
   * early sets +50, which moves their presses later and lands them on the
   * note." The sign is the whole content of this rule and it is exactly the
   * kind of thing implemented backwards.
   */
  it('lands a habitually early player on the note', () => {
    const engine = engineOf(singleTapChart(), 50);
    expect(engine.press('up', 9_950)?.judgment).toBe('PERFECT');
    expect(engine.press('up', 9_950)).toBeNull(); // already claimed
  });

  it('reports a delta of zero for a corrected press', () => {
    const engine = engineOf(singleTapChart(), 50);
    expect(engine.press('up', 9_950)?.deltaMs).toBeCloseTo(0, 5);
  });

  it('lands a habitually late player on the note with a negative calibration', () => {
    const engine = engineOf(singleTapChart(), -50);
    expect(engine.press('up', 10_050)?.judgment).toBe('PERFECT');
  });

  it('shifts an on-time press off the note by the calibration', () => {
    // The other direction of the same arithmetic: calibration is not free.
    const engine = engineOf(singleTapChart(), 50);
    expect(engine.press('up', 10_000)?.deltaMs).toBeCloseTo(50, 5);
  });

  it('defaults to no adjustment', () => {
    expect(engineOf().press('up', 10_000)?.deltaMs).toBeCloseTo(0, 5);
  });

  it('never alters the chart it was given', () => {
    const chart = singleTapChart();
    const before = JSON.stringify(chart);
    const engine = engineOf(chart, 50);
    engine.press('up', 9_950);
    engine.update(20_000);
    expect(JSON.stringify(chart)).toBe(before);
  });

  it('uses calibration when deciding what is in range at all', () => {
    // A note is unreachable without calibration and reachable with it.
    const engine = engineOf(singleTapChart(), 200);
    expect(engine.press('up', 9_820)?.judgment).toBe('PERFECT');
  });

  /**
   * The claim window and the expiry boundary must agree.
   *
   * API.md fixes the claim window (`within okayMs`, after calibration) and says
   * `update` returns "notes that have just expired unhit" — but never says
   * whether calibration moves expiry too. It has to, and this is why: if only
   * the press is shifted, the two boundaries part company by exactly the
   * calibration. A player on +50 gets a note that has become unclaimable but is
   * not yet expired — a dead zone where the key does nothing; a player on -50
   * gets a note marked missed while their press could still legitimately land.
   *
   * Neither is visible in a normal run, and neither is anyone's fault at the
   * moment it happens. Asserted as the derivable consistency property rather
   * than as a rule about `update`, so it holds however Architecture resolves
   * the wording.
   */
  const OKAY = DEFAULT_WINDOWS.okayMs;

  it.each([0, 50, -50, 120, -120])(
    'has one boundary, not two, at a calibration of %i ms',
    (calibrationMs) => {
      // The last raw media time at which a press can still reach the note.
      const lastClaimableRawMs = 10_000 + OKAY - calibrationMs;

      const stillOpen = engineOf(singleTapChart(), calibrationMs);
      expect(stillOpen.update(lastClaimableRawMs)).toHaveLength(0);
      expect(stillOpen.press('up', lastClaimableRawMs)).not.toBeNull();

      const justClosed = engineOf(singleTapChart(), calibrationMs);
      expect(justClosed.update(lastClaimableRawMs + 1)).toHaveLength(1);
      expect(justClosed.press('up', lastClaimableRawMs + 1)).toBeNull();
    },
  );
});

describe('a failed run stops judging and never reports completion', () => {
  /**
   * Health reaching zero ends the run. `RoundResult.completed` means the player
   * reached the end alive, and §25 stores what the client claims — so a failed
   * run reporting `completed: true` would be an unearned claim written straight
   * into a scoreboard.
   */
  const missEverything = () => {
    // Enough notes that missing all of them exhausts any plausible health pool.
    const notes = Array.from({ length: 120 }, (_, i) => tap(`n${i}`, 1_000 + i * 100));
    const engine = new GameEngine({ revision: chartOf(notes) });
    engine.update(1_000 + 120 * 100 + 1_000);
    return engine;
  };

  it('is over once health has run out', () => {
    expect(missEverything().isOver()).toBe(true);
  });

  it('never reports completed after a failure', () => {
    expect(missEverything().result().completed).toBe(false);
  });

  it('reports a run that reached the end alive as completed', () => {
    const notes = Array.from({ length: 20 }, (_, i) => tap(`n${i}`, 1_000 + i * 500));
    const engine = new GameEngine({ revision: chartOf(notes) });
    for (const note of notes) engine.press('up', note.timeMs);
    engine.update(1_000 + 20 * 500 + 1_000);
    expect(engine.result().completed).toBe(true);
  });

  it('does not accept a press after the run has failed', () => {
    const engine = missEverything();
    const before = engine.result().score;
    engine.press('up', 1_000);
    expect(engine.result().score).toBe(before);
  });
});

describe('the result is a RoundResult the protocol will accept', () => {
  // It travels over the socket as `finish { result }`, so it has to satisfy the
  // validator that guards that message. A result the server refuses ends a
  // round with no score for that player.
  it('reports every grade in its counts', () => {
    const engine = engineOf();
    engine.press('up', 10_000);
    engine.update(20_000);
    const counts = engine.result().counts;
    expect(Object.keys(counts).sort()).toEqual(['GOOD', 'GREAT', 'MISS', 'OKAY', 'PERFECT']);
  });

  it('reports an accuracy between zero and one', () => {
    const engine = engineOf();
    engine.press('up', 10_000);
    engine.update(20_000);
    const { accuracy } = engine.result();
    expect(accuracy).toBeGreaterThanOrEqual(0);
    expect(accuracy).toBeLessThanOrEqual(1);
  });

  it('reports a maxCombo no smaller than the final combo', () => {
    const notes = Array.from({ length: 5 }, (_, i) => tap(`n${i}`, 1_000 + i * 500));
    const engine = new GameEngine({ revision: chartOf(notes) });
    for (const note of notes) engine.press('up', note.timeMs);
    engine.update(10_000);
    const result = engine.result();
    expect(result.maxCombo).toBeGreaterThanOrEqual(result.combo);
  });

  it('reports a non-negative score and health within bounds', () => {
    const engine = engineOf();
    engine.update(20_000);
    const { score, health } = engine.result();
    expect(score).toBeGreaterThanOrEqual(0);
    expect(health).toBeGreaterThanOrEqual(0);
    expect(health).toBeLessThanOrEqual(100);
  });
});

describe('visible returns what is worth drawing, nearest first', () => {
  const chart = chartOf([tap('a', 10_000), tap('b', 10_500), tap('c', 11_000)]);

  it('includes notes inside the lead window', () => {
    const visible = new GameEngine({ revision: chart }).visible(9_800, 1_000);
    expect(visible.length).toBeGreaterThanOrEqual(2);
  });

  it('excludes notes beyond the lead window', () => {
    const visible = new GameEngine({ revision: chart }).visible(9_000, 500);
    expect(visible).toHaveLength(0);
  });

  it('orders them nearest first', () => {
    const visible = new GameEngine({ revision: chart }).visible(9_800, 2_000) as ReadonlyArray<
      { timeMs: number }
    >;
    const times = visible.map((n) => n.timeMs);
    expect([...times].sort((x, y) => x - y)).toEqual(times);
  });

  it('does not mutate anything, so it is safe to call every frame', () => {
    const engine = new GameEngine({ revision: chart });
    engine.visible(9_800, 2_000);
    engine.visible(9_800, 2_000);
    expect(engine.press('up', 10_000)?.judgment).toBe('PERFECT');
  });
});
