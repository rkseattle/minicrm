/**
 * select-tests.ts — Shared Test Impact Analysis selection CLI. (pr-tia-8)
 *
 * The ONE place that drives the full change-to-test selection pipeline
 * (diffParser -> changeUnitResolver -> testSelectionService ->
 * dependencyGraphService -> safetyNetPolicy, see docs/adr/003-test-impact-
 * analysis-selection.md) end to end and resolves its output to a concrete
 * list of spec files CI/local tooling can actually run. the CI
 * select-mode job and the local pre-push hook both invoke this
 * SAME script with the SAME config — the "no divergence between local and
 * CI selection" AC both tickets require is satisfied by construction (one
 * code path), not by convention (two hand-synced implementations).
 *
 * What this script adds on top of the selection pipeline itself:
 *  - Resolves each FinalSelectedTest's testId to a spec file path via
 *    coverageMappingService.findUnitsForTest — the selection pipeline
 *    itself only ever deals in testId, never file paths.
 *  - Emits a single JSON result to stdout so callers (a CI step, the
 *    pre-push hook, gen-shards.ts) can consume it without re-implementing
 *    any selection logic of their own.
 *  - Prints the human-readable selection rationale to stderr — 's
 *    "emits selection rationale into the build log/PR" AC — keeping stdout
 *    reserved for the single JSON payload.
 *
 * commitSha used for mapping-query lookups is baseRef's own resolved SHA,
 * NOT headRef's: the mapping engine only has coverage_test_links data for
 * commits that have actually been tested/ingested, which for an in-flight
 * PR is the merge-base/base branch tip, never the PR's own uncommitted-to-
 * main head. Post-merge/nightly record-mode runs (forceFullSuite) don't
 * reach the mapping-query step at all, so this choice is moot for them.
 *
 * Usage (from server/, or `npm run select:tests --workspace=minicrm-server --silent --`
 * from repo root — `--silent` suppresses npm's own banner lines, which
 * would otherwise land on stdout ahead of the JSON payload):
 *   LOG_DESTINATION=stderr tsx src/scripts/select-tests.ts --base=origin/main --head=HEAD
 *   LOG_DESTINATION=stderr tsx src/scripts/select-tests.ts --base=origin/main --head=HEAD --force-full-suite
 *
 * LOG_DESTINATION=stderr is required, not optional: the shared app logger
 * (logger.ts) defaults to stdout (Docker log-capture convention), which
 * would otherwise interleave log lines into this script's stdout JSON
 * contract. The select:tests npm script sets it automatically.
 *
 * Required environment variables: COVERAGE_DB_* (or DB_* fallback, see
 * coverageDb.ts) to reach the coverage database's mapping tables.
 */

import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { parseGitDiff, assertSafeGitRef } from '../coverageAgent/testSelection/diffParser.js';
import { resolveChangedUnits } from '../coverageAgent/testSelection/changeUnitResolver.js';
import { selectTestsForChangedUnits } from '../coverageAgent/testSelection/testSelectionService.js';
import { resolveDependencyWideningForFiles } from '../coverageAgent/testSelection/dependencyGraphService.js';
import { globToRegExp } from '../coverageAgent/testSelection/specGlob.js';
import { resolveImpactedSpecs } from '../coverageAgent/testSelection/impactResolver.js';
import {
  applySafetyNetPolicy,
  type FinalSelectedTest,
  type FinalSelectionResult,
} from '../coverageAgent/testSelection/safetyNetPolicy.js';
import { findUnitsForTest } from '../services/coverageMappingService.js';
import coverageDb from '../coverageDb.js';
import { resolveCoveragePolicy } from '../coverageAgent/coveragePolicyConfig.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolvePath(__dirname, '../../..');

/** Same bounded-concurrency ceiling testSelectionService.ts itself uses — coverageDb's pool caps at 10 connections (see coverageDb.ts). */
const MAX_CONCURRENT_FILE_LOOKUPS = 5;

// ── Always-run baseline (smoke/critical paths) ────────────────────────────
//
// A minimal, deliberately small starter set — the safety net unions
// this in unconditionally regardless of what the diff itself maps to.
// Expressed as spec file GLOBS (not testIds, which only exist after a test
// has actually run and been attributed) since the baseline must resolve to
// runnable files even when the mapping database has no data for them yet.
// Just auth/ — @smoke tests are individual tests distributed across domain
// suites (CLAUDE.md), not a separate smoke/ directory, so a smoke/**
// glob would never match anything; the baseline can't target them by path.
const ALWAYS_RUN_BASELINE_GLOBS: readonly string[] = [
  'tests/apps/minicrm/functional/auth/**/*.spec.ts',
];

