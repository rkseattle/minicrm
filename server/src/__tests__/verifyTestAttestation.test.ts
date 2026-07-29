/**
 * Unit tests for verify-test-attestation.ts's JUnit XML parsing. (MINCRM-642)
 *
 * parseJUnitResults is pure (no DB, no filesystem) and the highest-risk
 * logic in this script — a false "passed" here would let a broken run
 * through the attestation gate. verifyAttestation itself (DB-backed) is
 * exercised via the E2E functional spec instead, following the same
 * split testSelectionService.test.ts/coverageMappingController.test.ts
 * already use elsewhere in this codebase.
 */

import {
  parseJUnitResults,
  findTestsSkippedEverywhere,
  findFailedTests,
  hasParseDisagreement,
  type JUnitTestCase,
} from '../scripts/verify-test-attestation.js';

/** Builds a JUnitTestCase with the fields these tests care about. */
function testCase(overrides: Partial<JUnitTestCase>): JUnitTestCase {
  return {
    classname: 'a.spec.ts',
    name: 'a test',
    project: 'desktop',
    passed: false,
    skipped: false,
    failureMessage: null,
    ...overrides,
  };
}

describe('parseJUnitResults', () => {
  it('parses a passing suite with multiple testsuites/testcases', () => {
    const xml = `<testsuites id="" name="" tests="2" failures="0" skipped="0" errors="0" time="1.5">
<testsuite name="a.spec.ts" timestamp="2026-01-01T00:00:00.000Z" hostname="desktop" tests="2" failures="0" skipped="0" time="1.5" errors="0">
<testcase name="test one" classname="apps/minicrm/functional/a.spec.ts" time="1.0">
</testcase>
<testcase name="test two" classname="apps/minicrm/functional/a.spec.ts" time="0.5">
</testcase>
</testsuite>
</testsuites>`;

    const result = parseJUnitResults(xml);

    expect(result.totalTests).toBe(2);
    expect(result.totalFailures).toBe(0);
    expect(result.totalErrors).toBe(0);
    expect(result.testCases).toHaveLength(2);
    expect(result.testCases.every((t) => t.passed)).toBe(true);
    expect(result.testCases.every((t) => t.skipped === false)).toBe(true);
    expect(result.testCases.every((t) => t.failureMessage === null)).toBe(true);
  });

  it('detects a <skipped> element and marks that testcase as not passed, not failed', () => {
    // Real shape captured from Playwright's own JUnit reporter for a
    // test.skip() spec — a <skipped/> child sibling to <properties>, with
    // no <failure>/<error> of its own. Previously this parser only checked
    // for <failure>/<error>, so a skipped testcase was wrongly marked
    // passed=true (Greptile PR review finding).
    const xml = `<testsuites id="" name="" tests="2" failures="0" skipped="1" errors="0" time="0.1">
<testsuite name="skip-probe.spec.ts" timestamp="2026-01-01T00:00:00.000Z" hostname="desktop" tests="2" failures="0" skipped="1" time="0.1" errors="0">
<testcase name="a test that passes" classname="_scratch/skip-probe.spec.ts" time="0.1">
</testcase>
<testcase name="a test that is skipped" classname="_scratch/skip-probe.spec.ts" time="0">
<properties>
<property name="skip" value="">
</property>
</properties>
<skipped>
</skipped>
</testcase>
</testsuite>
</testsuites>`;

    const result = parseJUnitResults(xml);

    expect(result.totalSkipped).toBe(1);
    expect(result.testCases).toHaveLength(2);

    const passed = result.testCases.find((t) => t.name === 'a test that passes');
    expect(passed?.passed).toBe(true);
    expect(passed?.skipped).toBe(false);

    const skipped = result.testCases.find((t) => t.name === 'a test that is skipped');
    expect(skipped?.passed).toBe(false);
    expect(skipped?.skipped).toBe(true);
    expect(skipped?.failureMessage).toBeNull();
  });

  it('does not false-positive on "<skipped"/"<failure" text captured inside <system-out>', () => {
    // Playwright's JUnit reporter embeds a testcase's own console output
    // and attachment references inside <system-out>/<system-err> CDATA
    // blocks in the SAME <testcase> body this parser scans. A passing test
    // whose logged output happens to mention "<skipped" (e.g. app code
    // logging a conditional-skip decision) must not be misclassified.
    const xml = `<testsuites id="" name="" tests="1" failures="0" skipped="0" errors="0" time="0.1">
<testsuite name="a.spec.ts" timestamp="2026-01-01T00:00:00.000Z" hostname="desktop" tests="1" failures="0" skipped="0" time="0.1" errors="0">
<testcase name="a test that logs the word skipped" classname="apps/minicrm/functional/a.spec.ts" time="0.1">
<system-out><![CDATA[App log: step "<skipped-validation/>" was bypassed. Also mentions <failure> in a log line.]]></system-out>
</testcase>
</testsuite>
</testsuites>`;

    const result = parseJUnitResults(xml);

    expect(result.testCases).toHaveLength(1);
    expect(result.testCases[0].passed).toBe(true);
    expect(result.testCases[0].skipped).toBe(false);
    expect(result.testCases[0].failureMessage).toBeNull();
  });

  it('reports a genuine <failure> even when captured output also mentions "<skipped"', () => {
    // A real failure whose captured stdout happens to contain unrelated
    // "<skipped" text must still be classified as failed, not skipped —
    // regression guard for the <system-out> stripping fix above.
    const xml = `<testsuites id="" name="" tests="1" failures="1" skipped="0" errors="0" time="0.1">
<testsuite name="a.spec.ts" timestamp="2026-01-01T00:00:00.000Z" hostname="desktop" tests="1" failures="1" skipped="0" time="0.1" errors="0">
<testcase name="a test that fails and logs skipped text" classname="apps/minicrm/functional/a.spec.ts" time="0.1">
<failure message="expect(received).toBe(expected)" type="AssertionError">
Some stack trace here
</failure>
<system-out><![CDATA[App log: a prior unrelated step was <skipped/>.]]></system-out>
</testcase>
</testsuite>
</testsuites>`;

    const result = parseJUnitResults(xml);

    expect(result.testCases).toHaveLength(1);
    expect(result.testCases[0].passed).toBe(false);
    expect(result.testCases[0].skipped).toBe(false);
    expect(result.testCases[0].failureMessage).toBe('expect(received).toBe(expected)');
  });

  it('detects a <failure> element and marks that testcase as not passed', () => {
    const xml = `<testsuites id="" name="" tests="2" failures="1" skipped="0" errors="0" time="1.5">
<testsuite name="a.spec.ts" timestamp="2026-01-01T00:00:00.000Z" hostname="desktop" tests="2" failures="1" skipped="0" time="1.5" errors="0">
<testcase name="creates a deal" classname="apps/minicrm/functional/deals/deal-creation.spec.ts" time="1.0">
<failure message="expect(received).toBe(expected)&#10;&#10;Expected: 200&#10;Received: 500" type="AssertionError">
Some stack trace here
</failure>
</testcase>
<testcase name="deletes a deal" classname="apps/minicrm/functional/deals/deal-creation.spec.ts" time="0.5">
</testcase>
</testsuite>
</testsuites>`;

    const result = parseJUnitResults(xml);

    expect(result.totalFailures).toBe(1);
    expect(result.testCases).toHaveLength(2);

    const failed = result.testCases.find((t) => t.name === 'creates a deal');
    expect(failed?.passed).toBe(false);
    expect(failed?.failureMessage).toBe(
      'expect(received).toBe(expected)\n\nExpected: 200\nReceived: 500',
    );

    const passed = result.testCases.find((t) => t.name === 'deletes a deal');
    expect(passed?.passed).toBe(true);
    expect(passed?.failureMessage).toBeNull();
  });

  it('detects an <error> element identically to a <failure>', () => {
    const xml = `<testsuites id="" name="" tests="1" failures="0" skipped="0" errors="1" time="0.5">
<testsuite name="a.spec.ts" timestamp="2026-01-01T00:00:00.000Z" hostname="desktop" tests="1" failures="0" skipped="0" time="0.5" errors="1">
<testcase name="a test" classname="apps/minicrm/functional/a.spec.ts" time="0.5">
<error message="Timeout of 30000ms exceeded" type="TimeoutError">
Stack trace
</error>
</testcase>
</testsuite>
</testsuites>`;

    const result = parseJUnitResults(xml);

    expect(result.totalErrors).toBe(1);
    expect(result.testCases[0].passed).toBe(false);
    expect(result.testCases[0].failureMessage).toBe('Timeout of 30000ms exceeded');
  });

  it('handles self-closing <testcase/> elements (no failure/error body)', () => {
    const xml = `<testsuites id="" name="" tests="1" failures="0" skipped="0" errors="0" time="0.1">
<testsuite name="a.spec.ts" timestamp="2026-01-01T00:00:00.000Z" hostname="desktop" tests="1" failures="0" skipped="0" time="0.1" errors="0">
<testcase name="a test" classname="apps/minicrm/functional/a.spec.ts" time="0.1"/>
</testsuite>
</testsuites>`;

    const result = parseJUnitResults(xml);

    expect(result.testCases).toHaveLength(1);
    expect(result.testCases[0].passed).toBe(true);
  });

  it('returns zeroed totals for an empty/malformed document rather than throwing', () => {
    const result = parseJUnitResults('not xml at all');

    expect(result.totalTests).toBe(0);
    expect(result.totalFailures).toBe(0);
    expect(result.totalErrors).toBe(0);
    expect(result.testCases).toHaveLength(0);
  });

  it('extracts classname across multiple testsuite blocks (e.g. desktop + mobile-web projects)', () => {
    const xml = `<testsuites id="" name="" tests="2" failures="0" skipped="0" errors="0" time="0.5">
<testsuite name="a.spec.ts" timestamp="2026-01-01T00:00:00.000Z" hostname="desktop" tests="1" failures="0" skipped="0" time="0.25" errors="0">
<testcase name="a test" classname="apps/minicrm/functional/a.spec.ts" time="0.25">
</testcase>
</testsuite>
<testsuite name="a.spec.ts" timestamp="2026-01-01T00:00:00.000Z" hostname="mobile-web" tests="1" failures="0" skipped="0" time="0.25" errors="0">
<testcase name="a test" classname="apps/minicrm/functional/a.spec.ts" time="0.25">
</testcase>
</testsuite>
</testsuites>`;

    const result = parseJUnitResults(xml);

    expect(result.testCases).toHaveLength(2);
    expect(result.testCases.every((t) => t.classname === 'apps/minicrm/functional/a.spec.ts')).toBe(
      true,
    );
  });

  // MINCRM-687: the gate reconciles a test's outcome across projects, which
  // is only possible if the parser records which project each testcase ran
  // under. Playwright puts the project name in <testsuite hostname="...">.
  it('attributes each testcase to the project of its enclosing testsuite', () => {
    const xml = `<testsuites id="" name="" tests="2" failures="0" skipped="0" errors="0" time="0.5">
<testsuite name="a.spec.ts" timestamp="2026-01-01T00:00:00.000Z" hostname="desktop" tests="1" failures="0" skipped="0" time="0.25" errors="0">
<testcase name="a test" classname="apps/minicrm/functional/a.spec.ts" time="0.25">
</testcase>
</testsuite>
<testsuite name="a.spec.ts" timestamp="2026-01-01T00:00:00.000Z" hostname="mobile-web" tests="1" failures="0" skipped="0" time="0.25" errors="0">
<testcase name="a test" classname="apps/minicrm/functional/a.spec.ts" time="0.25">
</testcase>
</testsuite>
</testsuites>`;

    const result = parseJUnitResults(xml);

    expect(result.testCases.map((t) => t.project)).toEqual(['desktop', 'mobile-web']);
  });

  // Real shape captured from Playwright's own reporter for a
  // `--project=desktop --project=mobile-web` run: the same test appears once
  // per project, skipped in the one whose viewport it does not apply to.
  it('records a viewport-conditional test as skipped in one project and passing in the other', () => {
    const xml = `<testsuites id="" name="" tests="4" failures="0" skipped="2" errors="0" time="1.4">
<testsuite name="probe.spec.ts" timestamp="2026-01-01T00:00:00.000Z" hostname="desktop" tests="2" failures="0" skipped="1" time="0.37" errors="0">
<testcase name="desktop only" classname="apps/minicrm/functional/probe.spec.ts" time="0.07">
</testcase>
<testcase name="mobile only" classname="apps/minicrm/functional/probe.spec.ts">
<properties>
<property name="skip" value="mobile-only probe">
</property>
</properties>
<skipped>
</skipped>
</testcase>
</testsuite>
<testsuite name="probe.spec.ts" timestamp="2026-01-01T00:00:00.000Z" hostname="mobile-web" tests="2" failures="0" skipped="1" time="0.25" errors="0">
<testcase name="desktop only" classname="apps/minicrm/functional/probe.spec.ts">
<properties>
<property name="skip" value="desktop-only probe">
</property>
</properties>
<skipped>
</skipped>
</testcase>
<testcase name="mobile only" classname="apps/minicrm/functional/probe.spec.ts" time="0.08">
</testcase>
</testsuite>
</testsuites>`;

    const result = parseJUnitResults(xml);

    const desktopOnly = result.testCases.filter((t) => t.name === 'desktop only');
    const mobileOnly = result.testCases.filter((t) => t.name === 'mobile only');

    // Each test passes in exactly one project and is skipped in the other —
    // the union covers both, which is what makes the run attestable.
    expect(desktopOnly.find((t) => t.project === 'desktop')?.passed).toBe(true);
    expect(desktopOnly.find((t) => t.project === 'mobile-web')?.skipped).toBe(true);
    expect(mobileOnly.find((t) => t.project === 'mobile-web')?.passed).toBe(true);
    expect(mobileOnly.find((t) => t.project === 'desktop')?.skipped).toBe(true);

    // <testsuites skipped="N"> counts (test, project) pairs, so it is
    // non-zero for a healthy multi-project run — which is exactly why the
    // gate no longer treats it as a failure signal on its own.
    expect(result.totalSkipped).toBe(2);
  });

  // MINCRM-687: captured console output can contain text that looks like
  // JUnit structure. Playwright's CDATA escaping neutralizes only `]]>`, so
  // a `</testsuite>` in a log line reaches this parser verbatim and would
  // truncate the suite scan, silently dropping later testcases.
  it('does not truncate a suite when captured output contains a literal </testsuite>', () => {
    const xml = `<testsuites id="" name="" tests="3" failures="0" skipped="2" errors="0" time="1">
<testsuite name="a.spec.ts" hostname="desktop" tests="3" failures="0" skipped="2" time="1" errors="0">
<testcase name="t1" classname="a.spec.ts" time="0.1">
<system-out><![CDATA[log line mentioning </testsuite> mid-output]]></system-out>
</testcase>
<testcase name="t2" classname="a.spec.ts">
<skipped>
</skipped>
</testcase>
<testcase name="t3" classname="a.spec.ts">
<skipped>
</skipped>
</testcase>
</testsuite>
</testsuites>`;

    const result = parseJUnitResults(xml);

    expect(result.testCases).toHaveLength(3);
    expect(result.testCases.filter((t) => t.skipped)).toHaveLength(2);
    // All three keep their project attribution — the suite was not cut short.
    expect(result.testCases.every((t) => t.project === 'desktop')).toBe(true);
  });

  it('falls back to parsing testcases with an empty project when no testsuite wrapper is present', () => {
    const xml = `<testsuites id="" name="" tests="1" failures="0" skipped="0" errors="0" time="0.1">
<testcase name="orphan test" classname="apps/minicrm/functional/a.spec.ts" time="0.1">
</testcase>
</testsuites>`;

    const result = parseJUnitResults(xml);

    expect(result.testCases).toHaveLength(1);
    expect(result.testCases[0].project).toBe('');
    expect(result.testCases[0].passed).toBe(true);
  });
});

