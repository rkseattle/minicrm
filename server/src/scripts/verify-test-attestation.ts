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
 *     naming the missing tests. A --selection given but unreadable is
 *     itself a failure ('selection-file-unreadable'), NOT a silent skip:
 *     the caller asked for this reconciliation, so degrading to "no
 *     reconciliation requested" would answer a question nobody asked.
 *     (MINCRM-695)
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
 * an unreadable selection file, or no session attribution found for this
 * SHA at all).
 *
 * A malformed flag value is a non-zero exit with NO stdout JSON — parseArgs
 * throws before verifyAttestation runs. Both callers already treat that as a
 * failure (pre-push-tia.ts finds no parseable stdout and blocks the push;
 * record mode reads the step outcome), so the gate fails CLOSED on bad input
 * rather than falling back to a default window. (MINCRM-696)
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

/**
 * Exported for direct unit testing (MINCRM-696, AC 5) — the thrown TYPE is the
 * assertion, so a test that could only check message text would keep passing if
 * this were downgraded to a bare Error.
 */
export class MissingArgsError extends Error {
  constructor() {
    super('Usage: --results=<path> --sha=<commit-sha> [--selection=<path>] [--max-age-minutes=N]');
    this.name = 'MissingArgsError';
  }
}

/**
 * Thrown when a flag is PRESENT but its value cannot be used. Distinct from
 * MissingArgsError, which reports an ABSENT required flag: the operator's fix
 * differs (supply the flag vs. correct the value), and conflating them would
 * print a usage string at someone who already read it. (MINCRM-696)
 *
 * Exported for the same reason as MissingArgsError — the type is the assertion.
 */
export class InvalidArgError extends Error {
  constructor(flag: string, value: string, requirement: string) {
    super(`--${flag} ${requirement}, got "${value}".`);
    this.name = 'InvalidArgError';
  }
}

/**
 * Exported for direct unit testing (MINCRM-696, AC 1). It was the last untested
 * decision point in this file after MINCRM-691, and not trivial glue: it decides
 * the anti-cheat staleness window, and its `=`-preserving split is a correctness
 * property that a plausible "simplification" would silently break.
 *
 * Follows qa/scripts/merge-junit-results.ts:310's parseArgs — the repo's
 * exported, unit-tested arg parser — including its `/^\d+$/` validation idiom
 * and its named-error-subclass shape.
 */
export function parseArgs(argv: readonly string[]): CliArgs {
  // .slice(1).join('=') rather than [1], so a value containing '=' survives
  // intact. Paths and refs may both contain it — `git check-ref-format
  // 'refs/heads/foo=bar'` exits 0 — and truncating one yields a DIFFERENT,
  // usually nonexistent, path or ref rather than an error. Pinned by test
  // (MINCRM-696 AC 6) so it cannot be "simplified" back.
  const get = (flag: string): string | undefined =>
    argv
      .find((a) => a.startsWith(`--${flag}=`))
      ?.split('=')
      .slice(1)
      .join('=');

  // Ordered BEFORE the max-age validation on purpose: an invocation missing
  // --sha AND carrying a malformed --max-age-minutes reports the missing flag,
  // because that is the more fundamental error and the one whose usage string
  // helps. (MINCRM-696 AC 5)
  const resultsPath = get('results');
  const sha = get('sha');
  if (!resultsPath || !sha) {
    throw new MissingArgsError();
  }

  // `!== undefined`, NOT truthiness: a bare `--max-age-minutes=` yields '',
  // which is falsy, so a truthiness check would send an explicitly-supplied
  // empty value down the default path — the exact silent-widening shape this
  // ticket exists to close, one flag over.
  const maxAgeArg = get('max-age-minutes');
  let maxAgeMinutes = DEFAULT_MAX_AGE_MINUTES;
  if (maxAgeArg !== undefined) {
    // Reject rather than coerce. parseInt('abc') → NaN fell back to the WIDEST
    // window, and parseInt('5x') → 5 accepted partial garbage silently — both
    // the wrong direction for an anti-cheat control, and both invisible to an
    // operator who was trying to NARROW the window. /^\d+$/ also excludes
    // fractions and negatives, matching merge-junit-results.ts:337.
    // Zero is accepted: `ageMinutes > maxAgeMinutes` is strict, so 0 means
    // "written this instant" — vanishingly strict but coherent, and not
    // malformed input. (MINCRM-696 AC 2, AC 4)
    if (!/^\d+$/.test(maxAgeArg)) {
      throw new InvalidArgError('max-age-minutes', maxAgeArg, 'requires a non-negative integer');
    }
    maxAgeMinutes = Number(maxAgeArg);
  }

  return {
    resultsPath: resolvePath(resultsPath),
    // Resolved on the same base as resultsPath. The asymmetry this replaces was
    // undocumented and had no reading under which it was desirable: it meant two
    // relative paths given in one invocation resolved against different bases.
    // Inert for the one live --selection caller, which passes an absolute
    // mkdtemp path. (MINCRM-696 AC 7)
    selectionPath: selectionPathOf(get('selection')),
    sha,
    maxAgeMinutes,
  };
}

/**
 * resolvePath for --selection, preserving "not supplied".
 *
 * Two non-obvious cases, both decided rather than inherited:
 *
 *  - `undefined` (flag absent) stays `undefined`. resolvePath('') would yield
 *    the CWD, silently turning "no reconciliation requested" into a directory
 *    path — which since MINCRM-695 is a HARD gate failure (EISDIR), so the
 *    difference is a blocked push rather than a cosmetic one.
 *  - `''` (a bare `--selection=`) is rejected outright. The flag was supplied,
 *    so treating it as absent repeats this file's original sin — silently
 *    ignoring an input the caller explicitly provided. Rejecting it names the
 *    mistake instead of failing later with an incidental EISDIR from the CWD.
 *    (MINCRM-696)
 */
