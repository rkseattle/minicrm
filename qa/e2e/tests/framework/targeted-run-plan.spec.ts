/**
 * Pins qa/scripts/targeted-run-plan.ts — the rule deciding which Playwright
 * invocations the pre-push TIA targeted path runs. (MINCRM-705)
 *
 * WHAT THIS PINS, AND WHY IT EXISTS
 * ---------------------------------
 * The targeted path runs the selection twice, once excluding @serial tests and
 * once matching only them, so a wholly-@serial spec is no longer filtered into
 * nothing. Playwright exits 1 with "No tests found" when a grep matches nothing
 * — verified against the installed version, which exits 1 while still writing a
 * well-formed `<testsuites tests="0">`. Running both halves unconditionally
 * therefore FAILS THE PUSH whenever a selection is wholly-serial or
 * wholly-non-serial, and the latter is the modal case: only ~26 of ~130
 * functional specs contain any @serial test.
 *
 * That defect shipped in a first draft of this work and was caught in review,
 * not by a test, because scripts/pre-push-tia.ts has no test runner. Extracting
 * the decision here is what makes it testable, following container-commit-sha.ts
 * and test-stack-db-env.ts, which were split out of that same file for the same
 * reason.
 *
 * WHAT THIS DOES NOT COVER
 * ------------------------
 * The subprocess calls, the JUnit merge, and attestation all stay in
 * pre-push-tia.ts and are still untested — only the decision is here. That is
 * deliberate: these tests exercise real logic rather than a mock of
 * execFileSync.
 */

import { test, expect } from '@playwright/test';
import {
  planTargetedInvocations,
  findTestTitles,
  isSerialTitle,
  SERIAL_GREP,
} from '../../../scripts/targeted-run-plan.js';

/** Builds a fake reader over an in-memory file map. */
function reader(files: Record<string, string>): (file: string) => string {
  return (file) => {
    const source = files[file];
    if (source === undefined) throw new Error(`no such file: ${file}`);
    return source;
  };
}

const SERIAL_SPEC = `
  test('@functional @serial F-OB1: widget is visible', async () => {});
  test('@functional @serial F-OB2: widget is hidden', async () => {});
`;

const NON_SERIAL_SPEC = `
  test('@functional F-C1: creates a contact', async () => {});
`;

const MIXED_SPEC = `
  test('@functional F-M1: plain', async () => {});
  test('@functional @serial F-M2: serial', async () => {});
`;

