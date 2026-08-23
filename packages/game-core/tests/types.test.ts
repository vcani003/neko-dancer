/**
 * The signatures in API.md, actually enforced.
 *
 * `@ts-expect-error` is inert unless something type-checks the file holding it,
 * and `npm test` transpiles without checking. So this runs the TypeScript
 * compiler over `fixtures/type-guarantees.fixture.ts` and asserts it is clean —
 * the approach that caught the missed `readonly` on `PlayerProgress` in Phase 0.
 *
 * Costs about a quarter of a second.
 */
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import ts from 'typescript';

const FIXTURE = fileURLToPath(new URL('./fixtures/type-guarantees.fixture.ts', import.meta.url));

interface Finding {
  line: number;
  code: number;
  message: string;
  source: string;
}

/** Mirrors `packages/protocol/tsconfig.json`, so this checks what the build checks. */
function compileFixture(): Finding[] {
  const program = ts.createProgram([FIXTURE], {
    target: ts.ScriptTarget.ES2022,
    lib: ['lib.es2022.d.ts'],
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    allowImportingTsExtensions: true,
    verbatimModuleSyntax: true,
    erasableSyntaxOnly: true,
    isolatedModules: true,
    strict: true,
    noUncheckedIndexedAccess: true,
    noEmit: true,
    skipLibCheck: true,
    typeRoots: [fileURLToPath(new URL('../../../node_modules/@types', import.meta.url))],
    types: ['node'],
  });

  return ts.getPreEmitDiagnostics(program).map((d) => {
    const line = d.file && d.start !== undefined
      ? d.file.getLineAndCharacterOfPosition(d.start).line
      : -1;
    return {
      line: line + 1,
      code: d.code,
      message: ts.flattenDiagnosticMessageText(d.messageText, ' '),
      source: d.file && line >= 0 ? (d.file.text.split('\n')[line] ?? '').trim() : '',
    };
  });
}

describe('the surface matches the signatures API.md declares', () => {
  const findings = compileFixture();
  const describeFinding = (f: Finding) =>
    `  fixture:${f.line}  TS${f.code} ${f.message}\n      > ${f.source}`;

  it('compiles the signature fixture with no diagnostics at all', () => {
    expect(findings.map(describeFinding).join('\n')).toBe('');
  });

  /**
   * TS2578 means a line that was supposed to be rejected now compiles — a rule
   * the types were enforcing has quietly stopped being enforced. Named
   * separately because it is the failure mode that matters most.
   */
  it('leaves no @ts-expect-error guarding a line that now compiles', () => {
    const unused = findings.filter((f) => f.code === 2578);
    expect(unused.map(describeFinding).join('\n')).toBe('');
  });

  it('resolves @neko/game-core rather than silently skipping every check', () => {
    // A fixture whose import failed would report only a module error and every
    // guarantee above would be vacuous.
    const unresolved = findings.filter((f) => f.code === 2307);
    expect(unresolved.map(describeFinding).join('\n')).toBe('');
  });
});
