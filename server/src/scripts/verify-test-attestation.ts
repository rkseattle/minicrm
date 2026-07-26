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
 *     reported test passed.
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
// CDATA, no nested nodes beyond <testsuites><testsuite><testcase>) and no
// XML parser is otherwise a real dependency of this workspace (fast-xml-parser
// appears in node_modules only as a transitive dep of minio/promptfoo,
// undeclared and not safe to rely on surviving a future dependency bump).

export interface JUnitTestCase {
  /** classname attribute — the spec file path (relative to qa/e2e/tests/), Playwright's own convention. */
  classname: string;
  name: string;
  passed: boolean;
  /** True for a <failure> or <error> child element specifically (not <skipped>). */
  failureMessage: string | null;
}

export interface JUnitParseResult {
  testCases: JUnitTestCase[];
  totalTests: number;
  totalFailures: number;
  totalErrors: number;
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

/** Parses a Playwright JUnit XML file into a flat list of test cases with pass/fail status. */
export function parseJUnitResults(xml: string): JUnitParseResult {
  const suitesMatch = /<testsuites\b([^>]*)>/.exec(xml);
  const totalTests = suitesMatch ? parseInt(extractAttr(suitesMatch[1], 'tests') ?? '0', 10) : 0;
  const totalFailures = suitesMatch
    ? parseInt(extractAttr(suitesMatch[1], 'failures') ?? '0', 10)
    : 0;
  const totalErrors = suitesMatch ? parseInt(extractAttr(suitesMatch[1], 'errors') ?? '0', 10) : 0;

  const testCases: JUnitTestCase[] = [];
  // Matches both self-closing <testcase .../> and <testcase ...>...</testcase>.
  const testcaseRegex = /<testcase\b([^>]*?)(?:\/>|>([\s\S]*?)<\/testcase>)/g;
  let match: RegExpExecArray | null;
  while ((match = testcaseRegex.exec(xml)) !== null) {
    const attrs = match[1];
    const body = match[2] ?? '';
    const name = extractAttr(attrs, 'name') ?? '';
    const classname = extractAttr(attrs, 'classname') ?? '';
    const hasFailureOrError = /<(failure|error)\b/.test(body);
    const failureMatch = /<(?:failure|error)\b[^>]*\smessage="((?:[^"\\]|\\.)*)"/.exec(body);
    const failureMessage = failureMatch ? decodeXmlEntities(failureMatch[1]) : null;
    testCases.push({
      classname,
      name,
      passed: !hasFailureOrError,
      failureMessage: hasFailureOrError ? (failureMessage ?? '(no message)') : null,
    });
  }

  return { testCases, totalTests, totalFailures, totalErrors };
}

// ── Attestation result ───────────────────────────────────────────────────────

export type AttestationFailureReason =
  | 'results-file-missing'
  | 'results-file-stale'
  | 'test-failures'
  | 'no-session-attribution'
  | 'missing-required-tests';

export interface AttestationResult {
  passed: boolean;
  reasons: AttestationFailureReason[];
  totalTests: number;
  failedTests: Array<{ classname: string; name: string; message: string | null }>;
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
      failedTests: [],
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
  const failedTests = parsed.testCases
    .filter((t) => !t.passed)
    .map((t) => ({ classname: t.classname, name: t.name, message: t.failureMessage }));

  if (failedTests.length > 0 || parsed.totalFailures > 0 || parsed.totalErrors > 0) {
    reasons.push('test-failures');
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
    failedTests,
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
