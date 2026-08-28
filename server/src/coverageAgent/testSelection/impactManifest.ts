/**
 * Source-path impact manifest — the declared edge from a source path class to
 * the test scopes a change there can affect.
 *
 * Answers the question selection actually asks: "X changed, what must run?".
 * The CODEOWNERS-shaped pattern, because this repo has no build graph that
 * could infer the edge — the workspaces are deliberately separate build graphs
 * and nothing links a schema file to the specs exercising it.
 *
 * Deliberately NOT derived from the coverage map. Specs that never instantiate
 * the `page` fixture emit no coverage at all, so deriving scope membership from
 * observed coverage would make exactly the specs guarding unmapped behavior
 * invisible to selection. A human must be able to assert an edge the runtime
 * never observed.
 *
 * Two lists, both load-bearing. COVERED maps a glob to the scopes it impacts.
 * DECLARED_UNCOVERED names path classes with no E2E impact, so the coverage
 * guard can tell "nobody mapped this yet" from "this genuinely affects no
 * test" — without it every docs change would read as an unmapped class.
 */

import { globToRegExp } from './specGlob.js';

/** Resolves to the full-suite decision, never to an enumerated file list. */
export const ALL_FUNCTIONAL_SCOPE = 'functional:*';

/** One manifest entry: a source glob and the scopes a change under it impacts. */
export interface ImpactManifestEntry {
  glob: string;
  scopes: readonly string[];
}

/**
 * Source globs to the scopes they impact.
 *
 * Every scope any DEPENDENCY_RULES entry emits must appear here, so a rule can
 * never name a scope with no declared membership.
 */
export const COVERED_PATHS: readonly ImpactManifestEntry[] = [
  { glob: 'db/migrations/**', scopes: [ALL_FUNCTIONAL_SCOPE] },
  { glob: 'qa/migrations/**', scopes: [ALL_FUNCTIONAL_SCOPE] },
  { glob: '.github/workflows/**', scopes: [ALL_FUNCTIONAL_SCOPE] },
  { glob: '**/docker-compose*.yml', scopes: [ALL_FUNCTIONAL_SCOPE] },
  // Matches .env, .env.example and .env.<variant>.example alike — the shape the
  // env-config rule's own regex accepts. A glob missing .env.test.example would
  // narrow selection for it, which is the silent gap this manifest removes.
  { glob: '**/.env*', scopes: [ALL_FUNCTIONAL_SCOPE] },
  // A single Zod schema commonly backs several unrelated endpoints and pages —
  // capabilitySchema and featureFlagSchema back behavior in every domain — so
  // no honest per-domain list exists for the directory as a whole. Narrowing
  // this would also violate ADR-003's widen-only invariant.
  { glob: 'shared/schemas/**', scopes: [ALL_FUNCTIONAL_SCOPE] },
  { glob: 'client/src/locales/**', scopes: ['functional:i18n'] },
  { glob: 'server/src/**', scopes: [ALL_FUNCTIONAL_SCOPE] },
  { glob: 'client/src/**', scopes: [ALL_FUNCTIONAL_SCOPE] },
  { glob: 'shared/**', scopes: [ALL_FUNCTIONAL_SCOPE] },
  { glob: 'qa/e2e/**', scopes: [ALL_FUNCTIONAL_SCOPE] },
  { glob: 'qa/scripts/**', scopes: [ALL_FUNCTIONAL_SCOPE] },
  { glob: 'scripts/**', scopes: [ALL_FUNCTIONAL_SCOPE] },
  // Build and serving inputs: these decide what the E2E stack actually runs, so
  // a change here can break every spec without touching a line of app source.
  { glob: '**/Dockerfile', scopes: [ALL_FUNCTIONAL_SCOPE] },
  { glob: 'client/index.html', scopes: [ALL_FUNCTIONAL_SCOPE] },
  { glob: 'client/nginx.conf', scopes: [ALL_FUNCTIONAL_SCOPE] },
  { glob: '.github/actions/**', scopes: [ALL_FUNCTIONAL_SCOPE] },
  { glob: '.github/scripts/**', scopes: [ALL_FUNCTIONAL_SCOPE] },
  // Dependency and compiler configuration — a version or path change here
  // reaches every workspace the suite exercises.
  { glob: '**/package.json', scopes: [ALL_FUNCTIONAL_SCOPE] },
  { glob: '**/package-lock.json', scopes: [ALL_FUNCTIONAL_SCOPE] },
  { glob: '**/tsconfig*.json', scopes: [ALL_FUNCTIONAL_SCOPE] },
  { glob: 'client/vite.config.ts', scopes: [ALL_FUNCTIONAL_SCOPE] },
  { glob: '**/postcss.config.cjs', scopes: [ALL_FUNCTIONAL_SCOPE] },
  { glob: '**/tailwind.config.cjs', scopes: [ALL_FUNCTIONAL_SCOPE] },
];

