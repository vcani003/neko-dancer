/**
 * The package boundary, enforced rather than trusted.
 *
 * §9 and ADR-007: Game Core has no dependency on React, YouTube, WebSockets,
 * the database or rooms. That independence is the reason the engine can be
 * tested by passing `10_000`, and it is the single property most likely to be
 * lost quietly — one `import { something } from '../../apps/web/...'` under a
 * deadline and it is gone, with nothing to notice.
 *
 * `IMPLEMENTATION-PLAN.md` Phase 1 requires this be "enforced by a test that
 * reads the package's own import graph, not by convention". So this reads the
 * source text off disk. It does not consult `package.json`: a manifest records
 * what someone declared, and the question here is what the code actually does.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('../src', import.meta.url));

interface SourceFile {
  path: string;
  rel: string;
  text: string;
  /** Source with comments and string literals blanked, for scanning code only. */
  code: string;
}

function collect(dir: string): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  const found: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...collect(full));
    else if (/\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(entry)) found.push(full);
  }
  return found;
}

/**
 * Blank out comments and string bodies.
 *
 * A comment explaining why YouTube is not imported must not be read as
 * importing YouTube — API.md itself is full of such sentences, and a scanner
 * that cannot tell code from prose produces failures nobody trusts and
 * everybody disables.
 */
function stripNonCode(text: string): string {
  let out = '';
  let i = 0;
  const blank = (s: string) => s.replace(/[^\n]/g, ' ');
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
      // Keep the quotes so an import specifier is still findable, blank the body.
      out += quote + blank(text.slice(i + 1, j)) + (text[j] ?? '');
      i = j + 1;
    } else {
      out += text[i];
      i += 1;
    }
  }
  return out;
}

const files: SourceFile[] = collect(SRC).map((path) => {
  const text = readFileSync(path, 'utf8');
  return { path, rel: relative(SRC, path), text, code: stripNonCode(text) };
});

/** Every module specifier this file pulls in, however it is written. */
function specifiersOf(file: SourceFile): string[] {
  const found: string[] = [];
  const patterns = [
    /\bimport\s+[^;'"]*?\bfrom\s*['"]([^'"]+)['"]/g,
    /\bexport\s+[^;'"]*?\bfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  // Specifiers are read from the raw text: `stripNonCode` blanks string bodies,
  // which is exactly the part needed here.
  for (const pattern of patterns) {
    for (const match of file.text.matchAll(pattern)) {
      // Confirm the statement is real code and not inside a comment, by
      // checking the same offset survived stripping.
      const at = match.index ?? 0;
      if (file.code.slice(at, at + 6).trim() === '') continue;
      found.push(match[1]!);
    }
  }
  return found;
}

const allImports = files.flatMap((f) => specifiersOf(f).map((spec) => ({ file: f.rel, spec })));

describe('the package has source to check', () => {
  /**
   * Without this the whole gate passes vacuously. A test that reads an empty
   * directory and reports no violations is not evidence of anything, and it is
   * the failure mode that would let the boundary rot unnoticed while the suite
   * stayed green.
   */
  it('finds source files under packages/game-core/src', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('finds at least one import to inspect', () => {
    expect(allImports.length).toBeGreaterThan(0);
  });
});

describe('nothing playback-, UI- or storage-shaped is imported — §9, ADR-007', () => {
  const FORBIDDEN: ReadonlyArray<readonly [string, RegExp]> = [
    ['react', /^react(\/|$)/],
    ['react-dom', /^react-dom(\/|$)/],
    ['pixi.js', /^pixi\.js(\/|$)/],
    ['ws', /^ws(\/|$)/],
    ['anything YouTube', /youtube|ytplayer|yt-player/i],
    ['a database client', /^(pg|postgres|postgres\.js|drizzle-orm|@supabase\/.*|mysql2?|sqlite3|better-sqlite3|knex|prisma|@prisma\/.*)(\/|$)/],
    ['the web app', /(^|\/)apps\/web(\/|$)/],
    ['the server app', /(^|\/)apps\/server(\/|$)/],
    ['any app workspace', /^@neko\/(web|server)(\/|$)/],
    ['the legacy src tree', /(^|\/)src\/(engine|charts|analysis|playback|render|net|ui|input)(\/|$)/],
    ['a playback adapter', /PlaybackAdapter|YouTubeAdapter|LocalAudioAdapter|ClickTrackAdapter/],
  ];

  it.each(FORBIDDEN)('imports nothing matching %s', (_label, pattern) => {
    const offending = allImports.filter(({ spec }) => pattern.test(spec));
    expect(offending.map((o) => `${o.file} imports '${o.spec}'`).join('\n')).toBe('');
  });
});

describe('@neko/protocol is the only dependency — API.md', () => {
  /**
   * An allowlist, not a denylist. A denylist only catches the packages someone
   * thought of; this catches the one nobody predicted, which is the one that
   * will actually appear.
   */
  it('imports no bare package other than @neko/protocol', () => {
    const bare = allImports.filter(({ spec }) => !spec.startsWith('.'));
    const disallowed = bare.filter(({ spec }) => spec !== '@neko/protocol' && !spec.startsWith('@neko/protocol/'));
    expect(disallowed.map((o) => `${o.file} imports '${o.spec}'`).join('\n')).toBe('');
  });

  it('imports no Node builtin — this package is arithmetic, not a runtime', () => {
    const builtins = allImports.filter(({ spec }) => spec.startsWith('node:'));
    expect(builtins.map((o) => `${o.file} imports '${o.spec}'`).join('\n')).toBe('');
  });

  it('never reaches outside its own src directory with a relative path', () => {
    const escaping = allImports
      .filter(({ spec }) => spec.startsWith('.'))
      .map(({ file, spec }) => ({
        file,
        spec,
        target: resolve(join(SRC, file), '..', spec),
      }))
      .filter(({ target }) => !target.startsWith(SRC));
    expect(escaping.map((o) => `${o.file} imports '${o.spec}'`).join('\n')).toBe('');
  });
});

describe('the engine takes numbers, so it reaches for no ambient state — ADR-007', () => {
  /**
   * `MediaClock` is *fed* `atWallMs` rather than pulling it. A package that
   * calls `performance.now()` itself has a hidden input, cannot be replayed,
   * and cannot be tested by passing `10_000` — which is the entire justification
   * for ADR-007. The same goes for anything that reads the DOM or the network.
   *
   * Scanned against comment-stripped source, so a comment explaining the rule
   * does not trip the rule.
   */
  const AMBIENT: ReadonlyArray<readonly [string, RegExp]> = [
    ['performance.now', /\bperformance\s*\.\s*now\b/],
    ['Date.now', /\bDate\s*\.\s*now\b/],
    ['new Date', /\bnew\s+Date\b/],
    ['document', /\bdocument\s*\./],
    ['window', /\bwindow\s*\./],
    ['globalThis', /\bglobalThis\s*\./],
    ['navigator', /\bnavigator\s*\./],
    ['localStorage or sessionStorage', /\b(localStorage|sessionStorage|indexedDB)\b/],
    ['fetch', /\bfetch\s*\(/],
    ['WebSocket', /\bWebSocket\b/],
    ['requestAnimationFrame', /\brequestAnimationFrame\b/],
    ['a timer', /\b(setTimeout|setInterval)\s*\(/],
    ['Math.random', /\bMath\s*\.\s*random\b/],
  ];

  it.each(AMBIENT)('never reads %s', (_label, pattern) => {
    const offending = files.filter((f) => pattern.test(f.code));
    expect(offending.map((f) => f.rel).join('\n')).toBe('');
  });
});
