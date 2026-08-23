/**
 * The agreed surface exists and is shaped as API.md says.
 *
 * Written to fail *legibly* while Phase 1 is in flight: every other file in
 * this directory imports `@neko/game-core` statically, so until the package
 * resolves they fail at collection with one message about a module. This file
 * imports dynamically instead, so it can say precisely which export is missing
 * and which behavioural tests are waiting on it.
 *
 * It is not a substitute for the behavioural tests. An export that exists and
 * is wrong passes here and fails there, which is the correct division.
 */
import { describe, expect, it } from 'vitest';

/** Every value export API.md declares, and the section that declares it. */
const EXPECTED: ReadonlyArray<readonly [string, string, 'class' | 'function']> = [
  ['MediaClock', '§1 — smoothing a coarse source', 'class'],
  ['judge', '§2 — one press against one window set', 'function'],
  ['GameEngine', '§3 — the round', 'class'],
  ['fitTempo', '§5 — tempo estimation', 'function'],
];

const loaded = await (async () => {
  try {
    return { module: (await import('../src/index.ts')) as Record<string, unknown>, error: null };
  } catch (error) {
    return { module: null, error: error as Error };
  }
})();

describe('the package can be imported at all', () => {
  /**
   * `packages/game-core/package.json` currently declares neither `exports` nor
   * `main`, so `@neko/game-core` does not resolve even once `src/` exists —
   * `packages/protocol` carries `"exports": { ".": "./src/index.ts" }` and this
   * package needs the same. That file belongs to the Game Core agent; this test
   * is how the need gets reported rather than fixed in passing.
   */
  it('resolves by package name', () => {
    expect(loaded.error?.message ?? '').toBe('');
  });
});

describe('every export API.md declares is present', () => {
  it.each(EXPECTED)('exports %s — %s', (name) => {
    expect(loaded.module).not.toBeNull();
    expect(loaded.module?.[name]).toBeDefined();
  });

  it.each(EXPECTED)('%s is callable as a %s', (name, _section, kind) => {
    const value = loaded.module?.[name];
    expect(typeof value).toBe('function');
    if (kind === 'class') {
      // A class is a function whose prototype carries methods; a plain function
      // exported where a class was agreed would satisfy `typeof` and nothing else.
      expect(Object.getOwnPropertyNames((value as { prototype?: object })?.prototype ?? {}).length)
        .toBeGreaterThan(1);
    }
  });
});

describe('the documented methods exist on the documented classes', () => {
  it.each([
    ['MediaClock', ['sample', 'timeMs', 'reset']],
    ['GameEngine', ['update', 'press', 'release', 'visible', 'state', 'isOver', 'result']],
  ] as const)('%s has every method in API.md', (className, methods) => {
    const ctor = loaded.module?.[className] as { prototype?: object } | undefined;
    const present = ctor?.prototype ? Object.getOwnPropertyNames(ctor.prototype) : [];
    expect(methods.filter((m) => !present.includes(m))).toEqual([]);
  });
});
