/**
 * Unit tests for select-tests.ts's pure/filesystem logic. (pr-tia-8)
 *
 * globToRegExp and resolveBaselineFiles are exported specifically for this
 * test file — the rest of select-tests.ts (selectTests itself) is a full
 * DB-backed pipeline exercised via manual smoke-testing and the existing
 * server/src/__tests__/testSelectionService.test.ts /
 * coverageMappingService.test.ts integration coverage of the modules it
 * calls into, not re-tested here.
 */

import { resolve } from 'node:path';
import { globToRegExp, resolveBaselineFiles } from '../scripts/select-tests.js';

const REPO_ROOT = resolve(__dirname, '../../..');

describe('globToRegExp', () => {
  it('matches a spec file living DIRECTLY inside the globbed directory (regression: a real bug found via manual smoke-testing)', () => {
    const re = globToRegExp('tests/apps/minicrm/functional/auth/**/*.spec.ts');
    expect(re.test('tests/apps/minicrm/functional/auth/auth.spec.ts')).toBe(true);
  });

  it('matches a spec file nested one level deeper than the globbed directory', () => {
    const re = globToRegExp('tests/apps/minicrm/functional/auth/**/*.spec.ts');
    expect(re.test('tests/apps/minicrm/functional/auth/sub/x.spec.ts')).toBe(true);
  });

  it('matches a spec file nested multiple levels deeper', () => {
    const re = globToRegExp('tests/apps/minicrm/functional/auth/**/*.spec.ts');
    expect(re.test('tests/apps/minicrm/functional/auth/a/b/c.spec.ts')).toBe(true);
  });

  it('does not match a file outside the globbed directory', () => {
    const re = globToRegExp('tests/apps/minicrm/functional/auth/**/*.spec.ts');
    expect(re.test('tests/apps/minicrm/functional/deals/deal-creation.spec.ts')).toBe(false);
  });

  it('does not match a non-.spec.ts file inside the globbed directory', () => {
    const re = globToRegExp('tests/apps/minicrm/functional/auth/**/*.spec.ts');
    expect(re.test('tests/apps/minicrm/functional/auth/helpers.ts')).toBe(false);
  });

  it('escapes regex metacharacters in the literal portions of the glob', () => {
    const re = globToRegExp('tests/a+b.dir/*.spec.ts');
    expect(re.test('tests/a+b.dir/x.spec.ts')).toBe(true);
    // A literal '.' in the glob must not act as a regex wildcard — 'a-bXdir'
    // must NOT match a glob whose literal directory name is 'a+b.dir'.
    expect(re.test('tests/aXbXdir/x.spec.ts')).toBe(false);
  });
});

describe('resolveBaselineFiles', () => {
  it('returns repo-root-relative paths (including the qa/e2e/ prefix) for real files on disk', () => {
    const files = resolveBaselineFiles(REPO_ROOT);

    // This is a real, non-mocked filesystem walk against this actual repo
    // checkout — asserting structural properties of the result rather than
    // a fixed file list, since the auth/ directory's own contents can grow
    // over time without this test needing to change.
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      expect(file.startsWith('qa/e2e/tests/apps/minicrm/functional/auth/')).toBe(true);
      expect(file.endsWith('.spec.ts')).toBe(true);
    }
  });

  it("includes a spec file living directly inside auth/ (regression: the bug globToRegExp's own tests cover, exercised here end to end)", () => {
    const files = resolveBaselineFiles(REPO_ROOT);
    expect(files).toContain('qa/e2e/tests/apps/minicrm/functional/auth/auth.spec.ts');
  });

  it('returns an empty array when the functional directory does not exist under the given cwd', () => {
    const files = resolveBaselineFiles('/nonexistent-repo-root-for-testing');
    expect(files).toEqual([]);
  });
});
