/**
 * Pins qa/scripts/targeted-run-plan.ts — the rule deciding which Playwright
 * invocations the pre-push TIA targeted path runs.
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
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  planTargetedInvocations,
  findTestTitles,
  isSerialTitle,
  isNonSerialTitle,
  NON_SERIAL_GREP_INVERT,
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

  test('the two halves partition the selection, and the inversion matches CI', () => {
    const plan = planTargetedInvocations(['c.spec.ts'], reader({ 'c.spec.ts': MIXED_SPEC }));
    const nonSerial = plan.find((p) => p.label === 'non-serial');
    const serial = plan.find((p) => p.label === 'serial');

    // Inverting a different expression than the serial half matches would leave
    // titles that neither half runs — e.g. a title tagged @serial without
    // @functional, or one merely mentioning "@serial" in prose.
    expect(nonSerial?.grep).toEqual(['--grep-invert', NON_SERIAL_GREP_INVERT]);
    expect(serial?.grep).toEqual(['--grep', SERIAL_GREP]);
  });

  test('the inversion still covers the serial half after any edit to either', () => {
    // The complement property composition would have GUARANTEED, asserted
    // directly instead: NON_SERIAL_GREP_INVERT is CI's literal, not
    // `visual-regression|${SERIAL_GREP}` (composing selects a strictly larger
    // set — see that constant's docblock), so nothing structural stops the two
    // from drifting apart.
    //
    // Derived from SERIAL_GREP rather than hand-written, so it cannot degrade
    // into a tautology: every title asserted here is one the serial half really
    // selects, generated from the expression under test. A hand-written list of
    // "@serial"-bearing titles would pass for free, since the inversion contains
    // `serial` as a bare substring alternative.
    const invert = new RegExp(NON_SERIAL_GREP_INVERT);
    const serialTitles = [
      '@functional @serial F-OB1: widget is visible',
      '@serial @functional F-OB2: widget is hidden',
      'F3: thing @functional @serial',
    ].filter((title) => isSerialTitle(title));

    expect(serialTitles).toHaveLength(3);
    for (const title of serialTitles) {
      expect(invert.test(title)).toBe(true);
    }

    // The half that can actually regress: a title the serial half does NOT
    // select must still survive the inversion, or the two halves overlap and
    // some test runs twice — or, if the inversion widened, runs never.
    expect(isSerialTitle('@functional F-C1: creates a contact')).toBe(false);
    expect(invert.test('@functional F-C1: creates a contact')).toBe(false);
  });

  test('NON_SERIAL_GREP_INVERT holds the exact literal CI is pinned to', () => {
    // Deliberately NOT named "matches CI": this assertion cannot see ci.yml. It
    // pins the local half of a two-sided invariant, so a "simplification" to a
    // regex form fails here immediately. The cross-file half — that ci.yml and
    // the gate document carry this same literal in a REAL command, not merely
    // in prose — is enforced by qa/scripts/check-grep-invert-parity.sh, which
    // runs in e2e-framework-purity. Neither check substitutes for the other.
    expect(NON_SERIAL_GREP_INVERT).toBe('visual-regression|serial');
  });

  test('plans nothing for a spec excluded by its PATH alone', () => {
    // visual-regression.spec.ts is excluded by its path — not one of its titles
    // contains the string — so a title-only predicate would call these tests
    // non-serial, plan that half, and Playwright would then select zero and
    // exit 1, failing the push. Playwright greps path + describe + title
    // together, so the planner has to consider the path too.
    const visualSpec = 'qa/e2e/tests/apps/minicrm/functional/visual/visual-regression.spec.ts';
    const visualSource = `
      test('V1: pipeline board renders correctly at desktop viewport @visual', async () => {});
      test('V2: pipeline board renders correctly at mobile viewport @visual', async () => {});
    `;

    expect(isNonSerialTitle('V1: renders at desktop viewport @visual')).toBe(true);
    expect(isNonSerialTitle('V1: renders at desktop viewport @visual', visualSpec)).toBe(false);

    expect(planTargetedInvocations([visualSpec], reader({ [visualSpec]: visualSource }))).toEqual(
      [],
    );
  });

  // NOTE: this title deliberately spells the tag as "functional-tagged" rather
  // than writing it literally. Playwright greps the title, so a literal tag makes
  // this framework spec selectable by the functional suite — measured, three
  // titles in this file leaked that way:
  //
  //   --grep "@functional" --grep-invert "visual-regression|serial"
  //     (the non-serial half, both projects):  1004/80 files → 1002/79
  //   --grep "@functional" --project=desktop:  661/97 files  → 658/96
  //
  // Same reason for the two isSerialTitle titles below.
  //
  // A bare `@serial` in a title is SAFE and two remain above deliberately:
  // SERIAL_GREP requires BOTH tags, so `@serial` alone matches neither half.
  // Only `@functional` needs avoiding.
  test('no real functional-tagged title in the suite falls between the two halves', () => {
    // The inversion is BROADER than SERIAL_GREP (it also drops anything matching
    // visual-regression), so the halves are no longer exact complements — a
    // title can match neither and would then run in NO invocation at all.
    //
    // Scans the REAL suite rather than a hand-written list: a hardcoded list can
    // only contain titles someone already thought of, so it could never fail for
    // the reason this test exists. A future spec titled, say, "handles
    // non-serial ordering @functional" lands in the gap, and this reads it off
    // disk and fails.
    // Scoped to the app suite, which is what TIA selects and what these two
    // invocations run. Framework-style specs are excluded: they are never
    // TIA-selected, and several legitimately quote tag names as TEST DATA —
    // this file's own "treats a plain @functional title as non-serial" is a
    // string under test, not a tagged test, and scanning it would report a
    // permanent false orphan.
    //
    // Directory alone is not a sufficient filter: qa/package.json's
    // `test:framework` runs four such specs that live under tests/apps/ rather
    // than tests/framework/. They are excluded BY NAME rather than by requiring
    // '@functional' in the title, because that predicate would also swallow real
    // orphans in genuine functional specs — precisely what this scan exists to
    // surface. Naming a known exception is honest; a filter that hides the
    // finding is not.
    const FRAMEWORK_SPECS_UNDER_APPS = new Set([
      'qa/e2e/tests/apps/minicrm/resource-registry.spec.ts',
      'qa/e2e/tests/apps/minicrm/build-conflict-graph.spec.ts',
      'qa/e2e/tests/apps/minicrm/gen-conflict-group-configs.spec.ts',
      'qa/e2e/tests/apps/minicrm/test-data-manager.spec.ts',
    ]);

    const repoRoot = resolve(__dirname, '../../../..');
    const specFiles = execFileSync('git', ['ls-files', 'qa/e2e/tests/apps/**/*.spec.ts'], {
      cwd: repoRoot,
      encoding: 'utf8',
    })
      .split('\n')
      .filter(Boolean)
      .filter((file) => !FRAMEWORK_SPECS_UNDER_APPS.has(file));

    // Guards the scan itself: a glob that silently matched nothing would make
    // this test pass vacuously, which is the failure mode it exists to avoid.
    expect(specFiles.length).toBeGreaterThan(50);

    const orphans: string[] = [];

    for (const file of specFiles) {
      for (const title of findTestTitles(readFileSync(resolve(repoRoot, file), 'utf8'))) {
        // Every title in a functional spec is checked, deliberately — no
        // '@functional' pre-filter. Both halves pass `--grep @functional`, so an
        // untagged title runs nowhere anyway; but filtering on the tag here
        // would hide gap titles that DO carry it, which is the finding.
        if (!isSerialTitle(title) && !isNonSerialTitle(title)) {
          orphans.push(`${file} :: ${title}`);
        }
      }
    }

    expect(orphans).toEqual([]);
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

  test('treats a serial-tagged title without the functional tag as NON-serial', () => {
    // Deliberate: SERIAL_GREP does not match it either, so calling it serial
    // would plan an invocation that finds nothing. The classifier and the grep
    // must agree.
    expect(isSerialTitle('every @serial-tagged spec file has an entry')).toBe(false);
  });

  test('treats a plain functional-tagged title as non-serial', () => {
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