// MINCRM-687: the cross-project reconciliation rule is the substance of the
// gate change, so it is tested directly rather than inferred from parser
// fields. Each case below would pass under the OLD "any skip fails" rule too
// unless stated otherwise — the discriminating case is the first one.
describe('findTestsSkippedEverywhere', () => {
  it('does not report a test skipped in one project but passing in another', () => {
    const cases = [
      testCase({ name: 'desktop only', project: 'desktop', passed: true }),
      testCase({ name: 'desktop only', project: 'mobile-web', skipped: true }),
      testCase({ name: 'mobile only', project: 'desktop', skipped: true }),
      testCase({ name: 'mobile only', project: 'mobile-web', passed: true }),
    ];

    // The old rule reported both of these; the whole point of the change is
    // that a viewport-conditional test covered by the union is attested.
    expect(findTestsSkippedEverywhere(cases)).toEqual([]);
  });

  it('reports a test skipped in every project, exactly once', () => {
    const cases = [
      testCase({ name: 'never runs', project: 'desktop', skipped: true }),
      testCase({ name: 'never runs', project: 'mobile-web', skipped: true }),
      testCase({ name: 'never runs', project: 'perf', skipped: true }),
    ];

    expect(findTestsSkippedEverywhere(cases)).toEqual([
      { classname: 'a.spec.ts', name: 'never runs' },
    ]);
  });

  it('distinguishes same-named tests in different spec files', () => {
    const cases = [
      testCase({ classname: 'a.spec.ts', name: 'shared name', passed: true }),
      testCase({ classname: 'b.spec.ts', name: 'shared name', skipped: true }),
    ];

    // Keyed on (classname, name) — a pass in a.spec.ts must not attest a
    // skip of the same-named test in b.spec.ts.
    expect(findTestsSkippedEverywhere(cases)).toEqual([
      { classname: 'b.spec.ts', name: 'shared name' },
    ]);
  });

  it('does not let a pass in one project mask a FAILURE in another', () => {
    const cases = [
      testCase({ name: 'flaps', project: 'desktop', passed: true }),
      testCase({ name: 'flaps', project: 'mobile-web', failureMessage: 'boom' }),
    ];

    // Not this function's job to report it — but it must not appear as
    // skipped either. findFailedTests below is what catches it.
    expect(findTestsSkippedEverywhere(cases)).toEqual([]);
    expect(findFailedTests(cases)).toEqual([
      { classname: 'a.spec.ts', name: 'flaps', message: 'boom' },
    ]);
  });

  it('returns nothing for an all-passing single-project run', () => {
    const cases = [
      testCase({ name: 'one', passed: true }),
      testCase({ name: 'two', passed: true }),
    ];

    expect(findTestsSkippedEverywhere(cases)).toEqual([]);
  });

  // Guards the scope limitation stated in the module docblock: the rule
  // reconciles what the results file CONTAINS. A single-project run is not
  // weakened by the change — a test skipped there passed nowhere, so it is
  // still reported exactly as it was before MINCRM-687.
  it('still reports a skipped test in a single-project run', () => {
    const cases = [
      testCase({ name: 'ran', project: 'desktop', passed: true }),
      testCase({ name: 'never ran', project: 'desktop', skipped: true }),
    ];

    expect(findTestsSkippedEverywhere(cases)).toEqual([
      { classname: 'a.spec.ts', name: 'never ran' },
    ]);
  });
});