export interface SelectTestsResult {
  mode: 'targeted' | 'full-suite';
  /** Spec file paths (relative to repo root) to run — empty for 'full-suite' (callers run everything). */
  specFiles: string[];
  /** Baseline/selected files whose owning test could not be resolved to a spec file (e.g. attributed before migration 003, or never attributed at all) — surfaced so callers can decide to widen rather than silently under-select. */
  unresolvedTestIds: string[];
  fallbackReasons: FinalSelectionResult['fallbackReasons'];
  /**
   * Spec files TIA tier 2 derived from the impact manifest, spec-declared
   * `impacts` annotations, and the directory convention.
   *
   * Also unioned into specFiles; kept as its own field so a reader can tell
   * which producer contributed a file, which is the audit question the mode
   * and reason labels exist to answer elsewhere.
   */
  scopeResolvedSpecFiles: string[];
  /**
   * Why impact resolution produced nothing, when it failed rather than finding
   * nothing to resolve.
   *
   * A machine-readable field, not just a rationale line: an unmapped path class
   * and a clean diff both yield an empty scopeResolvedSpecFiles, and a consumer
   * that cannot tell them apart is the silent-empty-selection failure again.
   * Null when resolution succeeded.
   */
  impactResolutionError: string | null;
  rationale: string[];
  baseSha: string;
  headSha: string;
}

interface CliArgs {
  baseRef: string;
  headRef: string;
  forceFullSuite: boolean;
}

/**
 * Exported for direct unit testing.
 *
 * The `=`-preserving split below is a correctness property, not a style choice:
 * a truncated ref is a DIFFERENT ref, which resolveShaForRef may resolve
 * successfully, silently narrowing the selected test set. That is the largest
 * blast radius of the four sites carrying this idiom, and it was the last one
 * left unpinned — a revert to `.split('=')[1]` passed the entire suite.
 *
 * The env-var fallback chains are covered too, because they interact with the
 * split: both forms yield '' for a bare `--base=`, and '' is not nullish, so
 * `??` keeps it rather than falling through. That is unchanged by this fix and
 * worth pinning so it stays that way.
 */
export function parseArgs(argv: readonly string[]): CliArgs {
  const baseArg = argv.find((a) => a.startsWith('--base='));
  const headArg = argv.find((a) => a.startsWith('--head='));
  const forceFullSuite = argv.includes('--force-full-suite');

  // .slice(1).join('=') rather than [1], so a ref containing '=' survives —
  // `git check-ref-format 'refs/heads/foo=bar'` exits 0, and assertSafeGitRef
  // rejects only a leading '-'. Truncating yields a DIFFERENT ref, which
  // resolveShaForRef either misresolves or throws on, and parseGitDiff then
  // diffs the wrong range — narrowing the selection. The `?? ` fallback chain is
  // unaffected: both forms yield '' for a bare `--base=`, which is not nullish.
  const baseRef =
    baseArg?.split('=').slice(1).join('=') ?? process.env.GITHUB_BASE_REF ?? 'origin/main';

  // Caller audit. The GIT_COMMIT_SHA/GITHUB_SHA links in this
  // chain are UNREACHABLE from every committed caller — all three pass
  // --head= explicitly:
  //   - .github/workflows/ci.yml, the `tia-selection` job's "Run TIA selection"
  //     step            --head=<github.event.pull_request.head.sha>
  //   - scripts/pre-push-tia.ts, runSelectTests()   --head=HEAD
  //   - server/package.json's `select:tests`        pass-through wrapper, no
  //                                                 args of its own
  // They are retained only for ad-hoc invocation, and deliberately NOT
  // hardened the way verify-test-attestation.ts's parseArgs hard-requires
  // --sha.
  //
  // Cited by step/function name rather than line number on purpose: the first
  // version of this comment carried three line references that were already
  // stale when it was committed, since adding the comment shifted the file it
  // pointed into and the CI workflow had moved independently.
  //
  // The asymmetry is intentional and worth stating, because the two scripts
  // look similar. That one is the GATE: it decides whether a push or a CI run
  // is allowed to claim its tests ran, so a defaulted SHA there would let an
  // unverifiable claim pass as attested. This one is ADVISORY — its CI job is
  // continue-on-error (the `tia-selection` job), and a wrong headRef cannot
  // mis-attribute
  // anything, because the mapping lookups it drives are keyed on baseSha
  // (selectTestsForChangedUnits, resolveTestFiles), never on headSha.
  //
  // What a wrong headRef CAN do is change the computed diff — it is passed to
  // parseGitDiff and resolveChangedUnits — and so widen or NARROW the selected
  // set. Narrowing means tests that should have run do not, which is why the
  // caller's safety net falls back to the full suite rather than trusting a
  // thin selection.
  //
  // Call sites named rather than cited by line: same-file line references rot
  // on the next edit to this file — including the one that added this comment.
  // Same `=`-preserving split as baseRef above, for the same reason.
  const headRef =
    headArg?.split('=').slice(1).join('=') ??
    process.env.GIT_COMMIT_SHA ??
    process.env.GITHUB_SHA ??
    'HEAD';

  return { baseRef, headRef, forceFullSuite };
}

