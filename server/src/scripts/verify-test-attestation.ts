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

// ── JUnit XML parsing ───────────────────────────────────────────────────────
//
// Deliberately a small hand-written extractor, not a general XML library:
// Playwright's own JUnit reporter output is a flat, well-known shape (no
// nested nodes beyond <testsuites><testsuite><testcase>) and no XML parser is
// otherwise a real dependency of this workspace (fast-xml-parser appears in
// node_modules only as a transitive dep of minio/promptfoo, undeclared and
// not safe to rely on surviving a future dependency bump).
//
// The one place the shape is NOT flat is <system-out>/<system-err>, whose
// CDATA payload is captured console output and can therefore contain
// anything — including text that looks like JUnit structure. Playwright's
// escaping neutralizes only `]]>`. Those blocks are stripped before any
// structural scan (stripCapturedOutput), and the reporter's own declared
// totals are cross-checked against what was recovered, so a document this
// extractor cannot fully read is reported rather than silently under-parsed.

export interface JUnitTestCase {
  /** classname attribute — the spec file path (relative to qa/e2e/tests/), Playwright's own convention. */
  classname: string;
  name: string;
  /**
   * Playwright project this testcase ran under, read from the enclosing
   * <testsuite hostname="...">. Playwright's JUnit reporter emits ONE
   * <testsuite> per (spec file, project) pair and puts the project name in
   * `hostname` — verified against real reporter output for a
   * `--project=desktop --project=mobile-web` run (MINCRM-687). Empty string
   * when absent, which is how a single-project run from an older reporter
   * degrades.
   */
  project: string;
  /** True only when the testcase has NEITHER a <failure>/<error> child NOR a <skipped> child — a skipped test is not a pass, it never ran an assertion at all. */
  passed: boolean;
  /** True for a <skipped> child element specifically (test.skip()/conditional skip) — distinct from passed=false-via-failure, since "this test never ran" and "this test ran and failed" are different, differently-actionable signals. */
  skipped: boolean;
  /** True for a <failure> or <error> child element specifically (not <skipped>). */
  failureMessage: string | null;
}

export interface JUnitParseResult {
  testCases: JUnitTestCase[];
  totalTests: number;
  totalFailures: number;
  totalErrors: number;
  /** From <testsuites skipped="N">, cross-checked against the per-testcase <skipped> scan below — Playwright emits both. */
  totalSkipped: number;
}

