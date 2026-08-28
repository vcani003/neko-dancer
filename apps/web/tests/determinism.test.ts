/**
 * The determinism rule, enforced rather than trusted.
 *
 * `IMPLEMENTATION-PLAN.md` Part 4: **no automated test may require YouTube.**
 * It is the rule most likely to be broken by accident and least likely to be
 * noticed when it is — a test that quietly reaches the network passes on a good
 * day, fails on a train, and fails for a video that gets taken down two years
 * from now, by which point nobody remembers this rule existed.
 *
 * So this reads the test sources off disk. It does not ask what anyone
 * intended; it asks what the files say.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const TESTS = fileURLToPath(new URL('.', import.meta.url));

function collect(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...collect(full));
    else if (/\.ts$/.test(entry)) found.push(full);
  }
  return found;
}

/**
 * Blank comments, string bodies and regex bodies.
 *
 * This file is one of the files it scans, and it contains every forbidden
 * pattern by definition — they are the patterns. A scanner that cannot tell
 * code from the description of code fails on itself, which is the fastest way
 * to get a gate switched off. `packages/game-core`'s import-graph test learned
 * the same lesson against prose; this one learns it against its own tables.
 */
function strip(text: string): string {
  const blank = (s: string) => s.replace(/[^\n]/g, ' ');
  let out = '';
  let i = 0;
  while (i < text.length) {
    const two = text.slice(i, i + 2);
    if (two === '//') {
      const end = text.indexOf('\n', i);
      const stop = end === -1 ? text.length : end;
      out += blank(text.slice(i, stop));
      i = stop;
    } else if (two === '/*') {
      const end = text.indexOf('*/', i + 2);
      const stop = end === -1 ? text.length : end + 2;
      out += blank(text.slice(i, stop));
      i = stop;
    } else if (text[i] === '"' || text[i] === "'" || text[i] === '`') {
      const quote = text[i]!;
      let j = i + 1;
      while (j < text.length && text[j] !== quote) j += text[j] === '\\' ? 2 : 1;
      out += quote + blank(text.slice(i + 1, j)) + (text[j] ?? '');
      i = j + 1;
    } else if (text[i] === '/' && /[([,=:!&|?{;\s]/.test(out[out.length - 1] ?? '(')) {
      // A `/` in an operand position starts a regex literal, not a division.
      let j = i + 1;
      let inClass = false;
      while (j < text.length && text[j] !== '\n') {
        const c = text[j]!;
        if (c === '\\') j += 2;
        else if (c === '[') {
          inClass = true;
          j += 1;
        } else if (c === ']') {
          inClass = false;
          j += 1;
        }
        else if (c === '/' && !inClass) break;
        else j += 1;
      }
      if (text[j] === '/') {
        out += '/' + blank(text.slice(i + 1, j)) + '/';
        i = j + 1;
      } else {
        out += text[i];
        i += 1;
      }
    } else {
      out += text[i];
      i += 1;
    }
  }
  return out;
}

const files = collect(TESTS).map((path) => {
  const text = readFileSync(path, 'utf8');
  return { rel: relative(TESTS, path), code: strip(text) };
});

describe('there is something to check', () => {
  /**
   * Without this the gate passes vacuously, which is the failure mode that
   * would let the rule rot while the suite stayed green.
   */
  it('finds the playback tests', () => {
    expect(files.length).toBeGreaterThan(2);
  });
});

/**
 * A YouTube address written in a string is NOT a violation.
 *
 * `youtube-provider.test.ts` is full of them, and every one is a fixture for a
 * pure parser — the thing being tested is precisely that a link can be read
 * without going anywhere. A gate that cannot tell a destination from a piece of
 * test data flags the correct tests, and a gate that flags correct tests gets
 * switched off. So what is banned here is *reaching*: the calls, not the
 * addresses.
 */
describe('nothing here can reach YouTube', () => {
  const FORBIDDEN: ReadonlyArray<readonly [string, RegExp]> = [
    ['calls fetch', /\bfetch\s*\(/],
    // The name also appears as an *option* every test fills with its own
    // answer, which is the correct use. Only importing the real one is banned.
    ['imports the real oEmbed lookup', /import\s*\{[^}]*\bfetchOEmbed\b[^}]*\}/],
    ['loads the real IFrame API', /\bloadYouTubeApi\b/],
    ['opens a socket', /\bnew\s+WebSocket\b/],
    ['uses XMLHttpRequest', /\bXMLHttpRequest\b/],
  ];

  it.each(FORBIDDEN)('never %s', (_label, pattern) => {
    const offending = files.filter((f) => pattern.test(f.code));
    expect(offending.map((f) => f.rel).join('\n')).toBe('');
  });
});

describe('nothing here depends on how long it took to run', () => {
  /**
   * A fake exists to remove wall time from the answer. A test that reads the
   * clock has put it back, and will fail on a loaded machine for reasons that
   * have nothing to do with the code.
   */
  const AMBIENT: ReadonlyArray<readonly [string, RegExp]> = [
    ['reads Date.now', /\bDate\s*\.\s*now\b/],
    ['reads performance.now', /\bperformance\s*\.\s*now\b/],
    ['rolls a random number', /\bMath\s*\.\s*random\b/],
  ];

  it.each(AMBIENT)('never %s', (_label, pattern) => {
    const offending = files.filter((f) => pattern.test(f.code));
    expect(offending.map((f) => f.rel).join('\n')).toBe('');
  });
});