function selectionPathOf(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  if (raw === '') {
    throw new InvalidArgError('selection', raw, 'requires a path when supplied');
  }
  return resolvePath(raw);
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
  /** A --selection path was given but could not be read as a requirement list — missing, unreadable, malformed JSON, or a specFiles that is not an array of strings. Distinct from "no selection requested": the caller ASKED for reconciliation and did not get it. (MINCRM-695) */
  | 'selection-file-unreadable'
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
  /** Populated only when a --selection file was given AND could be read: required-but-not-run tests, by testFile. An unreadable selection yields [] here and reports 'selection-file-unreadable' instead — the two are mutually exclusive. (MINCRM-695) */
  missingRequiredFiles: string[];
  /** Why the --selection file could not be read, when 'selection-file-unreadable' fired; null otherwise. Carried on the result so formatFailureOutput can name the actual cause — a reason an operator cannot act on is only half a report. (MINCRM-695) */
  selectionUnreadableReason: string | null;
  ranFileCount: number;
}

/**
 * What a `--selection` argument resolved to.
 *
 * A three-way union rather than `string[] | null`, because `null` was doing
 * three incompatible jobs at once and only two of them were benign: "none
 * requested", "full-suite, nothing targeted to reconcile", and "the caller asked
 * for reconciliation and this gate could not read the file". The third collapsed
 * into the first, so a typo'd --selection path produced a PASS with no entry in
 * `reasons` — the one path where this gate stopped gating without saying so.
 * (MINCRM-695)
 *
 * `unreadable` is kept distinct for the same reason qa/scripts/container-commit-sha.ts's
 * ContainerCommitSha keeps `empty` distinct from `unreadable`: collapsing the
 * failure into the benign value hides precisely the condition worth reporting.
 *
 * `why` is a plain string, not a second enum. The union exists so the GATE can
 * decide differently; `why` only explains to a human reading CI output. A second
 * enum would need its own Record, its own docs list and its own parity test to
 * stay honest — machinery for a value nothing branches on.
 */
export type SelectionRequirement =
  { kind: 'none' } | { kind: 'files'; files: string[] } | { kind: 'unreadable'; why: string };

/**
 * Exported for direct unit testing (MINCRM-691 AC 4, MINCRM-695 AC 5). Every arm
 * is a decision point of the gate: `none` disables run-vs-selection
 * reconciliation legitimately, `files` enables it (including for an EMPTY
 * requirement list, which is a real if trivially-satisfied requirement and not
 * the same as `none`), and `unreadable` is a failure in its own right.
 */
export function readSelectionFiles(selectionPath: string | undefined): SelectionRequirement {
  if (!selectionPath) return { kind: 'none' };

  let raw: string;
  try {
    raw = readFileSync(selectionPath, 'utf-8');
  } catch (err) {
    return {
      kind: 'unreadable',
      why: `could not be read (${err instanceof Error ? err.message : String(err)})`,
    };
  }

  let parsed: { specFiles?: unknown; mode?: unknown };
  try {
    parsed = JSON.parse(raw) as { specFiles?: unknown; mode?: unknown };
  } catch (err) {
    return {
      kind: 'unreadable',
      why: `is not valid JSON (${err instanceof Error ? err.message : String(err)})`,
    };
  }

  if (parsed.mode === 'full-suite') {
    // Full-suite mode has no targeted requirement to reconcile against —
    // every file is implicitly required, which this gate can't enumerate
    // without re-discovering the suite itself. Treated as "no
    // reconciliation requested" rather than a failure.
    //
    // Ordered BEFORE the specFiles check on purpose: full-suite means "nothing
    // targeted", whatever specFiles happens to hold.
    return { kind: 'none' };
  }

  if (Array.isArray(parsed.specFiles) && parsed.specFiles.every((f) => typeof f === 'string')) {
    return { kind: 'files', files: parsed.specFiles as string[] };
  }

  return {
    kind: 'unreadable',
    why: 'has no `specFiles` array of strings',
  };
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
      selectionUnreadableReason: null,
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

  // An unreadable selection and a shortfall against a readable one are mutually
  // exclusive by construction: with no requirement list there is nothing to diff
  // against, so missingRequiredFiles stays empty. Inventing a requirement list
  // for the unreadable case would be a second wrong answer on top of the first.
  // (MINCRM-695)
  const selection = readSelectionFiles(args.selectionPath);
  if (selection.kind === 'unreadable') {
    reasons.push('selection-file-unreadable');
  }
  const missingRequiredFiles =
    selection.kind === 'files' ? selection.files.filter((f) => !ranFiles.has(f)) : [];
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
    selectionUnreadableReason: selection.kind === 'unreadable' ? selection.why : null,
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
    'selection-file-unreadable': (result) => [
      `A --selection file was given but ${result.selectionUnreadableReason ?? 'could not be read as a requirement list'}, ` +
        'so run-vs-selection reconciliation did not happen. ' +
        'This is an INPUT failure, NOT a test outcome — the required tests may or may not have run, and this gate cannot tell which. ' +
        'Check the --selection path and that the file is JSON with a `specFiles` array of strings.',
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
