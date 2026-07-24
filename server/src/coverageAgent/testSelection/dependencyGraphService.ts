/**
 * Coverage/TIA config/infra dependency graph. (MINCRM-625)
 *
 * Handles the file changes changeUnitResolver.ts routes to
 * ChangeDetectionResult.nonSourceFileChanges — config, resource, and
 * migration files with no function/unit identity of their own, so they
 * can never be resolved via the mapping query API the way source-code
 * changes are.
 *
 * Explicitly a deterministic rule table, not ML, per MINCRM-625's own AC —
 * each rule maps a glob over the changed file's path to either a widened
 * set of test-scope tags to union into selection, or a "trust nothing,
 * always widen to the full suite" flag for file classes whose blast radius
 * is too broad/unpredictable for any targeted rule to safely bound (schema
 * migrations, CI workflow definitions, and feature-flag rows themselves).
 *
 * Rules are evaluated independently per file and their results are always
 * UNIONED, never subtracted — MINCRM-625's AC is "widen selection", so a
 * config file with no matching rule simply contributes nothing rather than
 * narrowing anything Phase 2's mapping-based selection already found.
 */

/** A widened selection outcome contributed by one non-source file's change. */
export interface DependencyWideningResult {
  filePath: string;
  /** Test-scope tags this file's change widens selection to (e.g. spec-file glob tags, domain names) — empty when only alwaysWiden fired. */
  widenedTestScopes: string[];
  /** True when this file class is untrusted for targeted widening — callers must fall back to the full suite regardless of what widenedTestScopes contains. */
  alwaysWiden: boolean;
  /** Which rule(s) matched, for audit/debugging. */
  matchedRuleIds: string[];
}

interface DependencyRule {
  id: string;
  pattern: RegExp;
  testScopes: readonly string[];
  /** True for file classes whose full impact can't be safely bounded by testScopes alone. */
  alwaysWiden: boolean;
}

/**
 * The rule table itself. Order doesn't matter — every rule is evaluated
 * against every changed file, and matches are unioned (see module
 * docblock), so overlapping rules simply both contribute rather than
 * shadowing one another.
 */
const DEPENDENCY_RULES: readonly DependencyRule[] = [
  {
    id: 'db-migration',
    pattern: /(^|\/)db\/migrations\//,
    testScopes: ['functional:*'],
    // A schema change can affect any query anywhere — no targeted testScopes
    // list can safely bound this, so the full functional suite is the only
    // sound fallback (mirrors coverageReconciliationService's own "schema
    // changes widen, don't narrow" precedent for coverage_units itself).
    alwaysWiden: true,
  },
  {
    id: 'qa-migration',
    pattern: /(^|\/)qa\/migrations\//,
    testScopes: ['functional:*'],
    alwaysWiden: true,
  },
  {
    id: 'feature-flag-seed',
    pattern: /(^|\/)db\/migrations\/.*feature_flag/i,
    testScopes: ['functional:*'],
    alwaysWiden: true,
  },
  {
    id: 'ci-workflow',
    pattern: /(^|\/)\.github\/workflows\//,
    testScopes: ['functional:*'],
    // CI workflow files change how/whether tests even run — their effect
    // is on the test harness itself, not on any single test's coverage
    // relationship, so no targeted scope is meaningful here either.
    alwaysWiden: true,
  },
  {
    id: 'docker-compose',
    pattern: /(^|\/)docker-compose(\.[\w-]+)?\.ya?ml$/,
    testScopes: ['functional:*'],
    alwaysWiden: true,
  },
  {
    id: 'env-config',
    pattern: /\.env(\.[\w-]+)?$/,
    testScopes: ['functional:*'],
    alwaysWiden: true,
  },
  {
    id: 'shared-schema',
    pattern: /(^|\/)shared\/schemas\//,
    // Zod schemas are shared client+server validation contracts — widen to
    // both sides' functional coverage rather than guessing which consumer
    // is affected, since a single schema commonly backs several unrelated
    // endpoints/pages.
    testScopes: ['functional:*'],
    alwaysWiden: false,
  },
  {
    id: 'i18n-locale',
    pattern: /(^|\/)client\/src\/i18n\/locales\//,
    testScopes: ['functional:i18n'],
    alwaysWiden: false,
  },
];

/**
 * Resolves a single non-source file's change against the dependency rule
 * table.
 */
export function resolveDependencyWidening(filePath: string): DependencyWideningResult {
  const matched = DEPENDENCY_RULES.filter((rule) => rule.pattern.test(filePath));

  return {
    filePath,
    widenedTestScopes: Array.from(new Set(matched.flatMap((rule) => rule.testScopes))),
    alwaysWiden: matched.some((rule) => rule.alwaysWiden),
    matchedRuleIds: matched.map((rule) => rule.id),
  };
}

/**
 * Resolves a batch of non-source file changes (typically
 * ChangeDetectionResult.nonSourceFileChanges' own filePaths) and unions
 * their widening results.
 */
export function resolveDependencyWideningForFiles(
  filePaths: readonly string[],
): DependencyWideningResult[] {
  return filePaths.map(resolveDependencyWidening);
}

/**
 * True if ANY of the given widening results demand an unconditional
 * full-suite fallback — the single boolean callers (the safety-net policy,
 * MINCRM-626) need to decide whether targeted testScopes can be trusted at
 * all for this diff.
 */
export function anyAlwaysWiden(results: readonly DependencyWideningResult[]): boolean {
  return results.some((result) => result.alwaysWiden);
}
