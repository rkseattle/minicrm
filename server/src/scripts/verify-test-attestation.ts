/**
 * verify-test-attestation.ts — Shared test-run attestation gate. (MINCRM-642)
 *
 * Applies at both hybrid selection points — MINCRM-641's local pre-push
 * hook and MINCRM-633/634's CI select-mode job — as one shared, reusable
 * gate. Raises the INTEGRITY of a selected/local run (the required tests
 * genuinely ran and passed), not its COMPLETENESS (whether selection
 * picked the right tests — still the safety net's job and the post-merge
 * full run's).
 *
 * Two mechanisms:
 *  1. Require a passing results file — parses a Playwright JUnit XML
 *     artifact (qa/e2e/test-results/results.xml) and fails unless every
 *     reported test passed. "Every test" is reconciled ACROSS Playwright
 *     projects (MINCRM-687): the reporter emits one <testsuite> per (spec
 *     file, project), and a viewport-conditional test legitimately skips in
 *     the projects it does not apply to. A test counts as attested when it
 *     passed in at least one of the project runs PRESENT IN THIS RESULTS
 *     FILE and failed in none; a test skipped in every run present is
 *     reported. Note the scope: this reconciles what the results file
 *     contains, and cannot know which projects were *intended* — a
 *     single-project invocation that skips a test everywhere is
 *     indistinguishable from a multi-project one that does. Completeness of
 *     the invocation is the caller's responsibility (and, for a selected
 *     run, mechanism 2 below); this gate raises integrity of what ran.
 *  2. Reconcile run vs. selection — asserts the set of tests that
 *     actually ran (via session attribution, MINCRM-612 — NOT the raw
 *     JUnit XML alone, which carries no commit SHA to bind against) is a
 *     SUPERSET of the set select-tests.ts's selection output required for
 *     this diff. Running MORE than required passes; running FEWER fails,
 *     naming the missing tests.
 *
 * Anti-cheat / staleness: the results artifact must be bound to the exact
 * commit SHA under test (via coverage_sessions.build_sha, resolved
 * through session attribution — the JUnit XML itself has no SHA field)
 * and recent (bounded by --max-age-minutes). A results file attributed to
 * a different SHA, or with no session attribution at all, is rejected —
 * this is the anti-cheat property: a stale results.xml sitting on disk
 * from a prior run cannot silently satisfy this gate for a new commit.
 *
 * Usage:
 *   LOG_DESTINATION=stderr tsx src/scripts/verify-test-attestation.ts \
 *     --results=../qa/e2e/test-results/results.xml \
 *     --selection=/tmp/tia-selection.json \
 *     --sha=<commit-sha>
 *
 * Exit code 0 = attestation passed. Non-zero = failed (see stdout JSON's
 * `reasons` for why — test failures, missing required tests, staleness,
 * or no session attribution found for this SHA at all).
 */

import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { findCoverageSessionDumpsByBuildSha } from '../services/coverageSessionService.js';
import coverageDb from '../coverageDb.js';

// JUnit parsing lives in junitXml.ts — pure, DB-free, and importable by
// qa/scripts/merge-junit-results.ts's parity spec without dragging in this
// module's DB-bound import graph. Imported, not re-exported; see the note below
// on why the pass-through was removed. (MINCRM-689)
import {
  findFailedTests,
  findTestsSkippedEverywhere,
  hasParseDisagreement,
  parseJUnitResults,
} from './junitXml.js';

/** Results older than this are rejected as stale, regardless of SHA match — an anti-cheat guard against a results.xml left over from a much earlier run of the same commit. */
const DEFAULT_MAX_AGE_MINUTES = 120;

/**
 * Exported so verifyTestAttestation.test.ts's argument builder names this type
 * rather than relying on structural typing. The builder takes Partial<CliArgs>
 * and spreads over a complete literal, so a newly REQUIRED field would fail it
 * either way; what naming the type adds is that the builder's own signature
 * stays readable as "the arguments verifyAttestation takes", and a field
 * RENAMED here surfaces at the builder instead of silently becoming an excess
 * property in the overrides. (MINCRM-691)
 */
