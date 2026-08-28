/**
 * Tests for impactManifest.
 *
 * Pure logic over path strings, with one deliberate exception: the locale
 * assertion reads the real directory off disk, because the manifest's whole
 * job is to name paths that actually exist.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEPENDENCY_RULE_TEST_SCOPES } from '../coverageAgent/testSelection/dependencyGraphService.js';
import { globToRegExp } from '../coverageAgent/testSelection/specGlob.js';
import {
  ALL_FUNCTIONAL_SCOPE,
  COVERED_PATHS,
  DECLARED_UNCOVERED_PATHS,
  coveredScopesForPath,
  declaredScopes,
  isDeclaredUncovered,
  isUnmapped,
  scopesForPath,
} from '../coverageAgent/testSelection/impactManifest.js';

/** Walks up to the directory holding `marker`, so moving this file fails an assertion rather than throwing ENOENT. */
function repoRootContaining(marker: string): string {
  let candidate = dirname(fileURLToPath(import.meta.url));
  while (!existsSync(resolve(candidate, marker))) {
    const parent = dirname(candidate);
    if (parent === candidate) throw new Error(`no ancestor directory contains ${marker}`);
    candidate = parent;
  }
  return candidate;
}

/** Every scope the live rule table emits, deduplicated. */
function ruleTestScopes(): string[] {
  return Array.from(new Set(DEPENDENCY_RULE_TEST_SCOPES));
}

/** Every tracked path, so the manifest is asserted against the real repo rather than a corpus that drifts from it. */
function trackedFiles(): string[] {
  const repoRoot = repoRootContaining('.git');
  return execFileSync('git', ['ls-files'], { cwd: repoRoot, encoding: 'utf8' })
    .trim()
    .split('\n')
    .filter(Boolean);
}

describe('manifest table shape', () => {
  it('gives every covered entry at least one scope', () => {
    for (const entry of COVERED_PATHS) {
      expect(entry.scopes.length).toBeGreaterThan(0);
    }
  });

  // Overlap is deliberate: a broad glob like **/package.json reaches inside a
  // tree declared uncovered, and the subtraction resolves it. What must never
  // happen is an overlap NO uncovered entry accounts for, so each overlapping
  // path must be named by some uncovered glob. Asked of coveredScopesForPath,
  // not scopesForPath: the latter subtracts, making the question unanswerable.
  it('suppresses a covered path only when an uncovered entry names it', () => {
    // Every path the subtraction silences must be named by an uncovered glob.
    // Asked of coveredScopesForPath, since scopesForPath applies the very
    // subtraction under test and would make the question unanswerable.
    const uncoveredMatchers = DECLARED_UNCOVERED_PATHS.map(globToRegExp);
    const suppressed = trackedFiles().filter(
      (file) => coveredScopesForPath(file).length > 0 && scopesForPath(file).length === 0,
    );
    expect(suppressed.length).toBeGreaterThan(0);

    const unaccounted = suppressed.filter(
      (file) => !uncoveredMatchers.some((matcher) => matcher.test(file)),
    );
    expect(unaccounted).toEqual([]);
  });

  // A glob matching nothing is a claim about a path class that does not exist —
  // the stale-glob failure check-ci-filter-globs.mjs exists for, in a second table.
  it('matches at least one tracked file from every declared glob', () => {
    const files = trackedFiles();
    const dead = [...COVERED_PATHS.map((entry) => entry.glob), ...DECLARED_UNCOVERED_PATHS].filter(
      (glob) => !files.some((file) => globToRegExp(glob).test(file)),
    );
    expect(dead).toEqual([]);
  });

  // The docblock's central claim: a rule can never emit a scope the manifest does
  // not declare. Asserted against the live rule table, not two hardcoded literals.
  it('declares every scope the dependency rules emit', () => {
    const declared = declaredScopes();
    const undeclared = ruleTestScopes().filter((scope) => !declared.has(scope));
    expect(undeclared).toEqual([]);
  });

  it('exposes the scopes the covered entries actually use', () => {
    const scopes = declaredScopes();
    expect(scopes.has(ALL_FUNCTIONAL_SCOPE)).toBe(true);
    expect(scopes.has('functional:i18n')).toBe(true);
  });
});