describe('findFailedTests', () => {
  it('reports a test failing in several projects once, not once per project', () => {
    const cases = [
      testCase({ name: 'broken', project: 'desktop', failureMessage: 'expected 200' }),
      testCase({ name: 'broken', project: 'mobile-web', failureMessage: 'expected 200' }),
    ];

    expect(findFailedTests(cases)).toEqual([
      { classname: 'a.spec.ts', name: 'broken', message: 'expected 200' },
    ]);
  });

  it('does not treat a skipped test as failed', () => {
    const cases = [testCase({ name: 'skipped one', skipped: true })];

    expect(findFailedTests(cases)).toEqual([]);
  });

  // Two projects failing the same test for DIFFERENT reasons are two pieces
  // of diagnostic evidence. Collapsing them to one would send a reader
  // chasing half the problem.
  it('keeps both messages when the same test fails differently in two projects', () => {
    const cases = [
      testCase({ name: 'broken', project: 'desktop', failureMessage: 'desktop assertion' }),
      testCase({ name: 'broken', project: 'mobile-web', failureMessage: 'mobile assertion' }),
    ];

    expect(findFailedTests(cases)).toEqual([
      { classname: 'a.spec.ts', name: 'broken', message: 'desktop assertion' },
      { classname: 'a.spec.ts', name: 'broken', message: 'mobile assertion' },
    ]);
  });
});

