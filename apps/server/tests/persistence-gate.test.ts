/**
 * Phase 3 gate: no authoritative localStorage write lives in this package.
 *
 * The prototype's ChartStore still uses the browser. This package is the
 * replacement, and a scanner that reads the source is the thing that
 * notices if someone puts the old habit back. Comments and strings are
 * blanked first — this file names the banned words on purpose.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('../src', import.meta.url));

function collect(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...collect(full));
    else if (/\.(ts|tsx|js|mjs)$/.test(entry)) found.push(full);
  }
  return found;
}

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
      out += quote + blank(text.slice(i + 1, j)) + (text[j] ?? '');
      i = j + 1;
    } else {
      out += text[i];
      i += 1;
    }
  }
  return out;
}

const files = collect(SRC).map((path) => ({
  rel: relative(SRC, path),
  code: stripNonCode(readFileSync(path, 'utf8')),
}));

describe('the data layer does not keep state in the browser', () => {
  const BANNED: ReadonlyArray<readonly [string, RegExp]> = [
    ['localStorage', /\blocalStorage\b/],
    ['sessionStorage', /\bsessionStorage\b/],
    ['indexedDB', /\bindexedDB\b/],
  ];

  it.each(BANNED)('never writes %s', (_label, pattern) => {
    const offending = files.filter((f) => pattern.test(f.code));
    expect(offending.map((f) => f.rel).join('\n')).toBe('');
  });
});