/** Resolves a ref to its full 40-char commit SHA — coverage_test_links is keyed by exact SHA, not a symbolic ref. */
function resolveShaForRef(ref: string, cwd: string): string {
  assertSafeGitRef(ref);
  return execFileSync('git', ['rev-parse', ref], { cwd, encoding: 'utf8' }).trim();
}

/**
 * Resolves the always-run baseline globs against the functional spec
 * directory on disk, so the baseline is real files, not unverified globs.
 * Returned paths are relative to the REPO ROOT (e.g.
 * `qa/e2e/tests/apps/minicrm/functional/auth/login.spec.ts`) — the same
 * convention testInfo.file capture (fixtures.ts), discoverSpecFiles
 * (timing-utils.ts), and gen-shards.ts/gen-shard-config.ts's own
 * --selected-files all use, so this output can feed either directly with
 * no further path translation. ALWAYS_RUN_BASELINE_GLOBS above is
 * qa/e2e/-relative purely for readability (shorter, matches how a
 * developer would type a Playwright testMatch glob); the repo-root prefix
 * is added back here, not stripped.
 *
 * Deliberately reuses no code from
 * qa/e2e/framework/reporting/timing-utils.ts's discoverSpecFiles — that
 * module lives in the qa workspace, unreachable from server/src (see
 * qa/tsconfig.json's own paths, which have no route into server/src
 * either) — the two workspaces intentionally don't share a build graph. A
 * second, small directory walk here is the more honest trade-off than
 * adding a cross-workspace dependency for ~15 lines.
 */
export function resolveBaselineFiles(cwd: string): string[] {
  const functionalDir = resolvePath(cwd, 'qa/e2e/tests/apps/minicrm/functional');
  const matchers = ALWAYS_RUN_BASELINE_GLOBS.map(globToRegExp);
  const results: string[] = [];

  function walk(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = resolvePath(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && entry.name.endsWith('.spec.ts')) {
        const relativeToRepoRoot = full.slice(cwd.length + 1).replace(/\\/g, '/');
        const relativeToQa = relativeToRepoRoot.replace(/^qa\/e2e\//, '');
        if (matchers.some((matcher) => matcher.test(relativeToQa))) {
          results.push(relativeToRepoRoot);
        }
      }
    }
  }

  if (existsSync(functionalDir)) {
    walk(functionalDir);
  }
  return results;
}

