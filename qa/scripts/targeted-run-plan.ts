/**
 * Decides which Playwright invocations the pre-push TIA targeted path should
 * run for a given selection of spec files. (MINCRM-705)
 *
 * WHY THIS EXISTS
 * ---------------
 * The targeted path runs the selection twice — once excluding `@serial` tests
 * and once matching only them — so a spec whose tests are ALL `@serial` is no
 * longer filtered into nothing (the defect MINCRM-705 fixes). But Playwright
 * exits 1 with "No tests found" when a `--grep`/`--grep-invert` matches nothing,
 * and it does so while still writing a well-formed `<testsuites tests="0">`
 * report. Running both halves unconditionally therefore fails the push whenever
 * a selection is wholly-serial or wholly-non-serial — and the latter is the
 * MODAL case, since only ~26 of ~130 functional specs contain any `@serial`
 * test at all.
 *
 * Rather than running an invocation and then deciding whether to forgive its
 * exit code, this decides up front which halves CAN match, so a non-zero exit
 * from a half that was expected to have work is still a real failure. That
 * keeps the exit code meaningful instead of blanket-forgiven.
 *
 * WHY IT LIVES HERE AND NOT IN scripts/pre-push-tia.ts
 * ----------------------------------------------------
 * Same reasoning as container-commit-sha.ts and test-stack-db-env.ts, both split
 * out of that same file: root `scripts/` is covered by tsconfig.scripts.json for
 * TYPECHECK only — `npm run unit_test` runs the server/client/coverage-dashboard
 * workspaces, and Playwright's testDir is qa/e2e/tests, so nothing executes a
 * spec placed next to that script. Specs under qa/e2e/tests/framework/ can
 * import from here, and qa/scripts is already in CI's `qa` paths filter, which
 * makes this the closest home that costs no new build wiring.
 *
 * The subprocess calls deliberately stay in pre-push-tia.ts. Only the decision
 * lives here, so its tests exercise real logic rather than a mock of
 * execFileSync.
 */

import { readFileSync } from 'node:fs';

/**
 * The grep expression identifying a serial test. Matched by the serial
 * invocation and INVERTED by the non-serial one so the two partition the
 * selection exactly. Identical to the expression CI's e2e-serial job uses, so
 * local and CI agree on what "a serial test" means.
 */
export const SERIAL_GREP = '@functional.*@serial|@serial.*@functional';

/** Which half of the split an invocation covers. */
export type InvocationLabel = 'non-serial' | 'serial';

export interface PlannedInvocation {
  label: InvocationLabel;
  /** JUnit output path, relative to qa/. */
  junit: string;
  /** Playwright --output directory, relative to qa/. */
  output: string;
  /** Extra CLI args selecting this half's tests. */
  grep: string[];
  /** Serial tests run single-worker, as they do in CI's e2e-serial job. */
  workers: number;
}

const NON_SERIAL: Omit<PlannedInvocation, 'label'> = {
  junit: 'test-results/targeted-non-serial.xml',
  output: 'test-results/targeted-non-serial-artifacts',
  grep: ['--grep-invert', SERIAL_GREP],
  workers: 0,
};

const SERIAL: Omit<PlannedInvocation, 'label'> = {
  junit: 'test-results/targeted-serial.xml',
  output: 'test-results/targeted-serial-artifacts',
  grep: ['--grep', SERIAL_GREP],
  workers: 1,
};

/**
 * Does this title carry BOTH tags, in either order?
 *
 * Mirrors SERIAL_GREP rather than testing for '@serial' alone, deliberately: a
 * title tagged `@serial` without `@functional` is matched by neither half, and
 * treating it as serial here would plan an invocation that finds nothing. The
 * two must agree, or the plan is wrong in exactly the way this module exists to
 * prevent.
 */
export function isSerialTitle(title: string): boolean {
  return new RegExp(SERIAL_GREP).test(title);
}

/**
 * Extracts test title strings from a spec file's source.
 *
 * Multiline-tolerant: `test(` and its title routinely sit on different lines in
 * this suite, so a line-anchored match silently misses them. Deliberately a
 * best-effort regex scan rather than a TS parse — it needs only to distinguish
 * a tag in a real test title from the same text in a comment.
 */
export function findTestTitles(source: string): string[] {
  const withoutComments = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => {
      const idx = line.indexOf('//');
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join('\n');

  const titles: string[] = [];
  const call = /\btest(?:\.(?:only|skip|fixme))?\s*\(\s*(['"`])((?:\\.|(?!\1).)*)\1/g;
  let match: RegExpExecArray | null;
  while ((match = call.exec(withoutComments)) !== null) {
    titles.push(match[2] ?? '');
  }
  return titles;
}

/**
 * Builds the invocation plan for a selection.
 *
 * @param specFiles - Selected spec file paths, resolvable by `readSource`.
 * @param readSource - Reads a spec file's source. Injected so tests need no
 *   fixture files on disk; defaults to reading the path directly.
 * @returns The invocations that can actually match a test. An empty array means
 *   the selection contains no tests at all, which the caller must treat as a
 *   failure rather than a pass — attestation's `zero-tests-executed` reason
 *   covers the same case from the other side.
 */
export function planTargetedInvocations(
  specFiles: readonly string[],
  readSource: (file: string) => string = (file) => readFileSync(file, 'utf8'),
): PlannedInvocation[] {
  let hasSerial = false;
  let hasNonSerial = false;

  for (const file of specFiles) {
    let titles: string[];
    try {
      titles = findTestTitles(readSource(file));
    } catch {
      // Unreadable spec file: assume BOTH halves may have work rather than
      // skipping one. Planning too few invocations silently drops tests, which
      // is the defect this module exists to prevent; planning one that finds
      // nothing merely costs a wasted startup.
      return [
        { label: 'non-serial', ...NON_SERIAL },
        { label: 'serial', ...SERIAL },
      ];
    }
    for (const title of titles) {
      if (isSerialTitle(title)) hasSerial = true;
      else hasNonSerial = true;
    }
  }

  const plan: PlannedInvocation[] = [];
  if (hasNonSerial) plan.push({ label: 'non-serial', ...NON_SERIAL });
  if (hasSerial) plan.push({ label: 'serial', ...SERIAL });
  return plan;
}
