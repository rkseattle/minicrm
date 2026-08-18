/**
 * junitXml.ts — Pure Playwright JUnit XML parsing.
 *
 * Split out of verify-test-attestation.ts so this logic can be imported without
 * dragging a Postgres pool along. That script imports coverageSessionService and
 * coverageDb, and coverageDb constructs a `pg.Pool` and runs `import
 * 'dotenv/config'` at module load. Anything that only wants to read a JUnit
 * document should not pay that, and a test that only wants to check parsing
 * certainly should not.
 *
 * What that actually costs, measured rather than assumed: NOT open
 * sockets. `new pg.Pool()` is lazy and connects on the first query()/connect(),
 * so importing coverageDb reports totalCount/idleCount/waitingCount all 0. The
 * real costs are a process-wide `types.setTypeParser(20, ...)` mutation, a
 * `dotenv/config` side effect reading a CWD-relative .env (harmless under
 * Vitest, which has already loaded .env.test, but not under an arbitrary CWD),
 * and a pool whose `error` handler THROWS — crashing the process rather than
 * surfacing through an awaiting call — if anything ever does query it. Keeping
 * this module clear of that graph remains correct; the reason is import hygiene
 * and blast radius.
 *
 * The concrete consumer this unblocks is qa/scripts/merge-junit-results.ts's
 * spec, which pins its sibling implementation of the
 * captured-output rule against `stripCapturedOutput` here. Before this split,
 * that parity test pulled the whole DB-bound import graph into a Playwright
 * worker while the module docblocks claimed the opposite.
 *
 * Nothing here touches the filesystem, the network, or a database. Every export
 * is a pure function of its arguments.
 */

// ── JUnit XML parsing ───────────────────────────────────────────────────────
//
// Deliberately a small hand-written extractor, not a general XML library:
// Playwright's own JUnit reporter output is a flat, well-known shape (no
// nested nodes beyond <testsuites><testsuite><testcase>) and no XML parser is
// otherwise a real dependency of this workspace (fast-xml-parser appears in
// node_modules only as a transitive dep of minio/promptfoo, undeclared and
// not safe to rely on surviving a future dependency bump).
//
// What is NOT flat are the CDATA-bodied elements — <system-out>/<system-err>
// (captured console output) and <failure>/<error> (formatFailure output,
// including the failing source snippet). Their payloads can contain
// anything, including text that looks like JUnit structure. Playwright's
// escaping neutralizes only `]]>`. Those bodies are stripped before any
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
   * `--project=desktop --project=mobile-web` run. Empty string
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
  // up front protects the suite-level scan introduced for that work by the
  // same rule, rather than leaving the newer regex the unguarded one.
  const scrubbedXml = stripCapturedOutput(xml);

  const testCases: JUnitTestCase[] = [];
  // Playwright emits one <testsuite> per (spec file, project); the project
  // name lives in its `hostname` attribute. Scanning suite-by-suite rather
  // than sweeping every <testcase> in the document keeps that attribution
  // structural — a testcase's project is whichever suite encloses it — so a
  // multi-project run can tell "skipped under mobile-web but passed under
  // desktop" from "skipped everywhere".
  const suiteRegex = suiteRegionRegex();
  let suiteMatch: RegExpExecArray | null;
  while ((suiteMatch = suiteRegex.exec(scrubbedXml)) !== null) {
    const project = extractAttr(suiteMatch[1], 'hostname') ?? '';
    // Group 2 is undefined for the self-closing <testsuite …/> form, which has
    // no body to scan.
    collectTestCases(suiteMatch[2] ?? '', project, testCases);
  }

  // Sweep anything outside a <testsuite> — a reporter that omits the wrapper
  // entirely, or a document that is only partly suite-wrapped. Attributed to
  // the empty project, so the all-pass rule below degrades to the
  // the earlier behaviour for those rows rather than dropping them.
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
 *
 * Matches the self-closing `<testsuite …/>` form as well (group 2 is undefined
 * there — callers must treat it as an empty body). Without that branch, a
 * self-closing suite preceding a populated one is not seen as a region, so the
 * next match's non-greedy body starts at the self-closing tag and swallows the
 * populated suite's `</testsuite>`: both suites collapse into one region and
 * every row inside is attributed to the WRONG `hostname`, i.e. the wrong
 * Playwright project. That feeds findTestsSkippedEverywhere's cross-project
 * attestation directly, where a mis-attributed row can attest a skip that never
 * passed anywhere. Not reachable from today's reporter, which never self-closes,
 * but the cost of the branch is one alternation.
 */
