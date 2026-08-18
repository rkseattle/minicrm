/**
 * Unit tests for the test-run attestation gate.
 *
 * Two layers, both covered here:
 *
 *  1. **The pure JUnit parsing** (junitXml.ts) — parseJUnitResults and the
 *     reconciliation rules it feeds (findTestsSkippedEverywhere,
 *     findFailedTests, hasParseDisagreement). Highest-risk logic in the script:
 *     a false "passed" here would let a broken run through the gate.
 *
 *  2. **verifyAttestation's reason assembly** (verify-test-attestation.ts) —
 *     which predicate maps to which AttestationFailureReason, plus
 *     formatFailureOutput's operator-facing text and readSelectionFiles'
 *     three-way SelectionRequirement union.
 *     Added by; before that the gate's
 *     own decision logic was verified only through the pure helpers it
 *     delegates to, so a change that stopped CALLING one of them left the suite
 *     green. (An older version of this docblock claimed an E2E functional spec
 *     covered it. No such spec ever existed — the coverage-* specs cover the
 *     pipeline, sessions and mapping APIs, not this gate.)
 *
 * How layer 2 runs without a coverage database: verifyAttestation has exactly
 * one impure collaborator, findCoverageSessionDumpsByBuildSha, which is
 * substituted at the module boundary (see the vi.mock block below). Everything
 * else is driven through a real per-test temp directory, because
 * existsSync/statSync/readFileSync behavior — including mtime-driven staleness —
 * is part of what these tests exist to verify; mocking node:fs would test the
 * mock. coverageDb is mocked too, but as a forward guard rather than a
 * necessity — see the comment on that mock for why the pool being lazy makes it
 * optional today.
 *
 * The vi.mock calls are file-scoped and so apply to layer 1's describes as
 * well. That is inert: neither mocked module is in junitXml.ts's import graph,
 * which is why those tests still import from junitXml.ts directly.
 */

// ── Mocked seam ─────────────────────────────────────────────────────────────
//
// verifyAttestation has exactly one impure collaborator:
// findCoverageSessionDumpsByBuildSha. Substituting it at the module boundary is
// what lets the reason assembly be driven without a live coverage database
//. Bare factory + relative specifier WITH the .js extension,
// matching the source import exactly — see requireAiTokenBudget.test.ts, the
// closest existing analogue in this workspace.
vi.mock('../services/coverageSessionService.js', () => ({
  findCoverageSessionDumpsByBuildSha: vi.fn(),
}));

// coverageDb is mocked as a FORWARD GUARD, not because the import would
// otherwise open a connection. `new pg.Pool()` is lazy — it opens no socket
// until query()/connect(), and verifyAttestation calls neither (only main()'s
// finally touches coverageDb.end(), and main() never runs here because
// process.argv[1] is Vitest's worker entry, failing the endsWith() guard in
// verify-test-attestation.ts). Verified: with this mock removed the test still
// passes and the real pool reports totalCount=0. The mock's value is that if
// verifyAttestation ever starts querying directly, the seam surfaces `undefined`
// instead of a unit test silently opening a live connection.
vi.mock('../coverageDb.js', () => ({
  default: { end: vi.fn(async () => undefined) },
}));

import { mkdtemp, rm, writeFile, utimes, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve as resolvePath, isAbsolute, dirname } from 'node:path';

// Imports from junitXml.ts, not verify-test-attestation.ts, which pulls in
// coverageDb (a pg.Pool plus dotenv/config at module load). These are
// pure-function tests, so importing the DB-bound script for them would be
// gratuitous. Note this does NOT make the file runnable without Postgres — the
// suite's globalSetup creates and migrates the test database for every file
// regardless. The import graph is simply honest about what these tests use; the
// spec that genuinely benefits is qa/'s, which has no globalSetup.
//
// The vi.mock calls above are file-scoped and so apply to these describes too.
// That is inert: neither mocked module is in junitXml.ts's import graph.
import {
  parseJUnitResults,
  findTestsSkippedEverywhere,
  findFailedTests,
  hasParseDisagreement,
  type JUnitTestCase,
} from '../scripts/junitXml.js';

import {
  verifyAttestation,
  formatFailureOutput,
  readSelectionFiles,
  parseArgs,
  MissingArgsError,
  InvalidArgError,
  ATTESTATION_FAILURE_REASONS,
  type AttestationResult,
  type CliArgs,
} from '../scripts/verify-test-attestation.js';
import { findCoverageSessionDumpsByBuildSha } from '../services/coverageSessionService.js';
import type { CoverageSessionDump } from '@minicrm/shared/schemas/coverageSessionSchema.js';

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

// ── verifyAttestation harness ──────────────────────────────────

/**
 * Repo root, for the docs-parity assertion below. Named rather than inlined so
 * the three-level climb out of server/src/__tests__/ appears once — matching
 * selectTests.test.ts:15, the existing precedent in this directory.
 */
const REPO_ROOT = resolvePath(__dirname, '../../..');

const mockFindDumps = vi.mocked(findCoverageSessionDumpsByBuildSha);

/**
 * Runs the gate and asserts its central invariant — `passed` is true exactly
 * when `reasons` is empty — before handing the result back for reason-specific
 * assertions.
 *
 * Every test below calls this rather than verifyAttestation directly, because
 * `passed` (not `reasons`) is the field both consumers actually branch on:
 * scripts/pre-push-tia.ts blocks the push on `!attestation.passed`, and this
 * script's own main() sets a non-zero exit code from it, which is what gates
 * record mode's coverage-map export. A suite that only asserts `reasons` cannot
 * fail when the gate stops blocking — verified: a mutation returning
 * `passed: reasons.every(r => r === 'test-failures' || ...)`, i.e. attesting a
 * run whose tests FAILED, passed all 96 tests before this helper existed.
 *
 */
async function attest(args: CliArgs): Promise<AttestationResult> {
  const result = await verifyAttestation(args);
  expect(result.passed).toBe(result.reasons.length === 0);
  return result;
}

/** Temp directory for the results/selection files each test writes. */
let attestationDir: string;

/**
 * Set up per-test filesystem and mock state for the describes that exercise
 * verify-test-attestation.ts. Called from an outer describe rather than at file
 * scope so the ~55 pure junitXml.ts tests above do not each pay a temp-directory
 * create plus recursive delete they never touch.
 */
function useAttestationFixtures(): void {
  beforeEach(async () => {
    attestationDir = await mkdtemp(join(tmpdir(), 'minicrm-attestation-test-'));

    // resetAllMocks, NOT clearAllMocks. clearAllMocks resets call history but
    // leaves implementations set via mockResolvedValue in place, so a test that
    // sets no return value silently inherits the previous test's — verified, it
    // leaks. That is fatal here specifically because AC 1 requires asserting a
    // reason is ABSENT, and an absent-assertion driven by a leaked
    // implementation is a green test that proves nothing. (Precedent exists —
    // ssoController.test.ts and client/src/hooks/usePermissions.test.ts both use
    // resetAllMocks; the nearest analogue for the mock shape here,
    // requireAiTokenBudget.test.ts, uses clearAllMocks, which is safe there only
    // because every one of its tests sets its own return value.)
    vi.resetAllMocks();

    // Explicit baseline: no attributed dumps. Every test asserting an exact
    // `reasons` array for some OTHER reason must override this with a non-empty
    // value, or 'no-session-attribution' joins the array and the assertion is
    // simply wrong. See attestedDumps() below.
    mockFindDumps.mockResolvedValue([]);
  });

  afterEach(async () => {
    await rm(attestationDir, { recursive: true, force: true });
  });
}

/**
 * Writes the results XML the per-test attestArgs() already points at. The
 * filename is fixed deliberately: a caller-chosen name would just produce
 * 'results-file-missing' unless attestArgs were overridden to match, which is a
 * footgun rather than a feature.
 */
async function writeResults(xml: string): Promise<string> {
  const path = join(attestationDir, 'results.xml');
  await writeFile(path, xml, 'utf8');
  return path;
}

/** Writes a selection JSON file (raw string, so malformed input is expressible). */
async function writeSelection(raw: string): Promise<string> {
  const path = join(attestationDir, 'selection.json');
  await writeFile(path, raw, 'utf8');
  return path;
}

/**
 * Writes the results half of the "every reason at once" fixture: a stale results
 * file that is simultaneously failing, skipping, under-parsed (9 declared vs 2
 * recovered) and — via the beforeEach baseline of no attributed dumps —
 * unattributed.
 *
 * Named rather than inlined because the interesting part of a consuming test is
 * its assertion, not the twelve lines of XML and utimes needed to provoke every
 * reason at once.
 *
 * Deliberately does NOT write the selection file, and returns nothing.
 * added a reason that is mutually exclusive with
 * missing-required-tests, so the two maximal-reason tests need DIFFERENT
 * selections — one readable and unsatisfied, one unreadable. An earlier version
 * of this helper returned the selection path it wrote, which made it unusable
 * for the second case (whose whole point is a path with no file at it).
 */
