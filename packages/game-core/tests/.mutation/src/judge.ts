/**
 * Timing judgment: one press against one window set.
 *
 * Five tiers rather than hop//beat's three, matching the original. ADR-005
 * settles both the names and the numbers — `PERFECT | GREAT | GOOD | OKAY |
 * MISS` at 35/70/110/160. The extra grain is worth having here in a way it was
 * not there: a keypress lands where the player meant it to, so the difference
 * between 30 ms and 70 ms is a real thing they did, not noise from a camera.
 *
 * The windows themselves are far tighter than hop//beat's ±80/±160, and they
 * can be — a keydown carries no inference latency, so none of the window is
 * spent before the input is seen. That measured ~28 ms of camera pipeline is
 * simply not here to pay for.
 *
 * Pure and clock-free: it is told how far a press was from a note, and answers
 * what that was worth.
 */
import type { Judgment, JudgmentWindows } from '@neko/protocol';

/**
 * `absDeltaMs` is |press − note|. Returns `MISS` beyond `okayMs`.
 *
 * Every boundary is INCLUSIVE of the tier it names: 35 is `PERFECT` and 36 is
 * `GREAT`. ADR-005 pins all four on both sides, so a window cannot be nudged by
 * accident without a test going red.
 *
 * The magnitude is taken rather than trusted. The parameter is named for a
 * distance, so a signed value is a caller's mistake — but every one of these
 * comparisons is a `<=` against a positive number, so a negative would slide
 * straight past `perfectMs` and award `PERFECT` to a press that was a second
 * out. A caller bug should cost the caller a wrong grade, not the player.
 */
export function judge(absDeltaMs: number, windows: JudgmentWindows): Judgment {
  const distance = Math.abs(absDeltaMs);
  if (distance <= windows.perfectMs) return 'PERFECT';
  if (distance <= windows.greatMs) return 'GREAT';
  if (distance <= windows.goodMs) return 'GOOD';
  if (distance <= windows.okayMs) return 'OKAY';
  return 'MISS';
}
