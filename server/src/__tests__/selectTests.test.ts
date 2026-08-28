/**
 * Unit tests for select-tests.ts's pure/filesystem logic. (pr-tia-8)
 *
 * resolveBaselineFiles, parseArgs and impactRationale are exported specifically for
 * this test file — the rest of select-tests.ts (selectTests itself) is a full
 * DB-backed pipeline exercised via manual smoke-testing and the existing
 * server/src/__tests__/testSelectionService.test.ts /
 * coverageMappingService.test.ts integration coverage of the modules it
 * calls into, not re-tested here.
 */

import { resolve } from 'node:path';
import { resolveBaselineFiles, parseArgs, impactRationale } from '../scripts/select-tests.js';

const REPO_ROOT = resolve(__dirname, '../../..');

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

// This script's --base/--head carry the same `=`-preserving split as
// verify-test-attestation.ts's parseArgs, and it was the last of the four live
// sites left unpinned — a revert to `.split('=')[1]` passed the whole suite.
// It also has the largest blast radius of the four: a truncated ref is a
// DIFFERENT ref, which resolveShaForRef may resolve SUCCESSFULLY rather than
// throwing, so parseGitDiff diffs the wrong range and the selection silently
// narrows. Tests that should have run simply do not.
describe('parseArgs', () => {
  /** The env vars parseArgs falls back to, saved and restored around each test. */
  const FALLBACK_VARS = ['GITHUB_BASE_REF', 'GIT_COMMIT_SHA', 'GITHUB_SHA'] as const;
  let savedEnv: Record<string, string | undefined>;

  beforeEach(() => {
    savedEnv = Object.fromEntries(FALLBACK_VARS.map((k) => [k, process.env[k]]));
    // Cleared so a CI runner's own GITHUB_SHA cannot silently satisfy an
    // assertion about the literal defaults — this suite runs under Actions,
    // where all three of these are routinely set.
    for (const k of FALLBACK_VARS) delete process.env[k];
  });

  afterEach(() => {
    for (const k of FALLBACK_VARS) {
      if (savedEnv[k] === undefined) delete process.env[k];
      else process.env[k] = savedEnv[k];
    }
  });

  it('preserves an "=" in --base rather than truncating at it', () => {
    expect(parseArgs(['--base=refs/heads/foo=bar']).baseRef).toBe('refs/heads/foo=bar');
  });

  it('preserves an "=" in --head rather than truncating at it', () => {
    expect(parseArgs(['--head=refs/heads/a=b']).headRef).toBe('refs/heads/a=b');
  });

  it('preserves several "=" in one ref', () => {
    expect(parseArgs(['--base=a=b=c']).baseRef).toBe('a=b=c');
  });

  it('reads plain refs unchanged', () => {
    const args = parseArgs(['--base=origin/main', '--head=HEAD']);
    expect(args).toEqual({ baseRef: 'origin/main', headRef: 'HEAD', forceFullSuite: false });
  });

  it('falls back to the literal defaults when no flags and no env are set', () => {
    expect(parseArgs([])).toEqual({
      baseRef: 'origin/main',
      headRef: 'HEAD',
      forceFullSuite: false,
    });
  });

  it('prefers the env fallbacks over the literal defaults', () => {
    process.env.GITHUB_BASE_REF = 'origin/release';
    process.env.GITHUB_SHA = 'abc123';

    expect(parseArgs([])).toMatchObject({ baseRef: 'origin/release', headRef: 'abc123' });
  });

  it('prefers an explicit flag over the env fallback', () => {
    process.env.GITHUB_BASE_REF = 'origin/release';

    expect(parseArgs(['--base=origin/main']).baseRef).toBe('origin/main');
  });

  // A bare `--base=` yields '', which is NOT nullish, so `??` keeps it rather
  // than falling through to the env chain. Unchanged by the `=` fix — both
  // split forms produce '' here — and pinned so it stays deliberate rather than
  // becoming an accident of whichever split is in use.
  it('keeps an empty --base rather than falling through to the env chain', () => {
    process.env.GITHUB_BASE_REF = 'origin/release';

    expect(parseArgs(['--base=']).baseRef).toBe('');
  });

  it('detects --force-full-suite', () => {
    expect(parseArgs(['--force-full-suite']).forceFullSuite).toBe(true);
  });
});

describe('impactRationale', () => {
  it('reports the failure rather than an empty result when resolution threw', () => {
    const lines = impactRationale({ specFiles: [], fullSuite: false, error: 'no entry covers x' });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('FAILED');
    expect(lines[0]).toContain('no entry covers x');
  });

  it('reports the full-suite outcome', () => {
    const lines = impactRationale({ specFiles: [], fullSuite: true, error: null });
    expect(lines).toEqual(['Impact resolution: full functional suite.']);
  });

  // A diff that legitimately impacts nothing must stay quiet, or every docs PR
  // gains a line saying nothing happened.
  it('says nothing when resolution succeeded and found nothing', () => {
    expect(impactRationale({ specFiles: [], fullSuite: false, error: null })).toEqual([]);
  });

  it('lists the resolved spec files with a count', () => {
    const lines = impactRationale({
      specFiles: ['qa/e2e/tests/apps/minicrm/functional/i18n/i18n.spec.ts'],
      fullSuite: false,
      error: null,
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('Impact-resolved 1 spec file(s)');
    expect(lines[0]).toContain('i18n.spec.ts');
  });
});