async function writeEveryReasonResults(): Promise<void> {
  const path =
    await writeResults(`<testsuites id="" name="" tests="9" failures="1" skipped="1" errors="0" time="0.1">
<testsuite name="a.spec.ts" hostname="desktop" tests="9" failures="1" skipped="1" errors="0" time="0.1">
<testcase name="fails" classname="qa/e2e/tests/apps/minicrm/functional/a.spec.ts" time="0.1">
<failure message="boom" type="AssertionError">stack</failure>
</testcase>
<testcase name="never runs" classname="qa/e2e/tests/apps/minicrm/functional/a.spec.ts">
<skipped>
</skipped>
</testcase>
</testsuite>
</testsuites>`);
  const staleTime = new Date(Date.now() - 500 * 60_000);
  await utimes(path, staleTime, staleTime);
}

/**
 * Builds a CoverageSessionDump — all nine fields, testFile deliberately
 * nullable. IDs are valid hex so the fixture stays usable if it is ever routed
 * through coverageSessionDumpSchema (it is not today; the lookup is mocked).
 */
function dump(overrides: Partial<CoverageSessionDump> = {}): CoverageSessionDump {
  return {
    id: '00000000-0000-0000-0000-0000000000d1',
    sessionId: '00000000-0000-0000-0000-00000000005a',
    dumpId: '00000000-0000-0000-0000-0000000000e1',
    correlationId: '00000000-0000-0000-0000-0000000000c1',
    testId: 'test-1',
    testName: 'a test',
    testFile: 'qa/e2e/tests/apps/minicrm/functional/a.spec.ts',
    attempt: 0,
    recordedAt: '2026-07-30T00:00:00.000Z',
    ...overrides,
  };
}

/**
 * Sets the mocked dump lookup to a non-empty result, so 'no-session-attribution'
 * does NOT fire and a test can assert an exact `reasons` array for the reason it
 * actually cares about. Required by every reason test except
 * 'no-session-attribution' itself and 'results-file-missing'.
 */
function attestedDumps(...testFiles: string[]): void {
  const files =
    testFiles.length > 0 ? testFiles : ['qa/e2e/tests/apps/minicrm/functional/a.spec.ts'];
  // Distinct id/dumpId per entry — nothing here reads them, but dump()'s
  // docblock promises schema-valid fixtures, and rows sharing a primary key
  // would defeat that the moment one is routed through coverageSessionDumpSchema.
  mockFindDumps.mockResolvedValue(
    files.map((testFile, index) =>
      dump({
        testFile,
        id: `00000000-0000-0000-0000-0000000000${String(index).padStart(2, 'd')}`,
        dumpId: `00000000-0000-0000-0000-0000000000${String(index).padStart(2, 'e')}`,
      }),
    ),
  );
}

/** Builds CliArgs pointing at the per-test temp dir, with a fresh-file default age. */
function attestArgs(overrides: Partial<CliArgs> = {}): CliArgs {
  return {
    resultsPath: join(attestationDir, 'results.xml'),
    selectionPath: undefined,
    sha: 'deadbeefcafe',
    maxAgeMinutes: 120,
    ...overrides,
  };
}

/** A minimal all-passing single-project results document. */
const PASSING_XML = `<testsuites id="" name="" tests="1" failures="0" skipped="0" errors="0" time="0.1">
<testsuite name="a.spec.ts" timestamp="2026-07-30T00:00:00.000Z" hostname="desktop" tests="1" failures="0" skipped="0" time="0.1" errors="0">
<testcase name="a test" classname="qa/e2e/tests/apps/minicrm/functional/a.spec.ts" time="0.1">
</testcase>
</testsuite>
</testsuites>`;

/**
 * A two-project run where each test passes under exactly one project and skips
 * under the other — the shape record mode actually produces, and the one the
 * reconciliation rule exists for. The union covers both tests, so
 * this document is attestable: no test is skipped everywhere.
 *
 * <testsuites skipped="2"> is legitimately non-zero here, and both skips are
 * recovered, so hasParseDisagreement stays false.
 */
const MULTI_PROJECT_XML = `<testsuites id="" name="" tests="4" failures="0" skipped="2" errors="0" time="1.4">
<testsuite name="probe.spec.ts" timestamp="2026-07-30T00:00:00.000Z" hostname="desktop" tests="2" failures="0" skipped="1" time="0.37" errors="0">
<testcase name="desktop only" classname="qa/e2e/tests/apps/minicrm/functional/probe.spec.ts" time="0.07">
</testcase>
<testcase name="mobile only" classname="qa/e2e/tests/apps/minicrm/functional/probe.spec.ts">
<properties>
<property name="skip" value="mobile-only probe">
</property>
</properties>
<skipped>
</skipped>
</testcase>
</testsuite>
<testsuite name="probe.spec.ts" timestamp="2026-07-30T00:00:00.000Z" hostname="mobile-web" tests="2" failures="0" skipped="1" time="0.25" errors="0">
<testcase name="desktop only" classname="qa/e2e/tests/apps/minicrm/functional/probe.spec.ts">
<properties>
<property name="skip" value="desktop-only probe">
</property>
</properties>
<skipped>
</skipped>
</testcase>
<testcase name="mobile only" classname="qa/e2e/tests/apps/minicrm/functional/probe.spec.ts" time="0.08">
</testcase>
</testsuite>
</testsuites>`;

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

  // the gate reconciles a test's outcome across projects, which
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
    // Shares MULTI_PROJECT_XML with the verifyAttestation tests below: this is
    // the parser's view of the same document whose gate outcome they assert, so
    // one fixture keeps the two layers describing the same run rather than two
    // documents that can drift apart.
    const result = parseJUnitResults(MULTI_PROJECT_XML);

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

  // captured console output can contain text that looks like
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

  it('attributes rows correctly when a self-closing <testsuite/> precedes a populated one', () => {
    // A self-closing suite that is not recognized as a region lets the NEXT
    // match's non-greedy body start at the self-closing tag and run to the
    // populated suite's </testsuite>, collapsing both into one region — so every
    // row inside gets the FIRST suite's hostname, i.e. the wrong Playwright
    // project. That feeds findTestsSkippedEverywhere's cross-project attestation,
    // where a mis-attributed row can attest a skip that never passed anywhere.
    // Today's reporter never self-closes; this pins the parse either way.
    const xml = `<testsuites id="" name="" tests="2" failures="1" skipped="0" errors="0" time="0.2">
<testsuite name="empty.spec.ts" timestamp="2026-07-29T00:00:00.000Z" hostname="mobile-web" tests="0" failures="0" skipped="0" errors="0" time="0"/>
<testsuite name="b.spec.ts" timestamp="2026-07-29T00:00:00.000Z" hostname="desktop" tests="2" failures="1" skipped="0" errors="0" time="0.2">
<testcase name="fails" classname="apps/minicrm/functional/b.spec.ts" time="0.1">
<failure message="boom" type="AssertionError">stack</failure>
</testcase>
<testcase name="passes" classname="apps/minicrm/functional/b.spec.ts" time="0.1">
</testcase>
</testsuite>
</testsuites>`;

    const result = parseJUnitResults(xml);

    expect(result.testCases).toHaveLength(2);
    expect(result.testCases.map((t) => t.project)).toEqual(['desktop', 'desktop']);
    expect(hasParseDisagreement(result)).toBe(false);
  });
});

// the cross-project reconciliation rule is the substance of the
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

  // "Passed in at least one PROJECT RUN" — a pass cannot attest a skip of the
  // same test in the SAME project. Playwright emits one row per
  // (test, project) so this cannot arise from its reporter, but a malformed
  // or hand-merged results file must not exploit a looser key.
  it('does not let a pass attest a skip of the same test in the same project', () => {
    const cases = [
      testCase({ name: 'contradiction', project: 'desktop', passed: true }),
      testCase({ name: 'contradiction', project: 'desktop', skipped: true }),
    ];

    expect(findTestsSkippedEverywhere(cases)).toEqual([
      { classname: 'a.spec.ts', name: 'contradiction' },
    ]);
  });

  // An orphan row (swept up outside any <testsuite>) has project '' — its
  // provenance is unknown, so it must not attest anything. Mirrors the
  // orphan sweep's own refusal to let a suite row mask an orphan <failure>.
  it('does not let an unattributed passing row mask a real skip', () => {
    const cases = [
      testCase({ name: 'ambiguous', project: '', passed: true }),
      testCase({ name: 'ambiguous', project: 'desktop', skipped: true }),
    ];

    expect(findTestsSkippedEverywhere(cases)).toEqual([
      { classname: 'a.spec.ts', name: 'ambiguous' },
    ]);
  });

  // testCaseKey joins on NUL precisely so these two do not collide. A space
  // separator would make both ("a.spec.ts", "b c") and ("a.spec.ts b", "c")
  // hash to "a.spec.ts b c", letting the passing one attest the skipped one.
  it('does not collide two tests whose classname/name split differs by a space', () => {
    const cases = [
      testCase({ classname: 'a.spec.ts', name: 'b c', passed: true }),
      testCase({ classname: 'a.spec.ts b', name: 'c', skipped: true }),
    ];

    expect(findTestsSkippedEverywhere(cases)).toEqual([{ classname: 'a.spec.ts b', name: 'c' }]);
  });

  // Guards the scope limitation stated in the module docblock: the rule
  // reconciles what the results file CONTAINS. A single-project run is not
  // weakened by the change — a test skipped there passed nowhere, so it is
  // still reported exactly as it was before that change.
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