/**
 * Path classes that impact no E2E test, each with the reason it cannot.
 *
 * An entry here is a claim as strong as a COVERED_PATHS entry and is why the
 * guard stays quiet on a docs-only PR. Adding one to silence the guard for a
 * path that does affect tests reintroduces exactly the blindness the guard
 * exists to report, so each carries the reason it holds.
 */
export const DECLARED_UNCOVERED_PATHS: readonly string[] = [
  // Prose only. Rendered by no app surface any spec drives. Listed per tree
  // rather than as a repo-wide **/*.md so each claim is visible at its site.
  'docs/**',
  '*.md',
  'qa/e2e/**/*.md',
  'qa/scripts/**/*.md',
  'server/src/**/*.md',
  // A separate Vite app with its own suite; no functional spec loads it.
  'coverage-dashboard/**',
  // Agent instructions and gates — read by tooling, never by the app.
  '.claude/**',
  '.husky/**',
  // Formatter, linter, and editor configuration. A behavior change here fails
  // lint rather than a functional spec.
  '.prettierrc',
  '.prettierignore',
  '.markdownlint.json',
  '.markdownlintignore',
  '.claudeignore',
  '.dockerignore',
  '.gitignore',
  '.nvmrc',
  'eslint.config.mjs',
  'eslint-plugins/**',
  '.tbls.yml',
  'LICENSE',
  'buf.gen.yaml',
  // Identity-provider fixture for local SSO only; never reached in E2E.
  'dex/**',
  // Linter/reporter configuration for CI itself, not for the app under test.
  '.github/actionlint.yaml',
  'server/redocly.yaml',
  'server/vitest.config.ts',
  // The AI eval suite runs on its own promptfoo harness, never in Playwright.
  'qa/evals/**',
  // Generated artifacts, rewritten by tooling rather than edited.
  'qa/coverage-map.jsonl',
  'qa/test-results/**',
];

const COVERED_MATCHERS = COVERED_PATHS.map((entry) => ({
  matcher: globToRegExp(entry.glob),
  entry,
}));

const UNCOVERED_MATCHERS = DECLARED_UNCOVERED_PATHS.map(globToRegExp);

/**
 * The scopes the covered globs alone give this path, BEFORE the uncovered
 * subtraction.
 *
 * Exported so a test can ask whether the two lists disagree about a real path:
 * scopesForPath applies the subtraction, which makes "covered and uncovered"
 * unsatisfiable and any test built on it vacuous.
 */
export function coveredScopesForPath(filePath: string): string[] {
  const normalized = filePath.replace(/\\/g, '/');
  const scopes = COVERED_MATCHERS.filter(({ matcher }) => matcher.test(normalized)).flatMap(
    ({ entry }) => entry.scopes,
  );
  return Array.from(new Set(scopes));
}

/**
 * Every scope the manifest defines, for validating that a rule's scope exists.
 */
export function declaredScopes(): Set<string> {
  return new Set(COVERED_PATHS.flatMap((entry) => entry.scopes));
}

/**
 * The scopes a change to this path impacts, unioned across every matching
 * entry and deduplicated.
 *
 * Entries overlap by design — `shared/schemas/**` and `shared/**` both match a
 * schema file — and overlapping matches union rather than the most specific
 * winning, matching the rule table's own widen-only semantics.
 */
export function scopesForPath(filePath: string): string[] {
  const normalized = filePath.replace(/\\/g, '/');
  // A declared-uncovered path impacts nothing even when a broader covered glob
  // also matches it, so the two lists can never give contradictory answers:
  // README.md inside a covered source tree is documentation, not source.
  if (isDeclaredUncovered(normalized)) return [];
  return coveredScopesForPath(normalized);
}

/** True when the path is declared as impacting no E2E test. */
export function isDeclaredUncovered(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  return UNCOVERED_MATCHERS.some((matcher) => matcher.test(normalized));
}

/**
 * True when the manifest says nothing about this path at all — neither an
 * impact nor a declaration that it has none.
 *
 * This is what the coverage guard reports: a path class nobody mapped selects
 * nothing, silently, which is the failure mode tier 2 exists to remove.
 */
export function isUnmapped(filePath: string): boolean {
  return scopesForPath(filePath).length === 0 && !isDeclaredUncovered(filePath);
}