// MINCRM-687: an ALL-PASS gate must never discard evidence of a failure.
// These guard the parser's row-collection, where a dedupe against
// already-collected keys previously let a passing suite row mask an orphan
// <failure> carrying the same (classname, name).
describe('parseJUnitResults — row collection never drops a failure', () => {
  it('keeps a testcase outside any testsuite even when a suite row shares its identity', () => {
    const xml = `<testsuites tests="2" failures="1" skipped="0" errors="0">
<testsuite name="a.spec.ts" hostname="desktop" tests="1" failures="0" skipped="0" errors="0">
<testcase name="t1" classname="a.spec.ts">
</testcase>
</testsuite>
<testcase name="t1" classname="a.spec.ts">
<failure message="ORPHAN FAILURE">
</failure>
</testcase>
</testsuites>`;

    const result = parseJUnitResults(xml);

    expect(result.testCases).toHaveLength(2);
    expect(findFailedTests(result.testCases)).toEqual([
      { classname: 'a.spec.ts', name: 't1', message: 'ORPHAN FAILURE' },
    ]);
  });

  // Playwright CDATA-escapes <failure>/<error> bodies too, not just captured
  // console output — the body carries formatFailure()'s source snippet, so a
  // test whose failing source line contains XML reaches this parser verbatim.
  it('does not drop a row when a <failure> body contains a literal </testsuite>', () => {
    const xml = `<testsuites tests="1" failures="1" skipped="0" errors="0">
<testsuite name="a.spec.ts" hostname="desktop" tests="1" failures="1" skipped="0" errors="0">
<testcase name="t1" classname="a.spec.ts">
<failure message="assertion failed"><![CDATA[source snippet containing </testsuite> here]]></failure>
</testcase>
</testsuite>
</testsuites>`;

    const result = parseJUnitResults(xml);

    expect(result.testCases).toHaveLength(1);
    // The opening tag survives the strip, so the row is still marked failed
    // and its message — which lives in the attribute, not the body — is kept.
    expect(result.testCases[0].passed).toBe(false);
    expect(result.testCases[0].failureMessage).toBe('assertion failed');
    expect(hasParseDisagreement(result)).toBe(false);
  });

  it('collects rows from every testsuite without double-counting them as orphans', () => {
    const xml = `<testsuites tests="2" failures="0" skipped="0" errors="0">
<testsuite name="a.spec.ts" hostname="desktop" tests="1" failures="0" skipped="0" errors="0">
<testcase name="t1" classname="a.spec.ts">
</testcase>
</testsuite>
<testsuite name="a.spec.ts" hostname="mobile-web" tests="1" failures="0" skipped="0" errors="0">
<testcase name="t1" classname="a.spec.ts">
</testcase>
</testsuite>
</testsuites>`;

    const result = parseJUnitResults(xml);

    // Exactly one row per (test, project) — the orphan sweep must not
    // re-collect rows already claimed by a suite.
    expect(result.testCases).toHaveLength(2);
    expect(result.testCases.map((t) => t.project).sort()).toEqual(['desktop', 'mobile-web']);
  });
});

