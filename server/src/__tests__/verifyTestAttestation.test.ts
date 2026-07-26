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

import { parseJUnitResults } from '../scripts/verify-test-attestation.js';

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
});