export interface CliArgs {
  resultsPath: string;
  selectionPath: string | undefined;
  sha: string;
  maxAgeMinutes: number;
}

class MissingArgsError extends Error {
  constructor() {
    super('Usage: --results=<path> --sha=<commit-sha> [--selection=<path>] [--max-age-minutes=N]');
    this.name = 'MissingArgsError';
  }
}

function parseArgs(argv: readonly string[]): CliArgs {
  const get = (flag: string): string | undefined =>
    argv
      .find((a) => a.startsWith(`--${flag}=`))
      ?.split('=')
      .slice(1)
      .join('=');

  const resultsPath = get('results');
  const sha = get('sha');
  if (!resultsPath || !sha) {
    throw new MissingArgsError();
  }

  const maxAgeArg = get('max-age-minutes');
  const maxAgeMinutes = maxAgeArg ? parseInt(maxAgeArg, 10) : DEFAULT_MAX_AGE_MINUTES;

  return {
    resultsPath: resolvePath(resultsPath),
    selectionPath: get('selection'),
    sha,
    maxAgeMinutes: isNaN(maxAgeMinutes) ? DEFAULT_MAX_AGE_MINUTES : maxAgeMinutes,
  };
}

// No re-export of junitXml.js's surface here. An earlier version of this split
// kept one "so the existing public surface keeps working", but no PRODUCTION
// code imports this module — it is only ever run as a CLI (server/package.json's
// verify:test-attestation, scripts/pre-push-tia.ts, tia-record-mode.yml). A
// pass-through export with no consumer is just a second name for the same thing.
// (MINCRM-689)
//
// MINCRM-691 added the one importer: verifyTestAttestation.test.ts, which pulls
// verifyAttestation/formatFailureOutput/readSelectionFiles in directly to test
// them. That does not revive the case for re-exporting junitXml.js's surface —
// the same test file imports those from junitXml.js, where they live.

// ── Attestation result ───────────────────────────────────────────────────────

export type AttestationFailureReason =
  | 'results-file-missing'
  | 'results-file-stale'
  | 'test-failures'
  | 'skipped-tests'
  /** The reporter's own <testsuites skipped="N"> disagrees with what this parser could extract — rows were dropped, so the results file cannot be trusted either way. (MINCRM-687) */
  | 'results-file-unparseable'
  | 'no-session-attribution'
  | 'missing-required-tests';

export interface AttestationResult {
  passed: boolean;
  reasons: AttestationFailureReason[];
  /** The reporter's own declared count, from <testsuites tests="N"> — (test, project) pairs. */
  totalTests: number;
  /** How many rows this parser actually recovered. Diverging from totalTests means rows were dropped, which is what 'results-file-unparseable' reports. (MINCRM-687) */
  parsedTestCount: number;
  failedTests: Array<{ classname: string; name: string; message: string | null }>;
  /** Tests skipped in EVERY project they were selected for — they never ran an assertion anywhere, so they cannot satisfy an ALL-PASS gate even though they carry no failure/error of their own. A test skipped under one project but passing under another is attested and absent from this list (MINCRM-687). */
  skippedTests: Array<{ classname: string; name: string }>;
  /** Populated only when a --selection file was given: required-but-not-run tests, by testFile. */
  missingRequiredFiles: string[];
  ranFileCount: number;
}

/**
 * Exported for direct unit testing (MINCRM-691, AC 4). Its `full-suite`
 * short-circuit and its catch-all fallback are both decision points of the gate
 * — a null return silently disables the run-vs-selection reconciliation with no
 * entry in `reasons` — so they are verified here rather than only inferred from
 * verifyAttestation's output.
 */