describe('scopesForPath', () => {
  it('maps a db migration to the full functional scope', () => {
    expect(scopesForPath('db/migrations/161_add_widget.js')).toContain(ALL_FUNCTIONAL_SCOPE);
  });

  it('maps a qa migration to the full functional scope', () => {
    expect(scopesForPath('qa/migrations/002_add_index.js')).toContain(ALL_FUNCTIONAL_SCOPE);
  });

  it('maps a locale file to the i18n scope', () => {
    expect(scopesForPath('client/src/locales/en.json')).toContain('functional:i18n');
  });

  it('maps a shared schema to the full functional scope', () => {
    expect(scopesForPath('shared/schemas/dealSchema.ts')).toContain(ALL_FUNCTIONAL_SCOPE);
  });

  it('maps an env template to the full functional scope', () => {
    expect(scopesForPath('qa/e2e/.env.example')).toContain(ALL_FUNCTIONAL_SCOPE);
  });

  it('deduplicates scopes when equally specific entries match one path', () => {
    expect(scopesForPath('shared/schemas/dealSchema.ts')).toEqual([ALL_FUNCTIONAL_SCOPE]);
  });

  // The ticket's headline case: client/src/** also matches a locale file, and a
  // union would resolve a locale-only change to the entire suite.
  it('lets the most specific entry win over a broader one containing it', () => {
    expect(scopesForPath('client/src/locales/en.json')).toEqual(['functional:i18n']);
    expect(scopesForPath('client/src/pages/DealsPage.tsx')).toEqual([ALL_FUNCTIONAL_SCOPE]);
  });

  // Two entries that merely intersect must both contribute: a filename pattern
  // and a directory tree share no literal prefix, so neither is the narrower
  // answer and picking one by length would discard the other's scopes.
  it('unions entries that overlap without one containing the other', () => {
    expect(coveredScopesForPath('qa/e2e/package.json')).toEqual([ALL_FUNCTIONAL_SCOPE]);
    const matching = COVERED_PATHS.filter((entry) =>
      globToRegExp(entry.glob).test('qa/e2e/package.json'),
    );
    expect(matching.length).toBeGreaterThan(1);
  });

  it('returns nothing for a path no entry covers', () => {
    expect(scopesForPath('docs/dev/coverage.md')).toEqual([]);
  });

  it('normalizes Windows separators before matching', () => {
    expect(scopesForPath('client\\src\\locales\\en.json')).toContain('functional:i18n');
  });

  it('matches a trailing double-star at every depth', () => {
    expect(scopesForPath('server/src/x.ts')).toContain(ALL_FUNCTIONAL_SCOPE);
    expect(scopesForPath('server/src/a/b/c/deep.ts')).toContain(ALL_FUNCTIONAL_SCOPE);
  });

  it('matches a compose file at any depth, as the rule does', () => {
    expect(scopesForPath('docker-compose.yml')).toContain(ALL_FUNCTIONAL_SCOPE);
    expect(scopesForPath('docker-compose.dev.yml')).toContain(ALL_FUNCTIONAL_SCOPE);
    expect(scopesForPath('nested/docker-compose.dev.yml')).toContain(ALL_FUNCTIONAL_SCOPE);
  });
});

describe('isDeclaredUncovered', () => {
  // The case the subtraction exists for: **/package.json covers it, yet the
  // dashboard is a separate app no functional spec loads.
  it('subtracts a config file living inside a covered-by-glob uncovered tree', () => {
    expect(coveredScopesForPath('coverage-dashboard/package.json').length).toBeGreaterThan(0);
    expect(isDeclaredUncovered('coverage-dashboard/package.json')).toBe(true);
    expect(scopesForPath('coverage-dashboard/package.json')).toEqual([]);
  });

  it('does not declare a server source file uncovered', () => {
    expect(isDeclaredUncovered('server/src/services/dealService.ts')).toBe(false);
  });
});

describe('isUnmapped', () => {
  it('reports a path the manifest says nothing about', () => {
    expect(isUnmapped('newtoplevel/thing.ts')).toBe(true);
  });

  it('does not report a covered path', () => {
    expect(isUnmapped('server/src/services/dealService.ts')).toBe(false);
  });

  it('does not report a declared-uncovered path', () => {
    expect(isUnmapped('docs/dev/coverage.md')).toBe(false);
  });
});

// Silent unless client/src/locales/** and this file's own module stay in ci.yml's
// locale-paths filter: `server` is server/src/** only, so a directory move would
// skip server-tests entirely and the manifest would go on naming a dead path.
describe('locale directory', () => {
  it('covers the directory that actually holds the locale files', () => {
    const localeDir = 'client/src/locales';
    const repoRoot = repoRootContaining(localeDir);
    const localeFiles = readdirSync(resolve(repoRoot, localeDir));
    expect(localeFiles).toContain('en.json');

    for (const localeFile of localeFiles.filter((name) => name.endsWith('.json'))) {
      expect(scopesForPath(`${localeDir}/${localeFile}`)).toContain('functional:i18n');
    }
  });
});
