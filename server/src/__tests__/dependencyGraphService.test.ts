/**
 * Tests for dependencyGraphService.
 *
 * Pure logic (a deterministic rule table over file paths) — no DB or git
 * repo needed, unlike its sibling diffParser/changeUnitResolver suites.
 */

import {
  resolveDependencyWidening,
  resolveDependencyWideningForFiles,
  anyAlwaysWiden,
} from '../coverageAgent/testSelection/dependencyGraphService.js';

describe('resolveDependencyWidening', () => {
  it('flags a db migration as always-widen', () => {
    const result = resolveDependencyWidening('db/migrations/161_add_widget.js');
    expect(result.alwaysWiden).toBe(true);
    expect(result.matchedRuleIds).toContain('db-migration');
  });

  it('flags a qa migration as always-widen', () => {
    const result = resolveDependencyWidening('qa/migrations/002_add_index.js');
    expect(result.alwaysWiden).toBe(true);
    expect(result.matchedRuleIds).toContain('qa-migration');
  });

  it('flags a CI workflow file as always-widen', () => {
    const result = resolveDependencyWidening('.github/workflows/ci.yml');
    expect(result.alwaysWiden).toBe(true);
    expect(result.matchedRuleIds).toContain('ci-workflow');
  });

  it('flags docker-compose files as always-widen', () => {
    const result = resolveDependencyWidening('docker-compose.dev.yml');
    expect(result.alwaysWiden).toBe(true);
  });

  it('flags .env files as always-widen', () => {
    const result = resolveDependencyWidening('qa/e2e/.env');
    expect(result.alwaysWiden).toBe(true);
  });

  it('widens a shared schema change to functional scope, but does not force always-widen', () => {
    const result = resolveDependencyWidening('shared/schemas/dealSchema.ts');
    expect(result.alwaysWiden).toBe(false);
    expect(result.widenedTestScopes).toContain('functional:*');
  });

  it('widens an i18n locale change to only the i18n scope', () => {
    const result = resolveDependencyWidening('client/src/i18n/locales/en.json');
    expect(result.alwaysWiden).toBe(false);
    expect(result.widenedTestScopes).toEqual(['functional:i18n']);
  });

  it('returns no widening for a file matching no rule', () => {
    const result = resolveDependencyWidening('docs/README.md');
    expect(result.alwaysWiden).toBe(false);
    expect(result.widenedTestScopes).toEqual([]);
    expect(result.matchedRuleIds).toEqual([]);
  });

  it('unions test scopes when more than one rule matches a single path (deduplicated)', () => {
    // A feature-flag-seeding migration matches BOTH the general db-migration
    // rule and the more specific feature-flag-seed rule.
    const result = resolveDependencyWidening('db/migrations/162_add_feature_flag_row.js');
    expect(result.matchedRuleIds.length).toBeGreaterThan(1);
    expect(result.widenedTestScopes).toEqual(['functional:*']);
  });
});

describe('resolveDependencyWideningForFiles', () => {
  it('resolves each file independently', () => {
    const results = resolveDependencyWideningForFiles(['db/migrations/161_x.js', 'docs/README.md']);
    expect(results).toHaveLength(2);
    expect(results[0].alwaysWiden).toBe(true);
    expect(results[1].alwaysWiden).toBe(false);
  });
});

describe('anyAlwaysWiden', () => {
  it('is true when at least one result demands it', () => {
    const results = resolveDependencyWideningForFiles([
      'docs/README.md',
      '.github/workflows/ci.yml',
    ]);
    expect(anyAlwaysWiden(results)).toBe(true);
  });

  it('is false when no result demands it', () => {
    const results = resolveDependencyWideningForFiles(['docs/README.md', 'shared/schemas/x.ts']);
    expect(anyAlwaysWiden(results)).toBe(false);
  });

  it('is false for an empty result set', () => {
    expect(anyAlwaysWiden([])).toBe(false);
  });
});