export function readSelectionFiles(selectionPath: string | undefined): string[] | null {
  if (!selectionPath) return null;
  try {
    const raw = readFileSync(selectionPath, 'utf-8');
    const parsed = JSON.parse(raw) as { specFiles?: unknown; mode?: unknown };
    if (parsed.mode === 'full-suite') {
      // Full-suite mode has no targeted requirement to reconcile against —
      // every file is implicitly required, which this gate can't enumerate
      // without re-discovering the suite itself. Treated as "no
      // reconciliation requested" rather than a failure.
      return null;
    }
    if (Array.isArray(parsed.specFiles) && parsed.specFiles.every((f) => typeof f === 'string')) {
      return parsed.specFiles as string[];
    }
    return null;
  } catch {
    return null;
  }
}

export async function verifyAttestation(args: CliArgs): Promise<AttestationResult> {
  const reasons: AttestationFailureReason[] = [];

  if (!existsSync(args.resultsPath)) {
    return {
      passed: false,
      reasons: ['results-file-missing'],
      totalTests: 0,
      parsedTestCount: 0,
      failedTests: [],
      skippedTests: [],
      missingRequiredFiles: [],
      ranFileCount: 0,
    };
  }

  const stats = statSync(args.resultsPath);
  const ageMinutes = (Date.now() - stats.mtimeMs) / 60_000;
  if (ageMinutes > args.maxAgeMinutes) {
    reasons.push('results-file-stale');
  }

  const xml = readFileSync(args.resultsPath, 'utf-8');
  const parsed = parseJUnitResults(xml);
  // Deduped by (classname, name): a test that fails under several projects is
  // one broken test to fix, not N — reporting it once per project would pad
  // the failure list without adding information. The 'test-failures' reason
  // fires on the first entry either way. (MINCRM-687)
  const failedTests = findFailedTests(parsed.testCases);
  // A skipped test never ran an assertion, so it cannot satisfy an ALL-PASS
  // gate on its own (Greptile PR review: the parser previously treated
  // <skipped> testcases as passed=true, silently letting record mode
  // export/commit a coverage map derived from an incomplete run).
  //
  // MINCRM-687: that rule is applied per TEST, not per (test, project) pair.
  // This suite guards viewport-specific tests in BOTH directions — some skip
  // on mobile viewports, others skip on desktop ones — so no single project
  // selection produces a skip-free run, and failing on any skip made the
  // gate unsatisfiable for the multi-project run record mode needs in order
  // to cover both viewports. (Counts are deliberately not quoted here: they
  // drift with every spec edit. `grep -rn "test.skip(" qa/e2e/tests/` for
  // the current census.)
  //
  // The integrity property this gate exists to protect (see the module
  // docblock: it raises INTEGRITY, not COMPLETENESS) is preserved: a test is
  // attested when it passed in at least one of the project runs present in
  // this results file and failed in none. A test skipped in every run
  // present never ran an assertion anywhere, and that is what
  // 'skipped-tests' reports. A test that fails anywhere is still caught by
  // 'test-failures' above. This reconciles what the file CONTAINS — it
  // cannot know which projects the caller intended to run, so a
  // single-project invocation gets no weaker and no stronger a guarantee
  // than it had before.
  const skippedTests = findTestsSkippedEverywhere(parsed.testCases);

  if (failedTests.length > 0 || parsed.totalFailures > 0 || parsed.totalErrors > 0) {
    reasons.push('test-failures');
  }
  if (skippedTests.length > 0) {
    reasons.push('skipped-tests');
  }
  // Parser sanity check. <testsuites skipped="N"> is NOT usable as a direct
  // failure signal the way totalFailures/totalErrors are — it counts every
  // skipped (test, project) pair, so it is legitimately non-zero for a
  // healthy multi-project run. But the reporter's own totals are still the
  // ground truth for HOW MANY rows this regex-based parser should have
  // recovered, and an ALL-PASS gate must never pass on evidence it failed to
  // read. Two independent disagreements are caught:
  //
  //  - row count: the reporter declares `tests="N"` on <testsuites>, which
  //    counts (test, project) pairs exactly as this parser's rows do. A
  //    mismatch means rows were dropped (a truncated suite, an unexpectedly
  //    shaped document) or double-counted.
  //  - skip presence: N skips declared but none recovered.
  //
  // Reported under its own reason so "the parser is broken" is never
  // mistaken for "the tests were fine". Guarded on totalTests > 0 so a
  // document with no <testsuites> attributes at all (which yields 0) is not
  // condemned on the strength of an absent declaration.
  if (hasParseDisagreement(parsed)) {
    reasons.push('results-file-unparseable');
  }

  // Session attribution (MINCRM-612) is the SHA-binding mechanism — the
  // JUnit XML itself carries no commit SHA, so a results.xml alone cannot
  // prove it belongs to this SHA. No attributed dumps for this SHA means
  // this gate cannot verify what ran, which is treated as a failure, not
  // a pass-by-default: an unverifiable claim is not an attested one.
  const attributedDumps = await findCoverageSessionDumpsByBuildSha(args.sha);
  if (attributedDumps.length === 0) {
    reasons.push('no-session-attribution');
  }
  const ranFiles = new Set(
    attributedDumps.map((d) => d.testFile).filter((f): f is string => f !== null),
  );

  const requiredFiles = readSelectionFiles(args.selectionPath);
  const missingRequiredFiles = requiredFiles ? requiredFiles.filter((f) => !ranFiles.has(f)) : [];
  if (missingRequiredFiles.length > 0) {
    reasons.push('missing-required-tests');
  }

  return {
    passed: reasons.length === 0,
    reasons,
    totalTests: parsed.totalTests,
    parsedTestCount: parsed.testCases.length,
    failedTests,
    skippedTests,
    missingRequiredFiles,
    ranFileCount: ranFiles.size,
  };
}