function suiteRegionRegex(): RegExp {
  return /<testsuite\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testsuite>)/g;
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
 * Runs in two ordered stages, and the ORDER is the whole point:
 *
 *  1. Remove every `<![CDATA[ ... ]]>` section outright. By definition a CDATA
 *     section ends at the first `]]>` and its content is NOT markup, so this
 *     is the one boundary in this format that can be found by scanning
 *     without understanding the surrounding structure. Deleting these first
 *     means no later pattern can ever see text that merely looks like a tag.
 *  2. Only then collapse the CDATA-bodied elements themselves.
 *
 * Doing (2) without (1) is the defect class this addresses. Any element-level
 * regex — however carefully anchored — is matching against a document whose
 * untrusted regions still contain arbitrary text, so a payload containing its
 * own closing tag, another element's closing tag, or `</testsuite>` can end a
 * match early and silently drop rows. Chasing those variants one at a time is
 * unwinnable; removing the untrusted text before any structural scan closes
 * the whole class. Playwright neutralizes only the literal `]]>`, rewriting it
 * to `]]&gt;` within a single CDATA section — see the reporter's own
 * `text.replace(/]]>/g, ']]&gt;')`. (An earlier version of this comment said
 * the reporter splits `]]>` across two CDATA sections; it does not. Either way
 * stage 1 is safe, because no payload can carry a literal `]]>` to close its
 * section early.)
 *
 * Opening tags are preserved, not deleted: `message=` lives there and is read
 * afterwards, and <failure>/<error> presence is what marks a row failed. Only
 * the BODY is emptied. <system-out>/<system-err> are removed entirely, tags
 * included, since nothing downstream reads them.
 *
 * Exported so qa/scripts/junit-xml.ts's sibling implementation can be held to
 * it by a parity test. That module cannot import this one at runtime (it must
 * stay free of this workspace's DB imports), so the two definitions are pinned
 * by test rather than shared — see qa/e2e/tests/framework/merge-junit-results.spec.ts.
 */
export function stripCapturedOutput(xml: string): string {
  const withoutCdata = xml.replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '');
  return withoutCdata.replace(
    /<(system-out|system-err|failure|error)\b([^>]*)>[\s\S]*?<\/\1>/g,
    (_full, tag: string, attrs: string) =>
      tag === 'failure' || tag === 'error' ? `<${tag}${attrs}></${tag}>` : '',
  );
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
    // (this used to strip <system-out>/<system-err> locally,
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

/**
 * Identity of a test independent of which project it ran under — the pair
 * that Playwright repeats once per project in the JUnit XML. Used to
 * reconcile a test's outcomes across projects.
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
  return `${testCase.classname}\0${testCase.name}`;
}

/**
 * Collapses per-project duplicates of the same test to one entry, so a test
 * skipped under three projects is reported once rather than three times.
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
 * without a database.
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
 * Only project-attributed rows can attest. A row swept up outside any
 * <testsuite> carries project '' — its provenance is unknown — so letting it
 * satisfy "passed somewhere" would let an unattributed pass mask a real skip.
 * That is the same masking the orphan sweep above refuses to do for
 * <failure> rows, and the reasoning is identical: an ALL-PASS gate must not
 * discard evidence on the strength of a row it cannot place.
 *
 * Pure, and exported for direct unit testing — this rule is the substance of
 * the gate change, so it must be verifiable without a database
 * rather than only through verifyAttestation's DB-bound path.
 */
export function findTestsSkippedEverywhere(
  testCases: readonly JUnitTestCase[],
): Array<{ classname: string; name: string }> {
  // Keyed on (project, test), not (test): a skip is attested only by a pass
  // in a DIFFERENT project run. Keying on the test alone would let a pass
  // attest a skip of the same test in the SAME project — "passed in at least
  // one project run" is the documented rule, and a pass and a skip of one
  // test within one project is a contradiction that must be reported, not
  // resolved in favour of the pass. Playwright emits one row per
  // (test, project) so this cannot arise from its reporter today; the
  // stricter key means a malformed or hand-merged results file cannot quietly
  // exploit the looser one.
  const attestingProjects = new Map<string, Set<string>>();
  for (const t of testCases) {
    if (!t.passed || t.project === '') continue;
    const key = testCaseKey(t);
    const projects = attestingProjects.get(key) ?? new Set<string>();
    projects.add(t.project);
    attestingProjects.set(key, projects);
  }

  const skippedEverywhere = testCases.filter((t) => {
    if (!t.skipped) return false;
    const projects = attestingProjects.get(testCaseKey(t));
    if (!projects) return true;
    // A pass in this same project does not attest this skip — only a pass in
    // some OTHER project run does.
    return !Array.from(projects).some((project) => project !== t.project);
  });

  return dedupeByKey(skippedEverywhere).map((t) => ({ classname: t.classname, name: t.name }));
}

/**
 * Tests that failed in at least one project run, deduped by identity: one
 * broken test is one thing to fix, not N. Exported alongside
 * findTestsSkippedEverywhere for the same reason.
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
  // reads this output chasing half the problem.
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
