/**
 * A clock-style start time (`0:06`, `1:12`) into media milliseconds.
 *
 * This is a chart offset, not player calibration. Bare numbers are seconds
 * so a typed `6` means the same as `0:06`.
 */
export function parseClock(input: string): number | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const clock = /^(\d{1,3}):(\d{1,2})(?:\.(\d{1,3}))?$/.exec(trimmed);
  if (clock) {
    const minutes = Number(clock[1]);
    const seconds = Number(clock[2]);
    if (seconds > 59) return null;
    const frac = clock[3] ? Number(clock[3].padEnd(3, '0')) : 0;
    const ms = minutes * 60_000 + seconds * 1000 + frac;
    return Number.isFinite(ms) && ms >= 0 ? ms : null;
  }

  const bare = /^(\d+)(?:\.(\d{1,3}))?$/.exec(trimmed);
  if (bare) {
    const seconds = Number(bare[1]);
    const frac = bare[2] ? Number(bare[2].padEnd(3, '0')) : 0;
    const ms = seconds * 1000 + frac;
    return Number.isFinite(ms) && ms >= 0 ? ms : null;
  }

  return null;
}