/** Decodes the small set of XML entities Playwright's own JUnit reporter emits (numeric character refs for control characters like newline/tab, plus the standard named entities) — not a general XML-entity decoder. */
function decodeXmlEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(parseInt(code, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/** Extracts every double-quoted attribute value from a tag's opening-tag text. */
function extractAttr(tagText: string, attrName: string): string | null {
  const match = new RegExp(`${attrName}="((?:[^"\\\\]|\\\\.)*)"`).exec(tagText);
  return match ? decodeXmlEntities(match[1]) : null;
}

/**
 * Parses a Playwright JUnit XML file into a flat list of test cases with
 * pass/fail/skip status.
 *
 * A skipped testcase (test.skip(), a conditional skip, or a project-level
 * skip) emits a <skipped/> child element directly inside <testcase> —
 * confirmed against this repo's own Playwright JUnit reporter output
 * (qa/e2e/playwright.config.ts's ['junit', ...] reporter), NOT documented
 * precisely anywhere else. It carries no failure/error child and was
 * previously (wrongly) treated as passed=true by this parser, since the
 * only check was for <failure|error> — found via Greptile PR review. A
 * skipped test proves nothing (no assertion ran), so it must not count as
 * a pass for an ALL-PASS attestation gate.
 */
export function parseJUnitResults(xml: string): JUnitParseResult {
  const suitesMatch = /<testsuites\b([^>]*)>/.exec(xml);
  const totalTests = suitesMatch ? parseInt(extractAttr(suitesMatch[1], 'tests') ?? '0', 10) : 0;
  const totalFailures = suitesMatch
    ? parseInt(extractAttr(suitesMatch[1], 'failures') ?? '0', 10)
    : 0;
  const totalErrors = suitesMatch ? parseInt(extractAttr(suitesMatch[1], 'errors') ?? '0', 10) : 0;
  const totalSkipped = suitesMatch
    ? parseInt(extractAttr(suitesMatch[1], 'skipped') ?? '0', 10)
    : 0;

  // Strip captured stdout/stderr BEFORE any structural scan. Playwright's
  // CDATA escaping only neutralizes the literal `]]>` — a test whose console
  // output contains `</testsuite>` or `<testcase ...>` reaches this parser
  // verbatim and would otherwise terminate the suite scan early, silently
  // dropping every later testcase in that suite. The per-testcase scan
  // already stripped these blocks from each <testcase> body; doing it once
  // up front protects the suite-level scan introduced for MINCRM-687 by the
  // same rule, rather than leaving the newer regex the unguarded one.
  const scrubbedXml = stripCapturedOutput(xml);

  const testCases: JUnitTestCase[] = [];
  // Playwright emits one <testsuite> per (spec file, project); the project
  // name lives in its `hostname` attribute. Scanning suite-by-suite rather
  // than sweeping every <testcase> in the document keeps that attribution
  // structural — a testcase's project is whichever suite encloses it — so a
  // multi-project run can tell "skipped under mobile-web but passed under
  // desktop" from "skipped everywhere". (MINCRM-687)
  const suiteRegex = suiteRegionRegex();
  let suiteMatch: RegExpExecArray | null;
  while ((suiteMatch = suiteRegex.exec(scrubbedXml)) !== null) {
    const project = extractAttr(suiteMatch[1], 'hostname') ?? '';
    collectTestCases(suiteMatch[2], project, testCases);
  }

  // Sweep anything outside a <testsuite> — a reporter that omits the wrapper
  // entirely, or a document that is only partly suite-wrapped. Attributed to
  // the empty project, so the all-pass rule below degrades to the
  // pre-MINCRM-687 behavior for those rows rather than dropping them.
  //
  // stripSuiteBlocks removes every complete <testsuite> region first, so a
  // row can only appear here if it genuinely sits outside one — no row is
  // collected twice, and NOTHING is discarded on the basis of matching an
  // already-collected key. Deduping orphans against suite rows would let a
  // passing suite row mask an orphan <failure> with the same
  // (classname, name), which for an ALL-PASS gate means silently dropping
  // evidence of a failure. Every row parsed is a row reported.
  collectTestCases(stripSuiteBlocks(scrubbedXml), '', testCases);

  return { testCases, totalTests, totalFailures, totalErrors, totalSkipped };
}

/**
 * One definition of a <testsuite>…</testsuite> region, used both to iterate
 * suites and to blank them out for the orphan sweep. The orphan sweep's
 * correctness argument depends on those two operations covering EXACTLY the
 * same regions, so they must not be two hand-copied regexes that can drift.
 * Built fresh per call because /g regexes carry mutable lastIndex state.
 * (MINCRM-687)
 */
function suiteRegionRegex(): RegExp {
  return /<testsuite\b([^>]*?)>([\s\S]*?)<\/testsuite>/g;
}

/**
 * Removes every element whose body is CDATA-escaped free text, which can
 * therefore contain anything — including text that looks like JUnit
 * structure and would otherwise terminate a structural scan early.
 *
 * Playwright CDATA-escapes both captured console output (<system-out>,
 * <system-err>) AND <failure>/<error> bodies, the latter carrying
 * formatFailure() output including the failing source snippet — so a test
 * that asserts on XML, or whose source line contains `</testsuite>`, reaches
 * this parser verbatim. Its escaping neutralizes only the literal `]]>`.
 *
 * Opening tags are preserved, not deleted: `message=` lives there and is
 * read afterwards, and <failure>/<error> presence is what marks a row
 * failed. Only the BODY is emptied. (MINCRM-687)
 */
function stripCapturedOutput(xml: string): string {
  return xml
    .replace(/(<system-(?:out|err)\b[^>]*>)[\s\S]*?(<\/system-(?:out|err)>)/g, '')
    .replace(/(<(?:failure|error)\b[^>]*>)[\s\S]*?(<\/(?:failure|error)>)/g, '$1$2');
}

/** Blanks out every complete <testsuite>…</testsuite> region so only testcases outside a suite remain visible to a follow-up scan. */
function stripSuiteBlocks(xml: string): string {
  return xml.replace(suiteRegionRegex(), '');
}

/**
 * Extracts every <testcase> in `scope`, tagging each with `project`, and
 * appends them to `sink`. Split out of parseJUnitResults so the same scan
 * serves both the per-<testsuite> pass and the no-<testsuite> fallback
 * without duplicating the body-stripping and failure/skip detection rules.
 */
function collectTestCases(scope: string, project: string, sink: JUnitTestCase[]): void {
  const testcaseRegex = /<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g;
  let match: RegExpExecArray | null;
  while ((match = testcaseRegex.exec(scope)) !== null) {
    const attrs = match[1];
    const body = match[2] ?? '';
    const name = extractAttr(attrs, 'name') ?? '';
    const classname = extractAttr(attrs, 'classname') ?? '';
    // No per-testcase strip here: stripCapturedOutput already emptied every
    // CDATA-bodied element document-wide before any scan began, so `body`
    // cannot contain captured console output or failure text. Stripping again
    // would be a second copy of a rule that must not drift from the first.
    // (MINCRM-687 — this used to strip <system-out>/<system-err> locally,
    // which protected these two regexes but left the suite-level scan
    // unguarded.)
    const hasFailureOrError = /<(failure|error)\b/.test(body);
    const hasSkipped = /<skipped\b/.test(body);
    const failureMatch = /<(?:failure|error)\b[^>]*\smessage="((?:[^"\\]|\\.)*)"/.exec(body);
    const failureMessage = failureMatch ? decodeXmlEntities(failureMatch[1]) : null;
    sink.push({
      classname,
      name,
      project,
      passed: !hasFailureOrError && !hasSkipped,
      skipped: hasSkipped,
      failureMessage: hasFailureOrError ? (failureMessage ?? '(no message)') : null,
    });
  }
}

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
 * Identity of a test independent of which project it ran under — the pair
 * that Playwright repeats once per project in the JUnit XML. Used to
 * reconcile a test's outcomes across projects. (MINCRM-687)
 *
 * Joined on NUL because `classname` is a file path and `name` is
 * Playwright's title path, both of which may contain spaces — a space
 * separator would let ("a.spec.ts", "b c") and ("a.spec.ts b", "c") collide.
 *
 * Assumes test titles are unique within a spec file, which Playwright does
 * not enforce. Two same-named tests in one file collapse to one key, so a
 * passing one would attest a skipped one. No duplicate identities exist in
 * the suite today (checked by enumerating `playwright test --list`), and
 * duplicate titles are a test-authoring smell in their own right — but if
 * that changes, this key needs an ordinal component.
 */
