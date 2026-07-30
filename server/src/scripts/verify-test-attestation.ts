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
// qa/scripts/merge-junit-results.ts's parity spec without opening a Postgres
// pool. Re-exported here so this script's existing public surface (and its
// own test file) keep working unchanged. (MINCRM-689)
import {
  findFailedTests,
  findTestsSkippedEverywhere,
  hasParseDisagreement,
  parseJUnitResults,
} from './junitXml.js';

/** Results older than this are rejected as stale, regardless of SHA match — an anti-cheat guard against a results.xml left over from a much earlier run of the same commit. */
const DEFAULT_MAX_AGE_MINUTES = 120;

interface CliArgs {
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
// kept one "so the existing public surface keeps working", but nothing imports
// this module — it is only ever run as a CLI (server/package.json's
// verify:test-attestation, scripts/pre-push-tia.ts, tia-record-mode.yml), and its
// test file imports junitXml.js directly. A pass-through export with no consumer
// is just a second name for the same thing. (MINCRM-689)

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

function readSelectionFiles(selectionPath: string | undefined): string[] | null {
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

function formatFailureOutput(result: AttestationResult): string {
  const lines: string[] = [];
  if (result.reasons.includes('results-file-missing')) {
    lines.push('No results file found — was the test run actually executed?');
  }
  if (result.reasons.includes('results-file-stale')) {
    lines.push(
      'Results file is older than the staleness window — re-run the tests before pushing/merging.',
    );
  }
  if (result.reasons.includes('test-failures')) {
    lines.push(`${result.failedTests.length} test(s) failed:`);
    for (const t of result.failedTests) {
      lines.push(`  - ${t.classname} :: ${t.name}${t.message ? ` — ${t.message}` : ''}`);
    }
  }
  if (result.reasons.includes('skipped-tests')) {
    lines.push(
      `${result.skippedTests.length} test(s) skipped in every project that ran (never ran an assertion anywhere):`,
    );
    for (const t of result.skippedTests) {
      lines.push(`  - ${t.classname} :: ${t.name}`);
    }
  }
  if (result.reasons.includes('results-file-unparseable')) {
    lines.push(
      `Results file could not be fully parsed: the reporter declares ${result.totalTests} test(s) but ${result.parsedTestCount} row(s) were recovered. ` +
        'This is a parser/reporter disagreement, NOT a test outcome — the run may have passed or failed, and this gate cannot tell which. ' +
        'Check the results XML for a truncated or unexpectedly shaped document before trusting any result derived from it.',
    );
  }
  if (result.reasons.includes('no-session-attribution')) {
    lines.push(
      'No coverage session attribution found for this commit SHA — cannot verify which tests actually ran against it. Ensure COVERAGE_SESSION_MANAGEMENT is enabled for this run.',
    );
  }
  if (result.reasons.includes('missing-required-tests')) {
    lines.push(`${result.missingRequiredFiles.length} required test file(s) did not run:`);
    for (const f of result.missingRequiredFiles) {
      lines.push(`  - ${f}`);
    }
  }
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
