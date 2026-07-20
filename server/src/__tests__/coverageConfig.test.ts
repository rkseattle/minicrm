/**
 * Unit tests for coverageConfig. (MINCRM-604, MINCRM-607)
 *
 * Covers env-var precedence for commit SHA resolution, granularity parsing,
 * and the enabled-by-default-off gate.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveCoverageConfig } from '../coverageAgent/coverageConfig.js';

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  delete process.env.COVERAGE_INSTRUMENTATION;
  delete process.env.COVERAGE_GRANULARITY;
  delete process.env.GIT_COMMIT_SHA;
  delete process.env.GITHUB_SHA;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
});

describe('resolveCoverageConfig', () => {
  it('defaults enabled to false when COVERAGE_INSTRUMENTATION is unset', () => {
    expect(resolveCoverageConfig().enabled).toBe(false);
  });

  it('enables only when COVERAGE_INSTRUMENTATION is exactly "true"', () => {
    process.env.COVERAGE_INSTRUMENTATION = 'yes';
    expect(resolveCoverageConfig().enabled).toBe(false);

    process.env.COVERAGE_INSTRUMENTATION = 'true';
    expect(resolveCoverageConfig().enabled).toBe(true);
  });

  it('defaults granularity to block', () => {
    expect(resolveCoverageConfig().granularity).toBe('block');
  });

  it('parses COVERAGE_GRANULARITY=function explicitly, else falls back to block', () => {
    process.env.COVERAGE_GRANULARITY = 'function';
    expect(resolveCoverageConfig().granularity).toBe('function');

    process.env.COVERAGE_GRANULARITY = 'bogus';
    expect(resolveCoverageConfig().granularity).toBe('block');
  });

  it('prefers GIT_COMMIT_SHA over GITHUB_SHA', () => {
    process.env.GIT_COMMIT_SHA = 'from-git-commit-sha';
    process.env.GITHUB_SHA = 'from-github-sha';
    expect(resolveCoverageConfig().commitSha).toBe('from-git-commit-sha');
  });

  it('falls back to GITHUB_SHA when GIT_COMMIT_SHA is unset', () => {
    process.env.GITHUB_SHA = 'from-github-sha';
    expect(resolveCoverageConfig().commitSha).toBe('from-github-sha');
  });

  it('falls back to git rev-parse HEAD when no env var is set', () => {
    // We're running inside a real git repo, so this should resolve to a
    // real-looking SHA rather than throwing or returning 'unknown'.
    const { commitSha } = resolveCoverageConfig();
    expect(commitSha).toMatch(/^[0-9a-f]{40}$/);
  });

  it('rejects a GIT_COMMIT_SHA containing path traversal, falling back to unknown', () => {
    // Regression test: commitSha is used verbatim as a directory segment
    // under COVERAGE_DUMPS_ROOT (NodeV8CoverageAgent.persist /
    // coverageDumpService.ingestBrowserCoverage). An unsanitized value here
    // could move dump writes outside the intended dumps root.
    process.env.GIT_COMMIT_SHA = '../../tmp/evil';
    expect(resolveCoverageConfig().commitSha).toBe('unknown');
  });

  it('rejects a GIT_COMMIT_SHA containing a path separator even without traversal', () => {
    process.env.GIT_COMMIT_SHA = 'abc/def';
    expect(resolveCoverageConfig().commitSha).toBe('unknown');
  });

  it('accepts a GIT_COMMIT_SHA containing only safe filename characters', () => {
    process.env.GIT_COMMIT_SHA = 'a1b2c3d4.feature-branch_v2';
    expect(resolveCoverageConfig().commitSha).toBe('a1b2c3d4.feature-branch_v2');
  });
});