function testCaseKey(testCase: Pick<JUnitTestCase, 'classname' | 'name'>): string {
  return `${testCase.classname} ${testCase.name}`;
}

/**
 * Collapses per-project duplicates of the same test to one entry, so a test
 * skipped under three projects is reported once rather than three times.
 * (MINCRM-687)
 */
function dedupeByKey(testCases: JUnitTestCase[]): JUnitTestCase[] {
  const seen = new Set<string>();
  return testCases.filter((t) => {
    const key = testCaseKey(t);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * True when the reporter's own declared totals disagree with what this
 * regex-based parser recovered — meaning rows were dropped or double-counted
 * and the file cannot be trusted either way. An ALL-PASS gate must never
 * pass on evidence it failed to read, so this is a failure reason in its own
 * right, distinct from any test outcome.
 *
 * Two independent disagreements, both grounded in the fact that
 * <testsuites tests="N"> counts (test, project) pairs exactly as this
 * parser's rows do:
 *
 *  - row count: N declared vs. rows recovered
 *  - skip count: <testsuites skipped="N"> declared vs. skipped rows
 *    recovered. A count comparison rather than a presence check, so a
 *    <skipped> element missed WITHIN an otherwise-recovered row is caught
 *    too — the row-count predicate cannot see that case, since the row
 *    itself was recovered.
 *
 * Guarded on `totalTests > 0` so a document carrying no <testsuites>
 * attributes at all (which yields 0) is not condemned on the strength of an
 * absent declaration. Pure and exported so both predicates are unit-testable
 * without a database. (MINCRM-687)
 */
export function hasParseDisagreement(parsed: JUnitParseResult): boolean {
  const rowCountDisagrees = parsed.totalTests > 0 && parsed.totalTests !== parsed.testCases.length;
  const skipCountDisagrees =
    parsed.totalSkipped > 0 &&
    parsed.testCases.filter((t) => t.skipped).length !== parsed.totalSkipped;
  return rowCountDisagrees || skipCountDisagrees;
}

/**
 * Reconciles each test's outcomes across the project runs present in a
 * results file, returning the tests that never ran an assertion in ANY of
 * them: skipped everywhere, passing nowhere. A test skipped under one
 * project but passing under another is attested and absent from the result.
 * Entries are deduped, so a test skipped under three projects appears once.
 *
 * Pure, and exported for direct unit testing — this rule is the substance of
 * MINCRM-687's gate change, so it must be verifiable without a database
 * rather than only through verifyAttestation's DB-bound path.
 */
export function findTestsSkippedEverywhere(
  testCases: readonly JUnitTestCase[],
): Array<{ classname: string; name: string }> {
  const passedAnywhere = new Set(testCases.filter((t) => t.passed).map((t) => testCaseKey(t)));
  return dedupeByKey(testCases.filter((t) => t.skipped && !passedAnywhere.has(testCaseKey(t)))).map(
    (t) => ({ classname: t.classname, name: t.name }),
  );
}

/**
 * Tests that failed in at least one project run, deduped by identity: one
 * broken test is one thing to fix, not N. Exported alongside
 * findTestsSkippedEverywhere for the same reason. (MINCRM-687)
 */
export function findFailedTests(
  testCases: readonly JUnitTestCase[],
): Array<{ classname: string; name: string; message: string | null }> {
  const failures = testCases.filter((t) => !t.passed && !t.skipped);
  // Deduped on (test, message), not on the test alone: the same test failing
  // under two projects with the SAME message is one thing to fix and is
  // collapsed, but two DIFFERENT messages are two distinct pieces of
  // diagnostic evidence — a desktop-only assertion error and a mobile-only
  // one are not interchangeable, and dropping either would send whoever
  // reads this output chasing half the problem. (MINCRM-687)
  const seen = new Set<string>();
  return failures
    .filter((t) => {
      const key = `${testCaseKey(t)}\0${t.failureMessage ?? ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((t) => ({
      classname: t.classname,
      name: t.name,
      message: t.failureMessage,
    }));
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
