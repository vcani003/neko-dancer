/**
 * The test fixtures are themselves valid.
 *
 * `ENGINEERING.md` §5: "Fixtures must be realistic." A test chart missing
 * `type: 'tap'` once passed a server that only counted arrows and failed the
 * client validator, so the test proved nothing about the path it claimed to
 * cover.
 *
 * Every builder in `helpers.ts` must produce something the validators accept.
 * Without this, a rejection test could be passing because the *builder* is
 * broken rather than because the field it changed is — and the whole suite
 * would go green while checking nothing.
 *
 * This file also absorbs the throwaway resolution smoke test: if
 * `@neko/protocol` stops resolving, everything here fails at import.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_WINDOWS,
  JUDGMENTS,
  parseClientMessage,
  validateBeatmapMetadata,
  validateChartRevision,
  validateProgress,
  validateRoundResult,
  validateTiming,
} from '@neko/protocol';
import {
  UUID_A, UUID_B, UUID_C, hold, metadata, progress, revision, roundResult, tap, validTiming,
} from './helpers.ts';

describe('the package resolves by name', () => {
  it('exports what the tests import', () => {
    expect(JUDGMENTS).toEqual(['PERFECT', 'GREAT', 'GOOD', 'OKAY', 'MISS']);
    expect(DEFAULT_WINDOWS.okayMs).toBe(160);
    expect(parseClientMessage({ type: 'leave' }).ok).toBe(true);
  });
});

describe('every builder produces something the validators accept', () => {
  it('builds a valid chart revision', () => {
    const result = validateChartRevision(revision());
    expect(result.ok, result.ok ? '' : result.errors.join(' | ')).toBe(true);
  });

  it('builds a valid revision holding both a tap and a hold', () => {
    const result = validateChartRevision(revision({
      notes: [tap({ id: 'a', timeMs: 0 }), hold({ id: 'b', timeMs: 500 })],
    }));
    expect(result.ok, result.ok ? '' : result.errors.join(' | ')).toBe(true);
  });

  it('builds a valid timing map', () => {
    const errors: string[] = [];
    expect(validateTiming(validTiming(), errors)).not.toBeNull();
    expect(errors).toEqual([]);
  });

  it('builds valid beatmap metadata', () => {
    const result = validateBeatmapMetadata(metadata());
    expect(result.ok, result.ok ? '' : result.errors.join(' | ')).toBe(true);
  });

  it('builds a valid progress report', () => {
    const result = validateProgress(progress());
    expect(result.ok, result.ok ? '' : result.errors.join(' | ')).toBe(true);
  });

  it('builds a valid round result', () => {
    const result = validateRoundResult(roundResult());
    expect(result.ok, result.ok ? '' : result.errors.join(' | ')).toBe(true);
  });

  it('builds a round result with a tally for every declared grade', () => {
    const result = validateRoundResult(roundResult());
    if (result.ok) expect(Object.keys(result.value.counts).sort()).toEqual([...JUDGMENTS].sort());
  });
});

describe('the sample uuids are real uuids and are distinct', () => {
  // Three, because several tests need to prove that two ids of different kinds
  // are not interchangeable, which needs more than one value to be convincing.
  it('are all accepted, and all different', () => {
    for (const id of [UUID_A, UUID_B, UUID_C]) {
      expect(validateChartRevision(revision({ id })).ok).toBe(true);
    }
    expect(new Set([UUID_A, UUID_B, UUID_C]).size).toBe(3);
  });
});

describe('an override changes exactly one thing', () => {
  // If a builder ignored its overrides, every rejection test would pass by
  // validating the untouched happy path instead of the broken field.
  it('applies an override to the revision', () => {
    const result = validateChartRevision(revision({ revision: 7 }));
    if (result.ok) expect(result.value.revision).toBe(7);
  });

  it('applies an override to a note', () => {
    expect(tap({ timeMs: 42 }).timeMs).toBe(42);
    expect(hold({ durationMs: 42 }).durationMs).toBe(42);
  });

  it('lets an override remove a field by setting it undefined', () => {
    expect(hold({ durationMs: undefined }).durationMs).toBeUndefined();
  });
});
