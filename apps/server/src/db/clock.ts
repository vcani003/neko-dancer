/**
 * Time, injected. Tests freeze it; production uses the system clock.
 *
 * A repository that calls `new Date()` itself cannot be replayed, and a
 * round-trip test that asserts `createdAtIso` then flakes on the next
 * millisecond. The store takes a clock so those tests say what time it is.
 */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};

export function frozenClock(iso: string): Clock {
  const date = new Date(iso);
  return { now: () => date };
}