/**
 * The operator-facing explanation for each failure reason — the text a CI
 * reader actually sees under `[verify-test-attestation] FAILED:`.
 *
 * A `Record` keyed on the reason union rather than a chain of `if`s, so that
 * **adding a reason without a message is a compile error at this declaration**
 * rather than a silently empty line in CI. That is the property MINCRM-691's
 * AC 3 asks for. Note the limit of the guarantee: the type forces an entry to
 * EXIST, but cannot force its body to be non-empty — a `() => []` would still
 * type-check. That residue is covered at runtime by verifyTestAttestation.test.ts,
 * which asserts every reason yields non-empty output while iterating
 * ATTESTATION_FAILURE_REASONS below — this map's own keys, so the check cannot
 * fall behind a newly added reason.
 *
 * Declaration order is the emission order (see formatFailureOutput). Keep it
 * aligned with the order verifyAttestation pushes reasons, so CI output reads
 * in the order the checks ran.
 *
 * These strings are also listed in prose in docs/dev/coverage.md under "Reading
 * a failed run", for operators reading a red CI job. That list is held to this
 * one by a test (verifyTestAttestation.test.ts, "documents every failure reason
 * in docs/dev/coverage.md"), so adding a reason here without documenting it
 * fails the suite rather than drifting quietly — it had already drifted by three
 * reasons before MINCRM-691.
 */