// an ALL-PASS gate must never discard evidence of a failure.
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

  // PR review: CDATA content is not markup, so it is removed
  // before any structural scan. Without that, a payload could both END a match
  // early (dropping rows) and OPEN one (fabricating a testcase that never
  // ran). These cover the class rather than one variant of it.
  it.each([
    ['its own closing tag', '<![CDATA[output containing </failure> here]]>'],
    ['another element closing tag', '<![CDATA[output containing </system-out> here]]>'],
    ['a testsuite closing tag', '<![CDATA[output containing </testsuite> here]]>'],
    ['a testcase closing tag', '<![CDATA[output containing </testcase> here]]>'],
    [
      'a split CDATA section (Playwright escaping a literal ]]>)',
      '<![CDATA[a ]]]]><![CDATA[> b </failure></testsuite>]]>',
    ],
    [
      'a complete fake testcase',
      '<![CDATA[</failure></testcase></testsuite><testcase name="phantom" classname="fake.spec.ts">]]>',
    ],
  ])('is not corrupted by a <failure> body containing %s', (_label, body) => {
    const xml = `<testsuites tests="2" failures="1" skipped="0" errors="0">
<testsuite name="a.spec.ts" hostname="desktop" tests="2" failures="1" skipped="0" errors="0">
<testcase name="t1" classname="a.spec.ts"><failure message="REAL FAILURE">${body}</failure></testcase>
<testcase name="t2" classname="a.spec.ts"></testcase>
</testsuite>
</testsuites>`;

    const result = parseJUnitResults(xml);

    // Exactly the two real rows — no row dropped, no phantom row invented.
    expect(result.testCases.map((t) => t.name)).toEqual(['t1', 't2']);
    expect(hasParseDisagreement(result)).toBe(false);
    expect(findFailedTests(result.testCases)).toEqual([
      { classname: 'a.spec.ts', name: 't1', message: 'REAL FAILURE' },
    ]);
  });

  // Regression guard for strip ORDERING: when the CDATA-bodied elements were
  // stripped in two sequential passes, a <failure> body containing the literal
  // text "<system-out>" opened a region the system-out pass then swallowed
  // across </failure> and </testcase>, dropping every later row.
  it('does not drop rows when a <failure> body mentions <system-out>', () => {
    const xml = `<testsuites tests="2" failures="1" skipped="0" errors="0">
<testsuite name="a.spec.ts" hostname="desktop" tests="2" failures="1" skipped="0" errors="0">
<testcase name="t1" classname="a.spec.ts"><failure message="REAL FAILURE"><![CDATA[snippet mentioning <system-out> tag]]></failure></testcase>
<testcase name="t2" classname="a.spec.ts"><system-out><![CDATA[ok]]></system-out></testcase>
</testsuite>
</testsuites>`;

    const result = parseJUnitResults(xml);

    expect(result.testCases).toHaveLength(2);
    expect(result.testCases.map((t) => t.name)).toEqual(['t1', 't2']);
    expect(findFailedTests(result.testCases)).toEqual([
      { classname: 'a.spec.ts', name: 't1', message: 'REAL FAILURE' },
    ]);
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

// this is the last line of defense for a document this
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

  // A count comparison, not a presence check: a <skipped> element missed
  // inside an otherwise-recovered row leaves the row count matching, so the
  // row-count predicate cannot see it.
  it('reports a skip-count mismatch even when some skips were recovered', () => {
    expect(
      hasParseDisagreement(
        parsed({
          totalTests: 2,
          totalSkipped: 2,
          testCases: [
            testCase({ name: 'a', skipped: true }),
            testCase({ name: 'b', passed: true }),
          ],
        }),
      ),
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

// the seam itself. Everything below in later phases depends on
// verifyAttestation being reachable from a unit test at all, which it was not
// before this — the module was considered un-importable because it pulls in
// coverageDb. It is importable; the pool is lazy. This test pins that property
// so a future change that makes the module genuinely DB-bound at import time
// fails here, next to the explanation, rather than as a timeout somewhere else.
describe('verify-test-attestation.ts', () => {
  useAttestationFixtures();

  describe('verifyAttestation — mocked DB seam', () => {
    it('runs without a live coverage database and reports a missing results file', async () => {
      const result = await attest(
        attestArgs({ resultsPath: join(attestationDir, 'never-written.xml') }),
      );

      expect(result.reasons).toEqual(['results-file-missing']);
      // The lookup is never reached — the missing-file branch returns first.
      expect(mockFindDumps).not.toHaveBeenCalled();
    });
  });

  // the reason assembly itself — which predicate maps to
  // which reason. Every reason below is asserted BOTH ways: produced by the
  // condition that should produce it, and absent when it should not be.
  //
  // Every test asserting an exact `reasons` array first calls attestedDumps(), or
  // the beforeEach baseline of [] adds 'no-session-attribution' and the assertion
  // is wrong rather than merely imprecise. The two exceptions are the
  // no-session-attribution tests themselves and results-file-missing, which
  // returns before the lookup.
  describe('verifyAttestation — reason assembly', () => {
    describe('results-file-missing', () => {
      it('reports a nonexistent results file and returns a fully zeroed result', async () => {
        const result = await attest(
          attestArgs({ resultsPath: join(attestationDir, 'absent.xml') }),
        );

        // A distinct early return from the main path, so its whole shape is
        // pinned here rather than only its reason.
        expect(result).toEqual({
          passed: false,
          reasons: ['results-file-missing'],
          totalTests: 0,
          parsedTestCount: 0,
          failedTests: [],
          skippedTests: [],
          missingRequiredFiles: [],
          // Null, not a cause: this return happens before the selection is read
          // at all, so there is nothing to report about it.
          selectionUnreadableReason: null,
          ranFileCount: 0,
        });
      });

      // No "absent" test of its own: the early return hardcodes this reason, so
      // there is no reachable path where the file exists and it still appears.
      // Every other test in this describe asserts an exact `reasons` array and
      // would fail if it leaked in, which covers the negative direction.
    });

    describe('results-file-stale', () => {
      it('reports a results file older than the staleness window', async () => {
        attestedDumps();
        const path = await writeResults(PASSING_XML);
        const staleTime = new Date(Date.now() - 200 * 60_000);
        await utimes(path, staleTime, staleTime);

        const result = await attest(attestArgs({ maxAgeMinutes: 120 }));

        expect(result.reasons).toEqual(['results-file-stale']);
        expect(result.passed).toBe(false);
      });

      it('does not report a freshly written results file', async () => {
        attestedDumps();
        await writeResults(PASSING_XML);

        const result = await attest(attestArgs({ maxAgeMinutes: 120 }));

        expect(result.reasons).toEqual([]);
      });

      // The boundary itself: `ageMinutes > maxAgeMinutes` is exclusive, so a
      // file aged EXACTLY to the window is fresh. Flipping > to >= leaves every
      // other staleness test green, because they all sit clear of the boundary.
      //
      // Hitting it exactly needs a frozen clock. The gate derives age from
      // Date.now() at read time, which under a live clock is always strictly
      // later than the Date.now() used to backdate the file — so a wall-clock
      // fixture lands just under or just over, never on (measured: 0.999850 of
      // a 1-minute window for a 59_990ms backdate, where both operators agree).
      // vi.useFakeTimers pins both reads to the same instant, making the
      // equal-age case exact and deterministic rather than a race.
      // (Precedent: notificationService.test.ts:315,345.)
      it('treats a file aged exactly to the staleness window as fresh', async () => {
        attestedDumps();
        const path = await writeResults(PASSING_XML);
        const maxAgeMinutes = 120;
        const now = new Date('2026-07-30T12:00:00.000Z');
        const exactlyAtWindow = new Date(now.getTime() - maxAgeMinutes * 60_000);
        // utimes must happen on the real clock; only the gate's Date.now() reads
        // are frozen, so the two cannot drift apart between them.
        await utimes(path, exactlyAtWindow, exactlyAtWindow);

        vi.useFakeTimers();
        vi.setSystemTime(now);
        try {
          const result = await attest(attestArgs({ maxAgeMinutes }));

          expect(result.reasons).toEqual([]);
        } finally {
          vi.useRealTimers();
        }
      });

      // One millisecond past it is stale — the other side of the same boundary,
      // so the pair pins the operator rather than just the general behavior.
      it('treats a file one millisecond older than the window as stale', async () => {
        attestedDumps();
        const path = await writeResults(PASSING_XML);
        const maxAgeMinutes = 120;
        const now = new Date('2026-07-30T12:00:00.000Z');
        const justPastWindow = new Date(now.getTime() - maxAgeMinutes * 60_000 - 1);
        await utimes(path, justPastWindow, justPastWindow);

        vi.useFakeTimers();
        vi.setSystemTime(now);
        try {
          const result = await attest(attestArgs({ maxAgeMinutes }));

          expect(result.reasons).toEqual(['results-file-stale']);
        } finally {
          vi.useRealTimers();
        }
      });

      // The window is a parameter, not a constant: a file inside the default
      // 120-minute window is still stale under a tighter --max-age-minutes.
      it('honors a narrowed staleness window', async () => {
        attestedDumps();
        const path = await writeResults(PASSING_XML);
        const tenMinutesAgo = new Date(Date.now() - 10 * 60_000);
        await utimes(path, tenMinutesAgo, tenMinutesAgo);

        const result = await attest(attestArgs({ maxAgeMinutes: 5 }));

        expect(result.reasons).toEqual(['results-file-stale']);
      });
    });

    describe('test-failures', () => {
      it('reports a testcase carrying a <failure>', async () => {
        attestedDumps();
        await writeResults(`<testsuites id="" name="" tests="1" failures="1" skipped="0" errors="0" time="0.1">
<testsuite name="a.spec.ts" hostname="desktop" tests="1" failures="1" skipped="0" errors="0" time="0.1">
<testcase name="a test" classname="qa/e2e/tests/apps/minicrm/functional/a.spec.ts" time="0.1">
<failure message="expected 200, received 500" type="AssertionError">stack</failure>
</testcase>
</testsuite>
</testsuites>`);

        const result = await attest(attestArgs());

        expect(result.reasons).toEqual(['test-failures']);
        expect(result.failedTests).toEqual([
          {
            classname: 'qa/e2e/tests/apps/minicrm/functional/a.spec.ts',
            name: 'a test',
            message: 'expected 200, received 500',
          },
        ]);
      });

      // The condition is a three-way ||; the reporter-total arms are reachable
      // independently of any parsed failure row. Shape chosen so the row count
      // (1 declared, 1 recovered) and skip count (0/0) both AGREE — otherwise
      // hasParseDisagreement fires too and this would prove two reasons at once
      // rather than isolating the || arm.
      it('reports a reporter-declared failure with no failing row parsed', async () => {
        attestedDumps();
        await writeResults(`<testsuites id="" name="" tests="1" failures="1" skipped="0" errors="0" time="0.1">
<testsuite name="a.spec.ts" hostname="desktop" tests="1" failures="0" skipped="0" errors="0" time="0.1">
<testcase name="a test" classname="qa/e2e/tests/apps/minicrm/functional/a.spec.ts" time="0.1">
</testcase>
</testsuite>
</testsuites>`);

        const result = await attest(attestArgs());

        expect(result.reasons).toEqual(['test-failures']);
        // Nothing was parsed as failed — the reason came from the declared total.
        expect(result.failedTests).toEqual([]);
      });

      it('reports a reporter-declared error identically', async () => {
        attestedDumps();
        await writeResults(`<testsuites id="" name="" tests="1" failures="0" skipped="0" errors="1" time="0.1">
<testsuite name="a.spec.ts" hostname="desktop" tests="1" failures="0" skipped="0" errors="0" time="0.1">
<testcase name="a test" classname="qa/e2e/tests/apps/minicrm/functional/a.spec.ts" time="0.1">
</testcase>
</testsuite>
</testsuites>`);

        const result = await attest(attestArgs());

        expect(result.reasons).toEqual(['test-failures']);
      });

      it('does not report an all-passing run', async () => {
        attestedDumps();
        await writeResults(PASSING_XML);

        const result = await attest(attestArgs());

        expect(result.reasons).toEqual([]);
        expect(result.failedTests).toEqual([]);
      });
    });

    describe('skipped-tests', () => {
      it('reports a test skipped in every project that ran', async () => {
        attestedDumps();
        await writeResults(`<testsuites id="" name="" tests="1" failures="0" skipped="1" errors="0" time="0.1">
<testsuite name="a.spec.ts" hostname="desktop" tests="1" failures="0" skipped="1" errors="0" time="0.1">
<testcase name="never runs" classname="qa/e2e/tests/apps/minicrm/functional/a.spec.ts">
<skipped>
</skipped>
</testcase>
</testsuite>
</testsuites>`);

        const result = await attest(attestArgs());

        expect(result.reasons).toEqual(['skipped-tests']);
        expect(result.skippedTests).toEqual([
          { classname: 'qa/e2e/tests/apps/minicrm/functional/a.spec.ts', name: 'never runs' },
        ]);
      });

      // The reconciliation rule reaching the gate: a viewport-
      // conditional test skipped under one project but passing under another is
      // attested, so this reason must NOT fire. This is the case that made the
      // gate satisfiable for the multi-project run record mode needs.
      it('does not report a test skipped in one project but passing in another', async () => {
        attestedDumps();
        await writeResults(MULTI_PROJECT_XML);

        const result = await attest(attestArgs());

        expect(result.reasons).toEqual([]);
        expect(result.skippedTests).toEqual([]);
      });
    });

    describe('zero-tests-executed', () => {
      it('fails a well-formed results file that reports zero tests', async () => {
        attestedDumps();
        await writeResults(
          `<testsuites id="" name="" tests="0" failures="0" skipped="0" errors="0" time="0">
</testsuites>`,
        );

        const result = await attest(attestArgs());

        // Before this reason existed the gate returned NO reasons here: every
        // other check operates on rows that exist, and hasParseDisagreement is
        // guarded on totalTests > 0. An empty run attested clean.
        expect(result.reasons).toEqual(['zero-tests-executed']);
        expect(result.passed).toBe(false);
      });

      it('does not fire when tests actually ran', async () => {
        attestedDumps();
        await writeResults(`<testsuites id="" name="" tests="1" failures="0" skipped="0" errors="0" time="0.1">
<testsuite name="a.spec.ts" hostname="desktop" tests="1" failures="0" skipped="0" errors="0" time="0.1">
<testcase name="a test" classname="qa/e2e/tests/apps/minicrm/functional/a.spec.ts" time="0.1">
</testcase>
</testsuite>
</testsuites>`);

        const result = await attest(attestArgs());

        expect(result.reasons).toEqual([]);
        expect(result.passed).toBe(true);
      });

      it('is not reached when the SHA has no attributed dumps', async () => {
        // no attestedDumps() — no-session-attribution is the honest answer
        // first: with no dumps the gate cannot verify what ran either way, so
        // an empty results file is not the finding to lead with.
        await writeResults(
          `<testsuites id="" name="" tests="0" failures="0" skipped="0" errors="0" time="0">
</testsuites>`,
        );

        const result = await attest(attestArgs());

        expect(result.reasons).toContain('no-session-attribution');
        expect(result.passed).toBe(false);
      });
    });

    describe('results-file-unparseable', () => {
      it('reports a row-count disagreement between the reporter and the parser', async () => {
        attestedDumps();
        await writeResults(`<testsuites id="" name="" tests="40" failures="0" skipped="0" errors="0" time="0.1">
<testsuite name="a.spec.ts" hostname="desktop" tests="40" failures="0" skipped="0" errors="0" time="0.1">
<testcase name="a test" classname="qa/e2e/tests/apps/minicrm/functional/a.spec.ts" time="0.1">
</testcase>
</testsuite>
</testsuites>`);

        const result = await attest(attestArgs());

        expect(result.reasons).toEqual(['results-file-unparseable']);
        expect(result.totalTests).toBe(40);
        expect(result.parsedTestCount).toBe(1);
      });

      // hasParseDisagreement is a two-predicate ||. The row-count predicate is
      // blind to a <skipped> element missed WITHIN an otherwise-recovered row, so
      // the skip-count arm needs its own case: rows agree (2 declared, 2
      // recovered) but only one of two declared skips was recovered.
      it('reports a skip-count disagreement even when the row count agrees', async () => {
        attestedDumps();
        await writeResults(`<testsuites id="" name="" tests="2" failures="0" skipped="2" errors="0" time="0.1">
<testsuite name="a.spec.ts" hostname="desktop" tests="2" failures="0" skipped="2" errors="0" time="0.1">
<testcase name="skipped one" classname="qa/e2e/tests/apps/minicrm/functional/a.spec.ts">
<skipped>
</skipped>
</testcase>
<testcase name="passing one" classname="qa/e2e/tests/apps/minicrm/functional/a.spec.ts" time="0.1">
</testcase>
</testsuite>
</testsuites>`);

        const result = await attest(attestArgs());

        // Exact array, matching every sibling in this block. arrayContaining is
        // a subset check and would stay green while a spurious extra reason
        // leaked in — verified by mutation.
        expect(result.reasons).toEqual(['skipped-tests', 'results-file-unparseable']);
        expect(result.parsedTestCount).toBe(2);
        expect(result.totalTests).toBe(2);
      });

      it('does not report a document whose declared totals match what was recovered', async () => {
        attestedDumps();
        await writeResults(PASSING_XML);

        const result = await attest(attestArgs());

        expect(result.reasons).toEqual([]);
        expect(result.totalTests).toBe(result.parsedTestCount);
      });
    });

    describe('no-session-attribution', () => {
      it('reports a SHA with no attributed coverage-session dumps', async () => {
        // Baseline [] from beforeEach is the condition under test here.
        await writeResults(PASSING_XML);

        const result = await attest(attestArgs({ sha: 'unattributed-sha' }));

        expect(result.reasons).toEqual(['no-session-attribution']);
        expect(mockFindDumps).toHaveBeenCalledWith('unattributed-sha');
        expect(result.ranFileCount).toBe(0);
      });

      it('does not report when dumps are attributed to the SHA', async () => {
        attestedDumps();
        await writeResults(PASSING_XML);

        const result = await attest(attestArgs());

        expect(result.reasons).toEqual([]);
        expect(result.ranFileCount).toBe(1);
      });

      // coverage_session_dumps.test_file is nullable, and the service's SQL
      // filters test_id IS NOT NULL but NOT test_file IS NOT NULL — so a dump
      // with a null testFile genuinely reaches this code. It must not become a
      // phantom entry in the ran-files set.
      it('excludes dumps with a null testFile from ranFileCount', async () => {
        mockFindDumps.mockResolvedValue([
          dump({ testFile: 'qa/e2e/tests/apps/minicrm/functional/a.spec.ts' }),
          dump({ testFile: null }),
        ]);
        await writeResults(PASSING_XML);

        const result = await attest(attestArgs());

        expect(result.reasons).toEqual([]);
        expect(result.ranFileCount).toBe(1);
      });

      // Attribution is what binds the results file to a SHA; the set is deduped,
      // so two dumps of the same file are one ran file.
      it('counts each attributed test file once', async () => {
        attestedDumps('a.spec.ts', 'a.spec.ts', 'b.spec.ts');
        await writeResults(PASSING_XML);

        const result = await attest(attestArgs());

        expect(result.ranFileCount).toBe(2);
      });
    });

    describe('missing-required-tests', () => {
      it('reports required spec files that did not run', async () => {
        attestedDumps('ran.spec.ts');
        await writeResults(PASSING_XML);
        const selectionPath = await writeSelection(
          JSON.stringify({ mode: 'targeted', specFiles: ['ran.spec.ts', 'never-ran.spec.ts'] }),
        );

        const result = await attest(attestArgs({ selectionPath }));

        expect(result.reasons).toEqual(['missing-required-tests']);
        expect(result.missingRequiredFiles).toEqual(['never-ran.spec.ts']);
      });

      // The documented rule: running MORE than required passes. A superset is not
      // a shortfall, and treating it as one would fail every run that batched
      // extra specs alongside the selection.
      it('does not report when the run is a superset of the selection', async () => {
        attestedDumps('ran.spec.ts', 'extra.spec.ts');
        await writeResults(PASSING_XML);
        const selectionPath = await writeSelection(
          JSON.stringify({ mode: 'targeted', specFiles: ['ran.spec.ts'] }),
        );

        const result = await attest(attestArgs({ selectionPath }));

        expect(result.reasons).toEqual([]);
        expect(result.missingRequiredFiles).toEqual([]);
      });

      it('does not report when no selection file was given', async () => {
        attestedDumps('ran.spec.ts');
        await writeResults(PASSING_XML);

        const result = await attest(attestArgs({ selectionPath: undefined }));

        expect(result.reasons).toEqual([]);
        expect(result.missingRequiredFiles).toEqual([]);
      });

      // readSelectionFiles' full-suite short-circuit, reaching the gate. This is
      // the one production path where reconciliation is disabled with no entry in
      // `reasons` — record mode runs the full suite and has nothing targeted to
      // reconcile against — so it is pinned end to end and not only at the helper.
      // specFiles is non-empty and none of it ran: under targeted mode that is a
      // shortfall, under full-suite it must be silent.
      it('does not reconcile a full-suite selection, even when named files did not run', async () => {
        attestedDumps('ran.spec.ts');
        await writeResults(PASSING_XML);
        const selectionPath = await writeSelection(
          JSON.stringify({ mode: 'full-suite', specFiles: ['never-ran.spec.ts'] }),
        );

        const result = await attest(attestArgs({ selectionPath }));

        expect(result.reasons).toEqual([]);
        expect(result.missingRequiredFiles).toEqual([]);
      });

      // An EMPTY targeted selection reconciles and trivially passes — it is a
      // real requirement list, so unlike 'none' it keeps mechanism 2 switched on.
      // Indistinguishable from 'none' in `reasons` (both empty), which is exactly
      // why the distinction is pinned at the helper too.
      it('reconciles an empty targeted selection and passes', async () => {
        attestedDumps('ran.spec.ts');
        await writeResults(PASSING_XML);
        const selectionPath = await writeSelection(
          JSON.stringify({ mode: 'targeted', specFiles: [] }),
        );

        const result = await attest(attestArgs({ selectionPath }));

        expect(result.reasons).toEqual([]);
        expect(result.missingRequiredFiles).toEqual([]);
      });
    });

    // The defect this ticket exists for: before it, every
    // input below produced a PASS with an empty `reasons`, silently disabling
    // mechanism 2 of the gate. Each is asserted to fire the reason AND to sink
    // `passed`, because passing-with-no-reconciliation was the actual bug.
    describe('selection-file-unreadable', () => {
      it.each([
        ['a nonexistent path', undefined],
        ['malformed JSON', '{ not valid json'],
        ['a payload with no specFiles', JSON.stringify({ mode: 'targeted' })],
        [
          'a specFiles containing a non-string',
          JSON.stringify({ mode: 'targeted', specFiles: ['a.spec.ts', 42] }),
        ],
        [
          'a specFiles that is not an array',
          JSON.stringify({ mode: 'targeted', specFiles: 'a.spec.ts' }),
        ],
      ])('fails the gate for %s', async (_label, raw) => {
        attestedDumps('ran.spec.ts');
        await writeResults(PASSING_XML);
        const selectionPath =
          raw === undefined
            ? join(attestationDir, 'no-such-selection.json')
            : await writeSelection(raw);

        const result = await attest(attestArgs({ selectionPath }));

        // The whole run is otherwise healthy — all-passing, fresh, attributed.
        // The unreadable selection alone is decisive, which is the behavior
        // change: this used to be `[]`.
        expect(result.reasons).toEqual(['selection-file-unreadable']);
        expect(result.passed).toBe(false);
        expect(result.selectionUnreadableReason).toEqual(expect.any(String));
      });

      // The negative direction, per the spec's AC 1 discipline: each legitimate
      // "nothing to reconcile" input must NOT produce this reason. These are the
      // cases a naive fix would over-catch.
      it.each([
        ['no selection was given', undefined],
        ['the selection is full-suite', JSON.stringify({ mode: 'full-suite', specFiles: [] })],
        [
          'the selection is targeted and satisfied',
          JSON.stringify({ mode: 'targeted', specFiles: ['ran.spec.ts'] }),
        ],
        [
          'the selection is targeted and empty',
          JSON.stringify({ mode: 'targeted', specFiles: [] }),
        ],
      ])('does not fire when %s', async (_label, raw) => {
        attestedDumps('ran.spec.ts');
        await writeResults(PASSING_XML);
        const selectionPath = raw === undefined ? undefined : await writeSelection(raw);

        const result = await attest(attestArgs({ selectionPath }));

        expect(result.reasons).toEqual([]);
        expect(result.selectionUnreadableReason).toBeNull();
      });

      // Mutual exclusivity, asserted directly rather than left as a property of
      // the maximal-set tests: an unreadable selection cannot also be a shortfall,
      // because there is no requirement list to fall short of.
      it('never co-occurs with missing-required-tests', async () => {
        attestedDumps('ran.spec.ts');
        await writeResults(PASSING_XML);

        const result = await attest(
          attestArgs({ selectionPath: join(attestationDir, 'absent.json') }),
        );

        expect(result.reasons).toContain('selection-file-unreadable');
        expect(result.reasons).not.toContain('missing-required-tests');
        expect(result.missingRequiredFiles).toEqual([]);
      });

      // The documented exception to this branch's own fail-closed rule: the
      // results-file-missing early return fires BEFORE the selection is read, so
      // a run missing both reports only the primary input's failure. Pinned so a
      // later refactor that moves the selection read earlier has to face the
      // choice deliberately.
      it('is not reported when the results file is missing, which returns first', async () => {
        const result = await attest(
          attestArgs({
            resultsPath: join(attestationDir, 'absent.xml'),
            selectionPath: join(attestationDir, 'also-absent.json'),
          }),
        );

        expect(result.reasons).toEqual(['results-file-missing']);
        expect(result.selectionUnreadableReason).toBeNull();
      });
    });

    // AC 2: passed === true only when reasons is empty, driven end to end through
    // the multi-project reconciliation path — each test passes under one project
    // and skips under the other, with matching attributed dumps.
    describe('passed', () => {
      it('is true only when no reason fired, for a reconciled multi-project run', async () => {
        attestedDumps('qa/e2e/tests/apps/minicrm/functional/probe.spec.ts');
        await writeResults(MULTI_PROJECT_XML);

        const result = await attest(attestArgs());

        expect(result.reasons).toEqual([]);
        expect(result.passed).toBe(true);
        // Both projects' rows were read: 4 (test, project) pairs across 2 tests.
        expect(result.totalTests).toBe(4);
        expect(result.parsedTestCount).toBe(4);
        expect(result.skippedTests).toEqual([]);
        expect(result.failedTests).toEqual([]);
        expect(result.ranFileCount).toBe(1);
      });

      // The invariant is passed === (reasons.length === 0), so the interesting
      // case is a run that is otherwise entirely healthy and fails on ONE reason:
      // an all-passing, freshly written, fully parseable results file that simply
      // cannot be bound to the SHA. A single reason must still sink it.
      it('is false when exactly one reason fired, however healthy the rest', async () => {
        await writeResults(MULTI_PROJECT_XML);

        const result = await attest(attestArgs());

        expect(result.reasons).toEqual(['no-session-attribution']);
        expect(result.passed).toBe(false);
        // Everything else about the run was fine — the single reason is decisive.
        expect(result.failedTests).toEqual([]);
        expect(result.skippedTests).toEqual([]);
        expect(result.totalTests).toBe(result.parsedTestCount);
      });
    });

    // Reasons accumulate — the assembly must not short-circuit on the first hit,
    // or an operator fixes one problem only to discover the next on the re-run.
    // This also pins the EMISSION ORDER: FAILURE_MESSAGES' docblock declares its
    // key order to be the order reasons are pushed, and formatFailureOutput
    // derives its section order from that, so the two must not drift.
    // Three reasons can never join this set, for three DIFFERENT structural
    // reasons, and stating each is the point of the cases below:
    //
    //  - results-file-missing returns early, before any other check runs.
    //  - selection-file-unreadable is mutually exclusive with
    //    missing-required-tests: an unreadable selection yields no requirement
    //    list, so missingRequiredFiles is [] and the shortfall cannot fire.
    //  - zero-tests-executed is mutually exclusive with every reason derived
    //    from a test row. This fixture is maximally BROKEN, not empty: it has
    //    failures and skips, so tests plainly ran. A file cannot simultaneously
    //    report zero tests and report failing ones. Its own describe block
    //    covers it directly.
    //
    // So "every reason at once" is really two maximal sets, one per horn of that
    // exclusivity. Both are asserted, and between them every reason appears in a
    // co-occurrence context.
    it('accumulates every applicable reason, in the order FAILURE_MESSAGES declares', async () => {
      await writeEveryReasonResults();
      const selectionPath = await writeSelection(
        JSON.stringify({ mode: 'targeted', specFiles: ['never-ran.spec.ts'] }),
      );

      const result = await attest(attestArgs({ selectionPath }));

      // Derived from the source's own list rather than hardcoded: a literal here
      // would be exactly the drift-prone second copy that
      // ATTESTATION_FAILURE_REASONS exists to eliminate.
      expect(result.reasons).toEqual(
        ATTESTATION_FAILURE_REASONS.filter(
          (reason) =>
            reason !== 'results-file-missing' &&
            reason !== 'selection-file-unreadable' &&
            reason !== 'zero-tests-executed',
        ),
      );
      expect(result.passed).toBe(false);
    });

    // The other horn: same maximally-broken results file, but the selection is
    // unreadable rather than merely unsatisfied. missing-required-tests drops
    // out and selection-file-unreadable takes its place.
    it('accumulates every applicable reason when the selection itself is unreadable', async () => {
      await writeEveryReasonResults();

      const result = await attest(
        attestArgs({ selectionPath: join(attestationDir, 'no-such-selection.json') }),
      );

      expect(result.reasons).toEqual(
        ATTESTATION_FAILURE_REASONS.filter(
          (reason) =>
            reason !== 'results-file-missing' &&
            reason !== 'missing-required-tests' &&
            reason !== 'zero-tests-executed',
        ),
      );
      expect(result.passed).toBe(false);
      expect(result.missingRequiredFiles).toEqual([]);
    });

    // The ordering property has to be checked against a PROPER SUBSET too. In
    // the all-but-one case above, filtering the declared list by what fired is
    // an identity, so that test cannot distinguish "emitted in declared order"
    // from "emitted in the order the checks happen to run". Here only two
    // reasons fire, and they are deliberately NOT adjacent in the declared
    // list — so the filter genuinely reorders, and an assembly that pushed them
    // in check order rather than declared order would differ.
    it('emits a proper subset of reasons in declared order, not push order', async () => {
      // stale (1st declared) + no-session-attribution (6th): everything between
      // them is absent, so the two are non-adjacent in ATTESTATION_FAILURE_REASONS.
      const path = await writeResults(PASSING_XML);
      const staleTime = new Date(Date.now() - 500 * 60_000);
      await utimes(path, staleTime, staleTime);

      const result = await attest(attestArgs());

      expect(result.reasons).toEqual(['results-file-stale', 'no-session-attribution']);
      // And that is exactly the declared order filtered to what fired.
      expect(result.reasons).toEqual(
        ATTESTATION_FAILURE_REASONS.filter((reason) => result.reasons.includes(reason)),
      );
    });
  });

  // the operator-facing message text. This is what a CI reader
  // sees under "[verify-test-attestation] FAILED:", so an empty or missing branch
  // here means a red build with no stated cause.
  describe('formatFailureOutput', () => {
    /** Builds an AttestationResult carrying `reasons` and enough detail to render them. */
    function failedResult(overrides: Partial<AttestationResult> = {}): AttestationResult {
      return {
        passed: false,
        reasons: [],
        totalTests: 40,
        parsedTestCount: 1,
        failedTests: [{ classname: 'a.spec.ts', name: 'a test', message: 'boom' }],
        skippedTests: [{ classname: 'a.spec.ts', name: 'never runs' }],
        missingRequiredFiles: ['never-ran.spec.ts'],
        selectionUnreadableReason: 'is not valid JSON (Unexpected token)',
        ranFileCount: 0,
        ...overrides,
      };
    }

    // Iterates the SOURCE's own key list, not a copy of it. A hand-maintained
    // list here would silently stop covering a newly added reason — which is the
    // exact failure AC 3 exists to prevent, so reproducing it in the test that
    // guards against it would be self-defeating. Registering a reason in
    // FAILURE_MESSAGES is therefore the single action that both satisfies the
    // compiler and enrolls it here.
    it.each(ATTESTATION_FAILURE_REASONS)('produces non-empty output for %s', (reason) => {
      const output = formatFailureOutput(failedResult({ reasons: [reason] }));

      // Not just non-empty — a reason mapped to `() => []` or `() => ['']` would
      // pass a bare truthiness check on the joined string.
      expect(output.trim().length).toBeGreaterThan(0);
    });

    it('names the missing results file', () => {
      expect(formatFailureOutput(failedResult({ reasons: ['results-file-missing'] }))).toContain(
        'No results file found',
      );
    });

    it('tells the operator to re-run when the results file is stale', () => {
      expect(formatFailureOutput(failedResult({ reasons: ['results-file-stale'] }))).toContain(
        'older than the staleness window',
      );
    });

    it('enumerates each failed test with its message', () => {
      const output = formatFailureOutput(
        failedResult({
          reasons: ['test-failures'],
          failedTests: [
            { classname: 'a.spec.ts', name: 'first', message: 'expected 200' },
            { classname: 'b.spec.ts', name: 'second', message: null },
          ],
        }),
      );

      expect(output).toContain('2 test(s) failed:');
      expect(output).toContain('  - a.spec.ts :: first — expected 200');
      // A null message renders the test without a dangling em-dash.
      expect(output).toContain('  - b.spec.ts :: second');
      expect(output).not.toContain('second —');
    });

    it('enumerates each test skipped everywhere', () => {
      const output = formatFailureOutput(
        failedResult({
          reasons: ['skipped-tests'],
          skippedTests: [{ classname: 'a.spec.ts', name: 'never runs' }],
        }),
      );

      expect(output).toContain('1 test(s) skipped in every project that ran');
      expect(output).toContain('  - a.spec.ts :: never runs');
    });

    // The counts are the actionable part — they tell an operator how far the
    // parse fell short, and that this is not a test outcome.
    it('quotes both counts and disclaims a test outcome for an unparseable file', () => {
      const output = formatFailureOutput(
        failedResult({ reasons: ['results-file-unparseable'], totalTests: 40, parsedTestCount: 1 }),
      );

      expect(output).toContain('declares 40 test(s) but 1 row(s) were recovered');
      expect(output).toContain('NOT a test outcome');
    });

    it('points at session management when attribution is missing', () => {
      const output = formatFailureOutput(failedResult({ reasons: ['no-session-attribution'] }));

      expect(output).toContain('No coverage session attribution found');
      expect(output).toContain('COVERAGE_SESSION_MANAGEMENT');
    });

    // The `why` is the actionable part — "could not be read" without saying what
    // was wrong sends an operator to check a path that may be fine. Also
    // disclaims a test outcome, matching results-file-unparseable's treatment of
    // the same class of failure.
    it('names the specific cause and disclaims a test outcome for an unreadable selection', () => {
      const output = formatFailureOutput(
        failedResult({
          reasons: ['selection-file-unreadable'],
          selectionUnreadableReason: 'has no `specFiles` array of strings',
        }),
      );

      expect(output).toContain('has no `specFiles` array of strings');
      expect(output).toContain('NOT a test outcome');
    });

    // The renderer must stay total: formatFailureOutput is exported and takes an
    // arbitrary AttestationResult, so a caller can hand it the reason without the
    // detail. It falls back to generic text rather than printing "undefined".
    it('falls back to generic text when the unreadable cause is absent', () => {
      const output = formatFailureOutput(
        failedResult({
          reasons: ['selection-file-unreadable'],
          selectionUnreadableReason: null,
        }),
      );

      expect(output).toContain('could not be read as a requirement list');
      expect(output).not.toContain('undefined');
      expect(output).not.toContain('null');
    });

    it('enumerates each required file that did not run', () => {
      const output = formatFailureOutput(
        failedResult({
          reasons: ['missing-required-tests'],
          missingRequiredFiles: ['one.spec.ts', 'two.spec.ts'],
        }),
      );

      expect(output).toContain('2 required test file(s) did not run:');
      expect(output).toContain('  - one.spec.ts');
      expect(output).toContain('  - two.spec.ts');
    });

    it('renders every applicable section when several reasons fired', () => {
      const output = formatFailureOutput(
        failedResult({
          reasons: ['results-file-stale', 'test-failures', 'no-session-attribution'],
        }),
      );

      expect(output).toContain('older than the staleness window');
      expect(output).toContain('1 test(s) failed:');
      expect(output).toContain('No coverage session attribution found');
      // Sections are newline-joined, not concatenated.
      expect(output.split('\n').length).toBeGreaterThan(3);
    });

    // This function is exported and so can be handed any AttestationResult, not
    // only the ones verifyAttestation builds. Section order must stay fixed and
    // each section must appear once, regardless of the caller's array — the
    // property the original if-chain had implicitly.
    it('emits sections in a fixed order, once each, regardless of the reasons array', () => {
      const output = formatFailureOutput(
        failedResult({
          reasons: [
            'missing-required-tests',
            'results-file-stale',
            'missing-required-tests',
            'results-file-missing',
          ],
        }),
      );

      const missingIdx = output.indexOf('No results file found');
      const staleIdx = output.indexOf('older than the staleness window');
      const requiredIdx = output.indexOf('required test file(s) did not run');

      // Declaration order, not the order they were passed in.
      expect(missingIdx).toBeGreaterThanOrEqual(0);
      expect(staleIdx).toBeGreaterThan(missingIdx);
      expect(requiredIdx).toBeGreaterThan(staleIdx);
      // The duplicated reason rendered once.
      expect(output.match(/required test file\(s\) did not run/g)).toHaveLength(1);
    });

    it('returns an empty string when no reason fired', () => {
      expect(formatFailureOutput(failedResult({ reasons: [] }))).toBe('');
    });

    // docs/dev/coverage.md's "Reading a failed run" is the operator's index of
    // these reasons, and it had already drifted — three of the seven were
    // missing before that change. Reconciling by hand fixes today and drifts
    // again next PR, which is the reasoning check-env-example-parity.sh and
    // check-sha-pattern-parity.sh already encode for their own invariants. Same
    // shape here: the source list is exported, so the docs are held to it.
    //
    // Limit, stated rather than implied: this checks that each reason is
    // MENTIONED, not that the surrounding prose describes it correctly — a
    // bullet reworded to explain the wrong condition still passes. That is the
    // same class of residue as FAILURE_MESSAGES' `() => []` (the type forces an
    // entry to exist, not to be right). Catching presence catches the drift
    // that actually happened here; judging prose accuracy is a reviewer's job.
    it('documents every failure reason in docs/dev/coverage.md', async () => {
      const doc = await readFile(resolvePath(REPO_ROOT, 'docs/dev/coverage.md'), 'utf8');

      const sectionStart = doc.indexOf('### Reading a failed run');
      expect(sectionStart, 'the "Reading a failed run" section should exist').toBeGreaterThan(-1);
      // Bounded by the next heading of the same level, so a reason mentioned
      // elsewhere in this long document cannot satisfy the check.
      const nextHeading = doc.indexOf('\n### ', sectionStart + 1);
      const section = doc.slice(sectionStart, nextHeading === -1 ? undefined : nextHeading);

      // Only the BULLET LIST counts, not the section's surrounding prose. The
      // paragraph below the list discusses this very guard and names
      // ATTESTATION_FAILURE_REASONS, so a whole-section scan would let prose
      // that merely mentions a reason stand in for documenting it.
      const bullets = section.split('\n').filter((line) => line.startsWith('- '));
      const bulletText = bullets.join('\n');

      const undocumented = ATTESTATION_FAILURE_REASONS.filter(
        (reason) => !bulletText.includes(`\`${reason}\``),
      );

      expect(undocumented, 'reasons missing from the operator troubleshooting list').toEqual([]);
    });
  });

  // rewritten for that work (AC 1, 3, 4, 5). Before
  // every path but one returned null, so "no reconciliation requested"
  // and "the caller asked for reconciliation and this gate could not read the
  // file" were the same value — and the second silently passed the gate. These
  // now pin the three-way union, which is what makes the two distinguishable.
  describe('readSelectionFiles', () => {
    it('reports no requirement when no selection path was given', () => {
      expect(readSelectionFiles(undefined)).toEqual({ kind: 'none' });
    });

    it('returns the spec files of a targeted selection', async () => {
      const path = await writeSelection(
        JSON.stringify({ mode: 'targeted', specFiles: ['a.spec.ts', 'b.spec.ts'] }),
      );

      expect(readSelectionFiles(path)).toEqual({
        kind: 'files',
        files: ['a.spec.ts', 'b.spec.ts'],
      });
    });

    // The short-circuit is ordered BEFORE the array check: full-suite mode means
    // "no targeted requirement to reconcile", even though select-tests.ts always
    // writes specFiles: [] in that mode. A non-empty specFiles here proves the
    // ordering rather than coincidence. (AC 3 — this must stay 'none',
    // NOT become a failure.)
    it('short-circuits full-suite mode even when specFiles is populated', async () => {
      const path = await writeSelection(
        JSON.stringify({ mode: 'full-suite', specFiles: ['a.spec.ts'] }),
      );

      expect(readSelectionFiles(path)).toEqual({ kind: 'none' });
    });

    // AC 4. An empty array IS a requirement list (an empty one), so
    // reconciliation stays ENABLED and trivially passes — materially different
    // from 'none' ("do not reconcile at all") and from 'unreadable' ("could not
    // tell"). Before the union all three were the same value.
    it('reports an empty targeted selection as a real, empty requirement list', async () => {
      const path = await writeSelection(JSON.stringify({ mode: 'targeted', specFiles: [] }));

      expect(readSelectionFiles(path)).toEqual({ kind: 'files', files: [] });
    });

    // Each unreadable input carries a distinct `why`, because a reason an
    // operator cannot act on is only half a report.
    //
    // These assert on text ONLY THE INTERPOLATED err.message can produce — the
    // errno, the parser's position report — never on the wrapper prefix the
    // source hardcodes beside it. Asserting "could not be read" would pass
    // against `why: 'could not be read'` with the cause dropped entirely
    // (verified by mutation: both of these stayed green against gutted
    // templates). The wrapper is not the evidence; the cause is.
    it('reports malformed JSON as unreadable, naming the parse failure', async () => {
      const path = await writeSelection('{ not valid json');

      const result = readSelectionFiles(path);

      expect(result.kind).toBe('unreadable');
      // Node's SyntaxError text varies by version; "position" is the stable part
      // and is present only because err.message was interpolated.
      expect(result).toMatchObject({ why: expect.stringContaining('position') });
    });

    it('reports a nonexistent selection file as unreadable, naming the errno', () => {
      const result = readSelectionFiles(join(attestationDir, 'no-such-file.json'));

      expect(result.kind).toBe('unreadable');
      expect(result).toMatchObject({ why: expect.stringContaining('ENOENT') });
    });

    // The three shape failures share one `why` — the caller's fix is the same in
    // all three cases, so distinguishing them would add words without adding an
    // action.
    it.each([
      ['specFiles is absent', { mode: 'targeted' }],
      ['specFiles contains a non-string', { mode: 'targeted', specFiles: ['a.spec.ts', 42] }],
      ['specFiles is not an array', { mode: 'targeted', specFiles: 'a.spec.ts' }],
    ])('reports unreadable when %s', async (_label, payload) => {
      const path = await writeSelection(JSON.stringify(payload));

      const result = readSelectionFiles(path);

      expect(result.kind).toBe('unreadable');
      expect(result).toMatchObject({ why: expect.stringContaining('specFiles') });
    });

    // A directory is readable-as-a-path but not as a file: readFileSync throws
    // EISDIR rather than ENOENT. Same arm, different errno — and the errno is
    // asserted, because that is the ONLY thing distinguishing this case from the
    // ENOENT test above. Without it, a catch narrowed to `err.code === 'ENOENT'`
    // that reported every other errno as "file not found" would leave this green
    // while the stated invariant went unguarded.
    it('reports a directory given as the selection path as unreadable, naming the errno', () => {
      const result = readSelectionFiles(attestationDir);

      expect(result.kind).toBe('unreadable');
      expect(result).toMatchObject({ why: expect.stringContaining('EISDIR') });
    });
  });

  // parseArgs was the last untested decision point in this file after
  //, and not trivial glue: it sets the anti-cheat staleness window,
  // and two of its behaviors degraded OPEN on bad input — the wrong direction for
  // a gate.
  describe('parseArgs', () => {
    /** The two required flags, so each test states only what it is actually about. */
    const REQUIRED = ['--results=results.xml', '--sha=deadbeef'] as const;

    describe('--max-age-minutes', () => {
      it('defaults to 120 when the flag is absent', () => {
        expect(parseArgs([...REQUIRED]).maxAgeMinutes).toBe(120);
      });

      it('honors a valid narrowed window', () => {
        expect(parseArgs([...REQUIRED, '--max-age-minutes=5']).maxAgeMinutes).toBe(5);
      });

      // Zero is a VALID non-negative integer, not malformed input. The staleness
      // check is `ageMinutes > maxAgeMinutes`, strictly, so 0 means "written this
      // instant" — vanishingly strict but coherent. Accepting it matches
      // merge-junit-results.ts's /^\d+$/ contract.
      it('accepts zero rather than treating it as malformed', () => {
        expect(parseArgs([...REQUIRED, '--max-age-minutes=0']).maxAgeMinutes).toBe(0);
      });

      // The defect this ticket is named for. Each of these previously resolved to
      // the WIDEST window (120) with no signal, so an operator narrowing the
      // window and typoing the value got the opposite of what they asked for.
      // 'abc' → NaN → 120; '5x' → 5 silently; '' → falsy → 120.
      it.each([
        ['non-numeric', 'abc'],
        ['partially numeric', '5x'],
        ['a leading-numeric decimal', '2.9'],
        ['negative', '-5'],
        ['empty', ''],
        ['whitespace', ' 5'],
      ])('throws InvalidArgError for a %s value', (_label, value) => {
        expect(() => parseArgs([...REQUIRED, `--max-age-minutes=${value}`])).toThrow(
          InvalidArgError,
        );
      });

      // The message must name the flag AND the offending value — an operator who
      // typo'd needs to see what was read, not just that something was wrong.
      it('names the flag and the rejected value in the error', () => {
        expect(() => parseArgs([...REQUIRED, '--max-age-minutes=abc'])).toThrow(
          /--max-age-minutes.*non-negative integer.*"abc"/,
        );
      });

      // Fails CLOSED end to end: the parsed narrow window actually reaches the
      // staleness check. parseArgs tested in isolation proves the throw but not
      // that a valid narrowing is honored — and "the operator narrows the window
      // and silently does not get it" is this ticket's entire framing.
      it('feeds a narrowed window through to results-file-stale', async () => {
        attestedDumps();
        const path = await writeResults(PASSING_XML);
        const tenMinutesAgo = new Date(Date.now() - 10 * 60_000);
        await utimes(path, tenMinutesAgo, tenMinutesAgo);

        const args = parseArgs([`--results=${path}`, '--sha=deadbeefcafe', '--max-age-minutes=1']);
        const result = await attest(args);

        expect(args.maxAgeMinutes).toBe(1);
        expect(result.reasons).toEqual(['results-file-stale']);
      });
    });

    // AC 5. The TYPE is asserted, not the message text: a downgrade to a bare
    // Error would keep any message-only assertion green.
    describe('required flags', () => {
      it('throws MissingArgsError when --results is absent', () => {
        expect(() => parseArgs(['--sha=deadbeef'])).toThrow(MissingArgsError);
      });

      it('throws MissingArgsError when --sha is absent', () => {
        expect(() => parseArgs(['--results=results.xml'])).toThrow(MissingArgsError);
      });

      it('throws MissingArgsError when both are absent', () => {
        expect(() => parseArgs([])).toThrow(MissingArgsError);
      });

      // A present-but-empty required flag is as unusable as an absent one, and
      // both forms of `get` return '' for it.
      it('throws MissingArgsError for a bare --sha=', () => {
        expect(() => parseArgs(['--results=results.xml', '--sha='])).toThrow(MissingArgsError);
      });

      // Ordering: the missing-flag check runs BEFORE max-age validation, so an
      // invocation wrong in both ways reports the more fundamental error. Without
      // this, moving the numeric validation earlier would silently change which
      // error AC 5's tests see.
      it('reports a missing --sha ahead of a malformed --max-age-minutes', () => {
        expect(() => parseArgs(['--results=r.xml', '--max-age-minutes=abc'])).toThrow(
          MissingArgsError,
        );
      });
    });

    // AC 6. The reason .split('=').slice(1).join('=') exists. A "simplification"
    // to .split('=')[1] truncates at the first '=', which for a path or a ref
    // yields a DIFFERENT, usually nonexistent one rather than an error.
    describe('values containing "="', () => {
      it('preserves an "=" in the results path', () => {
        const args = parseArgs(['--results=/tmp/build=1/results.xml', '--sha=deadbeef']);

        expect(args.resultsPath).toBe(resolvePath('/tmp/build=1/results.xml'));
      });

      it('preserves an "=" in the sha', () => {
        expect(parseArgs(['--results=r.xml', '--sha=refs/heads/foo=bar']).sha).toBe(
          'refs/heads/foo=bar',
        );
      });

      it('preserves an "=" in the selection path', () => {
        const args = parseArgs([...REQUIRED, '--selection=/tmp/a=b/selection.json']);

        expect(args.selectionPath).toBe(resolvePath('/tmp/a=b/selection.json'));
      });

      it('preserves several "=" in one value', () => {
        expect(parseArgs(['--results=r.xml', '--sha=a=b=c']).sha).toBe('a=b=c');
      });
    });

    // AC 7. Both path flags resolve against the same base. The asymmetry this
    // replaces meant two relative paths in one invocation resolved differently.
    describe('path resolution', () => {
      // isAbsolute, not toBe(resolvePath(...)): comparing against the same
      // path.resolve the implementation calls is tautological — it stays green
      // if resolvePath is deleted from BOTH branches, which is the regression
      // this is meant to catch. Asserting the PROPERTY (absolute, ends with the
      // relative input) constrains the implementation instead of restating it.
      it('resolves a relative --results to an absolute path', () => {
        const { resultsPath } = parseArgs(['--results=rel/results.xml', '--sha=x']);

        expect(isAbsolute(resultsPath)).toBe(true);
        expect(resultsPath.endsWith('/rel/results.xml')).toBe(true);
      });

      it('resolves a relative --selection to an absolute path', () => {
        const { selectionPath } = parseArgs([...REQUIRED, '--selection=rel/selection.json']);

        expect(selectionPath && isAbsolute(selectionPath)).toBe(true);
        expect(selectionPath?.endsWith('/rel/selection.json')).toBe(true);
      });

      // AC 7 proper: the two flags resolve against the SAME base. The asymmetry
      // this replaces meant two relative paths given in one invocation resolved
      // differently — so the property to pin is that their common prefix is
      // identical, which is false under the old code and cannot be satisfied by
      // deleting resolvePath from both.
      it('resolves --results and --selection against the same base', () => {
        const { resultsPath, selectionPath } = parseArgs([
          '--results=rel/results.xml',
          '--sha=x',
          '--selection=rel/selection.json',
        ]);

        expect(dirname(resultsPath)).toBe(dirname(selectionPath ?? ''));
      });

      it('leaves an absolute path unchanged', () => {
        const args = parseArgs([
          '--results=/abs/results.xml',
          '--sha=x',
          '--selection=/abs/s.json',
        ]);

        expect(args.resultsPath).toBe('/abs/results.xml');
        expect(args.selectionPath).toBe('/abs/s.json');
      });

      // An absent --selection must stay undefined, NOT become the CWD — which is
      // what a bare resolvePath(undefined-as-'') would produce, silently turning
      // "no reconciliation requested" into an unreadable directory path and, since
      //, a hard gate failure.
      it('leaves an absent --selection undefined rather than resolving it to the CWD', () => {
        expect(parseArgs([...REQUIRED]).selectionPath).toBeUndefined();
      });

      // A bare `--selection=` is SUPPLIED-but-empty, which is the same shape as
      // the --max-age-minutes empty case above and gets the same treatment:
      // rejected, not silently reinterpreted. Treating it as "absent" would
      // repeat this file's original defect — ignoring an input the caller
      // explicitly provided — and letting it through to resolvePath('') would
      // fail later with an incidental EISDIR from the CWD, naming the wrong
      // problem.
      it('throws InvalidArgError for a bare --selection= rather than treating it as absent', () => {
        expect(() => parseArgs([...REQUIRED, '--selection='])).toThrow(InvalidArgError);
      });

      it('names --selection in the bare-value error', () => {
        expect(() => parseArgs([...REQUIRED, '--selection='])).toThrow(
          /--selection requires a path/,
        );
      });
    });
  });
});
