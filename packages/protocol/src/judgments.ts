/**
 * What a press was worth, and how close it has to be.
 *
 * The *names* live here because they travel — a live scoreboard carries them
 * between clients, so both sides must agree on the spelling. The *logic* that
 * assigns them belongs to `packages/game-core`, which is the only thing allowed
 * to decide what a press means.
 */

export const JUDGMENTS = ['PERFECT', 'NICE', 'OKAY', 'OOPS', 'MISS'] as const;
export type Judgment = (typeof JUDGMENTS)[number];

export interface JudgmentWindows {
  perfectMs: number;
  niceMs: number;
  okayMs: number;
  oopsMs: number;
}

/**
 * Provisional, and known to be. System design §12.
 *
 * The spec's example was 45/90/140/180; these are the values the game currently
 * plays at and they are kept until playtesting gives a reason to move them.
 * Recorded as a decision rather than left as an accident, because a number that
 * nobody chose is a number nobody will dare change.
 */
export const DEFAULT_WINDOWS: JudgmentWindows = {
  perfectMs: 35,
  niceMs: 70,
  okayMs: 110,
  oopsMs: 160,
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
  score: number;
  combo: number;
  accuracy: number;
  health: number;
}

/** The end of a run, as reported by the player who ran it. Also a claim. */
export interface RoundResult extends PlayerProgress {
  maxCombo: number;
  counts: Readonly<Record<Judgment, number>>;
  /** False when health ran out before the last note. */
  completed: boolean;
}