// MINCRM-687: this is the last line of defense for a document this
// regex-based parser cannot fully read. An ALL-PASS gate must never pass on
// evidence it failed to parse, so both predicates are pinned directly.
describe('hasParseDisagreement', () => {
  const parsed = (over: Partial<ReturnType<typeof parseJUnitResults>>) => ({
    testCases: [],
    totalTests: 0,
    totalFailures: 0,
    totalErrors: 0,
    totalSkipped: 0,
    ...over,
  });

  it('reports a row-count mismatch between the reporter and the parser', () => {
    expect(
      hasParseDisagreement(parsed({ totalTests: 40, testCases: [testCase({ passed: true })] })),
    ).toBe(true);
  });

  it('reports declared skips that the parser never recovered', () => {
    expect(
      hasParseDisagreement(
        parsed({ totalTests: 1, totalSkipped: 3, testCases: [testCase({ passed: true })] }),
      ),
    ).toBe(true);
  });

  it('accepts a run whose declared totals match what was recovered', () => {
    expect(
      hasParseDisagreement(
        parsed({
          totalTests: 2,
          totalSkipped: 1,
          testCases: [
            testCase({ name: 'a', passed: true }),
            testCase({ name: 'b', skipped: true }),
          ],
        }),
      ),
    ).toBe(false);
  });

  it('does not condemn a document that declares no totals at all', () => {
    // totalTests === 0 means the <testsuites> attributes were absent, not
    // that zero tests ran — judging the parser against an absent declaration
    // would fail every such file.
    expect(hasParseDisagreement(parsed({ totalTests: 0, testCases: [testCase({})] }))).toBe(false);
  });
});