async function mapWithConcurrencyLimit<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await task(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/** Resolves each selected test's testId to a spec file path via its coverage_test_links attribution. Baseline tests (reason: 'baseline', no real testId yet) are never passed here — see resolveBaselineFiles instead. */
async function resolveTestFiles(
  commitSha: string,
  tests: readonly FinalSelectedTest[],
): Promise<{ specFiles: string[]; unresolvedTestIds: string[] }> {
  const mappingTests = tests.filter((t) => t.reason !== 'baseline');
  const resolved = await mapWithConcurrencyLimit(
    mappingTests,
    MAX_CONCURRENT_FILE_LOOKUPS,
    async (test) => {
      const links = await findUnitsForTest(commitSha, test.testId);
      const testFile = links.find((link) => link.testFile !== null)?.testFile ?? null;
      return { testId: test.testId, testFile };
    },
  );

  const specFiles = new Set<string>();
  const unresolvedTestIds: string[] = [];
  for (const { testId, testFile } of resolved) {
    if (testFile) {
      specFiles.add(testFile);
    } else {
      unresolvedTestIds.push(testId);
    }
  }
  return { specFiles: Array.from(specFiles), unresolvedTestIds };
}

export interface ImpactRationaleInput {
  specFiles: string[];
  fullSuite: boolean;
  error: string | null;
}

function buildRationale(
  result: FinalSelectionResult,
  changedUnitCount: number,
  impactResolution: ImpactRationaleInput,
): string[] {
  const lines: string[] = [];
  if (result.mode === 'full-suite') {
    lines.push(`Full-suite fallback: ${result.fallbackReasons.join(', ') || 'none reported'}`);
    lines.push(...impactRationale(impactResolution));
    return lines;
  }
  lines.push(`Targeted selection over ${changedUnitCount} changed unit(s).`);
  const byReason = { 'direct-hit': 0, inherited: 0, baseline: 0 } as Record<
    FinalSelectedTest['reason'],
    number
  >;
  for (const test of result.selectedTests) byReason[test.reason]++;
  lines.push(
    `Selected ${result.selectedTests.length} test(s): ${byReason['direct-hit']} direct-hit, ${byReason.inherited} inherited, ${byReason.baseline} baseline.`,
  );
  if (result.widenedTestScopes.length > 0) {
    lines.push(`Dependency-graph widened scopes: ${result.widenedTestScopes.join(', ')}`);
  }
  lines.push(...impactRationale(impactResolution));
  return lines;
}

/** Reports what tier 2 resolved, including the failure that made it resolve nothing. Exported for direct unit testing. */
export function impactRationale(impactResolution: ImpactRationaleInput): string[] {
  if (impactResolution.error !== null) {
    return [`Impact resolution FAILED (selecting nothing from it): ${impactResolution.error}`];
  }
  if (impactResolution.fullSuite) {
    return ['Impact resolution: full functional suite.'];
  }
  if (impactResolution.specFiles.length === 0) {
    return [];
  }
  return [
    `Impact-resolved ${impactResolution.specFiles.length} spec file(s): ${impactResolution.specFiles.join(', ')}`,
  ];
}

/**
 * Resolves tier-2 impacts for a diff, degrading to "nothing resolved" on a
 * resolver error rather than aborting selection.
 *
 * The resolver throws on an unmapped path, an undeclared scope, or a scope with
 * no spec file — each a real defect. Selection does not die on one, because it
 * fronts every developer's push and a stale manifest entry must not block one;
 * the reason is carried out on impactResolutionError instead, where a CI guard
 * can fail on it without also blocking local work.
 */
function resolveImpactedSpecsForDiff(
  fileDiffs: readonly { filePath: string; oldFilePath?: string | null }[],
  cwd: string,
): { specFiles: string[]; fullSuite: boolean; error: string | null } {
  try {
    // Both sides of a rename: moving a file OUT of a covered class impacts that
    // class, and passing only the new path would miss it entirely.
    const changedPaths = fileDiffs.flatMap((diff) =>
      diff.oldFilePath ? [diff.filePath, diff.oldFilePath] : [diff.filePath],
    );
    const resolution = resolveImpactedSpecs(changedPaths, cwd);
    return { specFiles: resolution.specFiles, fullSuite: resolution.fullSuite, error: null };
  } catch (err) {
    return {
      specFiles: [],
      fullSuite: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function selectTests(
  args: CliArgs,
  cwd: string = REPO_ROOT,
): Promise<SelectTestsResult> {
  const baseSha = resolveShaForRef(args.baseRef, cwd);
  const headSha = resolveShaForRef(args.headRef, cwd);

  const fileDiffs = await parseGitDiff(args.baseRef, args.headRef, cwd);
  const { changedUnits, nonSourceFileChanges, unresolvedFileChanges } = await resolveChangedUnits(
    fileDiffs,
    cwd,
    args.baseRef,
    args.headRef,
  );

  const dependencyWideningResults = resolveDependencyWideningForFiles(
    nonSourceFileChanges.map((f) => f.filePath),
  );

  // Over every changed path, not just nonSourceFileChanges: diffParser routes a
  // path to one bucket or the other, and a .ts never reaches the non-source one.
  // The dependency rules keep their own input — they answer alwaysWiden, not this.
  const impactResolution = resolveImpactedSpecsForDiff(fileDiffs, cwd);

  const baselineFiles = resolveBaselineFiles(cwd);
  // Baseline tests carry no real testId yet (they're resolved as files, not
  // via the mapping query API) — safetyNetPolicy only needs testId for its
  // own dedup-against-mapping-selection logic, so a stable synthetic id
  // scoped to the file itself is sufficient and never collides with a real
  // mapping-derived testId (those are always Playwright's own opaque hash
  // shape, never a bare file path).
  const baselineTests: FinalSelectedTest[] = baselineFiles.map((file) => ({
    testId: `baseline:${file}`,
    testName: file,
    reason: 'baseline',
  }));

  // Resolved once per script run, not per call — matches
  // resolveCoverageConfig's own "resolve once, pass down" convention
  // (coveragePolicyConfig.ts).
  const policy = resolveCoveragePolicy();

  let selectionResult: FinalSelectionResult;
  if (args.forceFullSuite) {
    selectionResult = applySafetyNetPolicy([], {
      baselineTests,
      totalChangedUnitCount: changedUnits.length,
      unmappedChanges: [],
      dependencyWideningResults: [],
      forceFullSuite: true,
      minConfidenceThreshold: policy.minConfidenceThreshold,
      maxUnmappedRatio: policy.maxUnmappedRatio,
    });
  } else {
    const { selectedTests, unmappedChanges } = await selectTestsForChangedUnits(
      baseSha,
      changedUnits,
    );
    selectionResult = applySafetyNetPolicy(selectedTests, {
      baselineTests,
      totalChangedUnitCount: changedUnits.length,
      unmappedChanges,
      dependencyWideningResults,
      minConfidenceThreshold: policy.minConfidenceThreshold,
      maxUnmappedRatio: policy.maxUnmappedRatio,
    });
  }

  // Note what is NOT consulted here: impactResolution.fullSuite. A manifest
  // scope of functional:* means "tier 2 has no narrower answer", not "run
  // everything", and it covers server/src/** and client/src/** — the classes
  // tier 1 does attribute. Treating it as a full-suite trigger sent 34 of the
  // last 40 commits to the full suite. Tier 2 only ever adds files below.
  if (selectionResult.mode === 'full-suite') {
    return {
      mode: 'full-suite',
      specFiles: [],
      unresolvedTestIds: [],
      fallbackReasons: selectionResult.fallbackReasons,
      scopeResolvedSpecFiles: impactResolution.specFiles,
      impactResolutionError: impactResolution.error,
      rationale: buildRationale(selectionResult, changedUnits.length, impactResolution),
      baseSha,
      headSha,
    };
  }

  const baselineSpecFiles = selectionResult.selectedTests
    .filter((t) => t.reason === 'baseline')
    .map((t) => t.testName)
    .filter((name): name is string => name !== null);
  const { specFiles: mappedSpecFiles, unresolvedTestIds } = await resolveTestFiles(
    baseSha,
    selectionResult.selectedTests,
  );

  if (unresolvedFileChanges.length > 0) {
    process.stderr.write(
      `[select-tests] WARN: ${unresolvedFileChanges.length} file change(s) could not be resolved to a code unit: ${unresolvedFileChanges.map((u) => u.filePath).join(', ')}\n`,
    );
  }

  return {
    mode: 'targeted',
    // Third producer, unioned and deduplicated alongside baseline and mapped
    // files. Safe now that attestation excludes files nothing could have run:
    // before that, a page-less or grep-excluded spec here failed the push.
    specFiles: Array.from(
      new Set([...baselineSpecFiles, ...mappedSpecFiles, ...impactResolution.specFiles]),
    ),
    unresolvedTestIds,
    fallbackReasons: [],
    scopeResolvedSpecFiles: impactResolution.specFiles,
    impactResolutionError: impactResolution.error,
    rationale: buildRationale(selectionResult, changedUnits.length, impactResolution),
    baseSha,
    headSha,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  try {
    const result = await selectTests(args);
    for (const line of result.rationale) {
      process.stderr.write(`[select-tests] ${line}\n`);
    }
    if (result.unresolvedTestIds.length > 0) {
      process.stderr.write(
        `[select-tests] WARN: ${result.unresolvedTestIds.length} selected test(s) could not be resolved to a spec file (attributed before test_file was captured?): ${result.unresolvedTestIds.join(', ')}\n`,
      );
    }
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } finally {
    await coverageDb.end();
  }
}

// Only run when invoked directly (tsx src/scripts/select-tests.ts), not when imported by a test.
if (process.argv[1] && __filename === resolvePath(process.argv[1])) {
  main().catch((err: unknown) => {
    process.stderr.write(
      `[select-tests] fatal: ${err instanceof Error ? err.stack : String(err)}\n`,
    );
    process.exitCode = 1;
  });
}