test.describe('planTargetedInvocations', () => {
  test('plans only the serial half for a wholly-@serial selection', () => {
    const plan = planTargetedInvocations(['a.spec.ts'], reader({ 'a.spec.ts': SERIAL_SPEC }));

    // The non-serial half would match nothing and exit 1, failing the push even
    // though every selected test passed. This is the onboarding.spec.ts /
    // visibility.spec.ts shape — the case the whole split exists for.
    expect(plan.map((p) => p.label)).toEqual(['serial']);
    expect(plan[0]?.workers).toBe(1);
  });

  test('plans only the non-serial half when nothing is @serial (the modal case)', () => {
    const plan = planTargetedInvocations(['b.spec.ts'], reader({ 'b.spec.ts': NON_SERIAL_SPEC }));

    expect(plan.map((p) => p.label)).toEqual(['non-serial']);
  });

  test('plans both halves for a mixed file', () => {
    const plan = planTargetedInvocations(['c.spec.ts'], reader({ 'c.spec.ts': MIXED_SPEC }));

    expect(plan.map((p) => p.label)).toEqual(['non-serial', 'serial']);
  });

  test('plans both halves when different files supply each population', () => {
    const plan = planTargetedInvocations(
      ['a.spec.ts', 'b.spec.ts'],
      reader({ 'a.spec.ts': SERIAL_SPEC, 'b.spec.ts': NON_SERIAL_SPEC }),
    );

    expect(plan.map((p) => p.label)).toEqual(['non-serial', 'serial']);
  });

  test('returns an empty plan when the selection contains no tests', () => {
    // The caller must treat this as a failure, not a no-op: running nothing and
    // reporting success is the defect this ticket closes.
    const plan = planTargetedInvocations(
      ['d.spec.ts'],
      reader({ 'd.spec.ts': '// no tests here' }),
    );

    expect(plan).toEqual([]);
  });

  test('plans BOTH halves when a spec file cannot be read', () => {
    // Fail toward running too much rather than too little: planning too few
    // invocations silently drops tests, which is the defect being fixed;
    // planning one that finds nothing merely costs a wasted startup.
    const plan = planTargetedInvocations(['missing.spec.ts'], reader({}));

    expect(plan.map((p) => p.label)).toEqual(['non-serial', 'serial']);
  });

  test('the two halves are exact complements of one expression', () => {
    const plan = planTargetedInvocations(['c.spec.ts'], reader({ 'c.spec.ts': MIXED_SPEC }));
    const nonSerial = plan.find((p) => p.label === 'non-serial');
    const serial = plan.find((p) => p.label === 'serial');

    // Inverting a different expression than the serial half matches would leave
    // titles that neither half runs — e.g. a title tagged @serial without
    // @functional, or one merely mentioning "@serial" in prose.
    expect(nonSerial?.grep).toEqual(['--grep-invert', SERIAL_GREP]);
    expect(serial?.grep).toEqual(['--grep', SERIAL_GREP]);
  });

  test('each half writes its own JUnit and output paths', () => {
    // Playwright's junit reporter writes one fixed path and every invocation
    // clears its outputDir at startup, so shared paths would have the second
    // half destroy the first's report and artifacts.
    const plan = planTargetedInvocations(['c.spec.ts'], reader({ 'c.spec.ts': MIXED_SPEC }));

    expect(new Set(plan.map((p) => p.junit)).size).toBe(plan.length);
    expect(new Set(plan.map((p) => p.output)).size).toBe(plan.length);
  });
});

test.describe('isSerialTitle', () => {
  test('requires BOTH tags, in either order', () => {
    expect(isSerialTitle('@functional @serial F1: thing')).toBe(true);
    expect(isSerialTitle('@serial @functional F2: thing')).toBe(true);
    expect(isSerialTitle('F3: thing @functional @serial')).toBe(true);
  });

  test('treats a @serial title without @functional as NON-serial', () => {
    // Deliberate: SERIAL_GREP does not match it either, so calling it serial
    // would plan an invocation that finds nothing. The classifier and the grep
    // must agree.
    expect(isSerialTitle('every @serial-tagged spec file has an entry')).toBe(false);
  });

  test('treats a plain @functional title as non-serial', () => {
    expect(isSerialTitle('@functional F4: thing')).toBe(false);
  });
});

test.describe('findTestTitles', () => {
  test('finds titles split across lines', () => {
    // ai-usage-dashboard.spec.ts is exactly this shape; a line-anchored match
    // misses it, and a hand-grep of this repo did exactly that during planning.
    const titles = findTestTitles(`
      test(
        'F-AI-UD-6: persists rates @functional @serial',
        { tag: ['@functional', '@serial'] },
        async () => {},
      );
    `);

    expect(titles).toEqual(['F-AI-UD-6: persists rates @functional @serial']);
  });

  test('ignores titles inside comments', () => {
    const titles = findTestTitles(`
      // test('@functional @serial COMMENTED: not real', async () => {});
      /* test('@functional @serial BLOCKED: also not real', async () => {}); */
      test('@functional REAL: this one counts', async () => {});
    `);

    expect(titles).toEqual(['@functional REAL: this one counts']);
  });

  test('finds test.only / test.skip / test.fixme titles', () => {
    const titles = findTestTitles(`
      test.only('@functional A: a', async () => {});
      test.skip('@functional B: b', async () => {});
      test.fixme('@functional C: c', async () => {});
    `);

    expect(titles).toEqual(['@functional A: a', '@functional B: b', '@functional C: c']);
  });

  test('returns an empty array for a file with no tests', () => {
    expect(findTestTitles('export const nothing = 1;')).toEqual([]);
  });
});
