/**
 * What a press was worth, and how close it has to be.
 *
 * The *names* live here because they travel — a live scoreboard carries them
 * between clients, so both sides must agree on the spelling. The *logic* that
 * assigns them belongs to `packages/game-core`, which is the only thing allowed
 * to decide what a press means.
 */

/**
 * Five grades, best to worst. Decided in BL-4.
 *
 * The system design's example listed four (`perfect/good/okay/miss`); five is
 * the decision. The extra tier is what lets a hit be *late but not lost* — the
 * band between "still counts" and "gone" is where most of a rhythm game's feel
 * lives.
 */
export const JUDGMENTS = ['PERFECT', 'GREAT', 'GOOD', 'OKAY', 'MISS'] as const;
export type Judgment = (typeof JUDGMENTS)[number];

/**
 * The outer edge of each grade, in milliseconds either side of the note.
 *
 * `MISS` has no window: it is what a press outside `okayMs` is, and what an
 * unpressed note becomes once it has gone by.
 */
export interface JudgmentWindows {
  perfectMs: number;
  greatMs: number;
  goodMs: number;
  okayMs: number;
}

/**
 * Provisional, and known to be. System design §12, BL-4.
 *
 *     |error| ≤  35  →  PERFECT
 *              ≤  70  →  GREAT
 *              ≤ 110  →  GOOD
 *              ≤ 160  →  OKAY
 *               > 160  →  MISS
 *
 * The spec's example was 45/90/140/180; these are the values the game plays at
 * and they stay until playtesting gives a reason to move them. Recorded as a
 * decision rather than left as an accident, because a number nobody chose is a
 * number nobody will dare change.
 *
 * Configurable on purpose: these are the most tuning-sensitive numbers in the
 * project and the ones most likely to be wrong.
 */
export const DEFAULT_WINDOWS: JudgmentWindows = {
  perfectMs: 35,
  greatMs: 70,
  goodMs: 110,
  okayMs: 160,
};

/**
 * A player's progress, as broadcast during a round.
 *
 * Self-reported. The server stores what the client claims and does not verify
 * it — accepted for MVP (system design §25), and stated here so that nobody
 * downstream mistakes one of these numbers for a verified one. A competitive
 * leaderboard needs server-side judging first.
 */
export interface PlayerProgress {
  readonly score: number;
  readonly combo: number;
  readonly accuracy: number;
  readonly health: number;
}

/** The end of a run, as reported by the player who ran it. Also a claim. */
export interface RoundResult extends PlayerProgress {
  readonly maxCombo: number;
  readonly counts: Readonly<Record<Judgment, number>>;
  /** False when health ran out before the last note. */
  readonly completed: boolean;
}
