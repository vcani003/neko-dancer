/**
 * The type-level guarantees, actually enforced.
 *
 * `expectTypeOf` and `@ts-expect-error` are inert unless something type-checks
 * the file holding them, and `npm test` transpiles without checking. Vitest's
 * own `--typecheck` cannot be reached from here without editing a config file
 * this agent does not own — so this test runs the TypeScript compiler over
 * `fixtures/type-guarantees.fixture.ts` itself and asserts it is clean.
 *
 * "Clean" is the whole assertion. An `@ts-expect-error` guarding a line that
 * has stopped being an error is reported as an unused directive (TS2578), so a
 * guarantee that quietly weakens fails here rather than passing silently.
 *
 * Costs about a quarter of a second; `skipLibCheck` keeps it there.
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
    // No tsconfig means no directory to resolve @types from by default, and
    // `crypto` — which `newId` calls — is declared by @types/node.
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
      // The offending source line, so a failure reads as the rule it broke
      // rather than as a line number in a file nobody has open.
      source: d.file && line >= 0 ? (d.file.text.split('\n')[line] ?? '').trim() : '',
    };
  });
}

describe('the type-level contract holds', () => {
  const findings = compileFixture();

  const describeFinding = (f: Finding) =>
    `  fixture:${f.line}  TS${f.code} ${f.message}\n      > ${f.source}`;

  it('compiles the guarantees fixture with no diagnostics at all', () => {
    expect(findings.map(describeFinding).join('\n')).toBe('');
  });

  /**
   * Named separately because it is the failure mode that matters most: TS2578
   * means a line that was supposed to be rejected is now accepted, so a rule
   * the types were enforcing has quietly stopped being enforced.
   */
  it('leaves no @ts-expect-error guarding a line that now compiles', () => {
    const unused = findings.filter((f) => f.code === 2578);
    expect(unused.map(describeFinding).join('\n')).toBe('');
  });

  it('resolves the package from the fixture rather than silently skipping it', () => {
    // A fixture whose import failed to resolve would report zero errors for the
    // wrong reason, and every guarantee above would be vacuous.
    const unresolved = findings.filter((f) => f.code === 2307);
    expect(unresolved.map(describeFinding).join('\n')).toBe('');
  });
});