const FAILURE_MESSAGES: Record<AttestationFailureReason, (result: AttestationResult) => string[]> =
  {
    'results-file-missing': () => ['No results file found — was the test run actually executed?'],
    'results-file-stale': () => [
      'Results file is older than the staleness window — re-run the tests before pushing/merging.',
    ],
    'test-failures': (result) => [
      `${result.failedTests.length} test(s) failed:`,
      ...result.failedTests.map(
        (t) => `  - ${t.classname} :: ${t.name}${t.message ? ` — ${t.message}` : ''}`,
      ),
    ],
    'skipped-tests': (result) => [
      `${result.skippedTests.length} test(s) skipped in every project that ran (never ran an assertion anywhere):`,
      ...result.skippedTests.map((t) => `  - ${t.classname} :: ${t.name}`),
    ],
    'results-file-unparseable': (result) => [
      `Results file could not be fully parsed: the reporter declares ${result.totalTests} test(s) but ${result.parsedTestCount} row(s) were recovered. ` +
        'This is a parser/reporter disagreement, NOT a test outcome — the run may have passed or failed, and this gate cannot tell which. ' +
        'Check the results XML for a truncated or unexpectedly shaped document before trusting any result derived from it.',
    ],
    'no-session-attribution': () => [
      'No coverage session attribution found for this commit SHA — cannot verify which tests actually ran against it. Ensure COVERAGE_SESSION_MANAGEMENT is enabled for this run.',
    ],
    'missing-required-tests': (result) => [
      `${result.missingRequiredFiles.length} required test file(s) did not run:`,
      ...result.missingRequiredFiles.map((f) => `  - ${f}`),
    ],
  };

/**
 * Every failure reason, in emission order, derived from FAILURE_MESSAGES rather
 * than hand-listed — so there is exactly ONE place a reason must be registered
 * (the map above, which the union already forces to be complete) and no second
 * list that can quietly fall behind it.
 *
 * Exported so the test that asserts each reason renders non-empty text iterates
 * the real keys. An earlier version of that test kept its own copy of this list
 * plus a compile-time guard written in the wrong direction, which asserted only
 * that its members were valid reasons — never that they covered the union — so
 * a newly added reason silently dropped out of coverage while still type-checking.
 * Deriving the list removes the class rather than repairing the guard.
 * (MINCRM-691)
 */
// The cast is safe because FAILURE_MESSAGES is typed
// Record<AttestationFailureReason, …>: every key is a union member by
// construction, and the map is a module-private literal that nothing mutates at
// runtime. TypeScript widens Object.keys to string[] regardless — it cannot
// express "keys of a Record are exactly the key type" — so the cast recovers
// information the type system already guarantees rather than asserting anything
// new.
export const ATTESTATION_FAILURE_REASONS = Object.keys(
  FAILURE_MESSAGES,
) as readonly AttestationFailureReason[];

/**
 * Renders a failed attestation as the human-readable block written to stderr.
 *
 * Iterates FAILURE_MESSAGES' own keys and filters by `reasons.includes(...)` —
 * deliberately NOT iterating `result.reasons`. The distinction is invisible for
 * the results verifyAttestation produces today (it pushes in this same order and
 * never pushes a duplicate) but this function is exported and takes an arbitrary
 * AttestationResult: iterating `reasons` would make section order follow the
 * caller's array and would print a repeated reason twice. Keying off the map
 * preserves the original if-chain's semantics — fixed order, each section at
 * most once — for any input.
 *
 * Exported for direct unit testing (MINCRM-691, AC 3).
 */
export function formatFailureOutput(result: AttestationResult): string {
  const reasons = new Set(result.reasons);
  const lines = ATTESTATION_FAILURE_REASONS.filter((reason) => reasons.has(reason)).flatMap(
    (reason) => FAILURE_MESSAGES[reason](result),
  );
  return lines.join('\n');
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  try {
    const result = await verifyAttestation(args);
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    if (!result.passed) {
      process.stderr.write(`[verify-test-attestation] FAILED:\n${formatFailureOutput(result)}\n`);
      process.exitCode = 1;
    } else {
      process.stderr.write(
        `[verify-test-attestation] PASSED — ${result.totalTests} test(s), ${result.ranFileCount} attributed file(s).\n`,
      );
    }
  } finally {
    await coverageDb.end();
  }
}

if (process.argv[1] && resolvePath(process.argv[1]).endsWith('verify-test-attestation.ts')) {
  main().catch((err: unknown) => {
    process.stderr.write(
      `[verify-test-attestation] fatal: ${err instanceof Error ? err.stack : String(err)}\n`,
    );
    process.exitCode = 1;
  });
}
