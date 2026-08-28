/**
 * Tests for specRunnability.
 *
 * Both halves matter independently: a file can be unreconcilable because no
 * invocation selects it, or because it emits no coverage dump, and a corpus
 * covering only the first would pass with the second deleted.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  emitsCoverageDump,
  isPathExcludedFromNonSerial,
  isReconcilable,
} from '@minicrm/shared/testing/specRunnability.js';

function repoRoot(): string {
  let candidate = dirname(fileURLToPath(import.meta.url));
  while (!existsSync(resolve(candidate, '.git'))) {
    const parent = dirname(candidate);
    if (parent === candidate) throw new Error('no ancestor directory contains .git');
    candidate = parent;
  }
  return candidate;
}

describe('isPathExcludedFromNonSerial', () => {
  it('excludes a visual-regression spec by its path alone', () => {
    expect(
      isPathExcludedFromNonSerial(
        'qa/e2e/tests/apps/minicrm/functional/visual/visual-regression.spec.ts',
      ),
    ).toBe(true);
  });

  it('does not exclude an ordinary functional spec', () => {
    expect(
      isPathExcludedFromNonSerial('qa/e2e/tests/apps/minicrm/functional/contacts/contacts.spec.ts'),
    ).toBe(false);
  });

  // A checkout living under a directory containing the excluded term must not
  // exclude the whole suite — the reason the match is testDir-relative.
  it('ignores an excluded term appearing above the test directory', () => {
    expect(
      isPathExcludedFromNonSerial(
        '/home/serial/project/qa/e2e/tests/apps/minicrm/functional/deals/deals.spec.ts',
      ),
    ).toBe(false);
  });
});

describe('emitsCoverageDump', () => {
  it('is true for a spec taking the page fixture', () => {
    expect(emitsCoverageDump('test("x", async ({ page }) => {});')).toBe(true);
  });

  it('is false for a spec taking only API fixtures', () => {
    expect(emitsCoverageDump('test("x", async ({ testData, restClient }) => {});')).toBe(false);
  });
});

describe('isReconcilable', () => {
  it('rejects a page-less spec even on an includable path', () => {
    expect(
      isReconcilable(
        'qa/e2e/tests/apps/minicrm/functional/auth/email-delivery.spec.ts',
        'test("x", async ({ testData, restClient }) => {});',
      ),
    ).toBe(false);
  });

  it('rejects a page-using spec on an excluded path', () => {
    expect(
      isReconcilable(
        'qa/e2e/tests/apps/minicrm/functional/visual/visual-regression.spec.ts',
        'test("x", async ({ page }) => {});',
      ),
    ).toBe(false);
  });

  it('accepts an ordinary page-using spec', () => {
    expect(
      isReconcilable(
        'qa/e2e/tests/apps/minicrm/functional/contacts/contacts.spec.ts',
        'test("x", async ({ page }) => {});',
      ),
    ).toBe(true);
  });
});

// The live instance this phase exists for: email-delivery.spec.ts is page-less
// AND in the always-run baseline, so it is in specFiles on every targeted
// pre-push and was reported missing on each one.
describe('the real spec tree', () => {
  it('finds the baseline spec that cannot emit a coverage dump', () => {
    const specFile = 'qa/e2e/tests/apps/minicrm/functional/auth/email-delivery.spec.ts';
    const source = readFileSync(resolve(repoRoot(), specFile), 'utf-8');
    expect(isReconcilable(specFile, source)).toBe(false);
  });

  it('treats most functional specs as reconcilable', () => {
    const specs = execFileSync(
      'git',
      ['ls-files', 'qa/e2e/tests/apps/minicrm/functional/**/*.spec.ts'],
      { cwd: repoRoot(), encoding: 'utf-8' },
    )
      .trim()
      .split('\n')
      .filter(Boolean);
    const unreconcilable = specs.filter(
      (specFile) => !isReconcilable(specFile, readFileSync(resolve(repoRoot(), specFile), 'utf-8')),
    );
    // A band tight enough to fail if either half of the predicate is deleted:
    // dropping the coverage-dump check leaves only the path-excluded spec, and
    // dropping the path check loses it. Deliberately not an exact list, which
    // would fail on any new page-less spec rather than on a broken predicate.
    expect(unreconcilable.length).toBeGreaterThanOrEqual(10);
    expect(unreconcilable.length).toBeLessThan(specs.length / 2);
    expect(unreconcilable).toContain(
      'qa/e2e/tests/apps/minicrm/functional/auth/email-delivery.spec.ts',
    );
  });
});
