/**
 * Unit tests for StepSummaryReporter.
 *
 * Verifies:
 * 1. generateSummary() — stats table, failed section, bullet sections, slow tests
 * 2. onTestEnd() — stat accumulation for passed, failed, flaky, skipped, interrupted
 * 3. onTestEnd() — double-counting prevention on non-final retry attempts
 * 4. onEnd() — slow-test detection against slowThreshold
 * 5. onEnd() — appends markdown to summaryPath when set
 * 6. onEnd() — no file I/O when summaryPath is null (local run)
 * 7. onBegin() — reads slowThreshold from config.reportSlowTests
 * 8. generateSummary() — Quarantine Candidates section when candidates exist.
 * 9. generateSummary() — no Quarantine Candidates section when none exist.
 * 10. HEAL_QUARANTINE_THRESHOLD env var controls section visibility.
 *
 *
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { StepSummaryReporter } from '../../framework/reporting/step-summary-reporter.js';
import type { FullConfig, FullResult, TestCase, TestResult } from '@playwright/test/reporter';
import type { HealTrendsFile } from '../../framework/healing/heal-trends.js';
import { CLEANUP_FAILED_ANNOTATION } from '../../framework/reporting/cleanup-annotations.js';
import {
  setTrendsFileForTesting,
  resetTrendsFileForTesting,
} from '../../framework/healing/heal-trends.js';

// ---------------------------------------------------------------------------
// Minimal stub factories — only the fields each test actually needs.
// ---------------------------------------------------------------------------

function makeTestCase(overrides: {
  title?: string;
  file?: string;
  line?: number;
  retries?: number;
  annotations?: { type: string; description?: string }[];
}): TestCase {
  return {
    title: overrides.title ?? 'a test',
    location: {
      file: overrides.file ?? '/tests/foo.spec.ts',
      line: overrides.line ?? 1,
      column: 0,
    },
    retries: overrides.retries ?? 0,
    // Omitted by default, deliberately: a hand-built TestCase without this
    // field is exactly what the reporter must tolerate, and every other case
    // in this file relies on that.
    ...(overrides.annotations ? { annotations: overrides.annotations } : {}),
  } as unknown as TestCase;
}

function makeResult(overrides: {
  status: TestResult['status'];
  retry?: number;
  duration?: number;
  errors?: TestResult['errors'];
  annotations?: { type: string; description?: string }[];
}): TestResult {
  return {
    status: overrides.status,
    retry: overrides.retry ?? 0,
    duration: overrides.duration ?? 100,
    errors: overrides.errors ?? [],
    // Playwright populates this per attempt; `test.annotations` holds only the
    // LAST attempt's, which is why the reporter reads the result first.
    ...(overrides.annotations ? { annotations: overrides.annotations } : {}),
  } as unknown as TestResult;
}

function makeFullResult(status: FullResult['status'] = 'passed'): FullResult {
  return { status, duration: 5_000 } as unknown as FullResult;
}

// ---------------------------------------------------------------------------
// Helper — construct a reporter with SUMMARY_OUTPUT_PATH pointing at a temp
// file so onEnd() writes output we can inspect.
// ---------------------------------------------------------------------------

function makeReporterWithTmpFile(tmpDir: string): {
  reporter: StepSummaryReporter;
  outputPath: string;
} {
  const outputPath = path.join(tmpDir, 'summary.md');
  process.env['SUMMARY_OUTPUT_PATH'] = outputPath;
  const reporter = new StepSummaryReporter();
  delete process.env['SUMMARY_OUTPUT_PATH'];
  return { reporter, outputPath };
}

// ---------------------------------------------------------------------------
// generateSummary — stats table
// ---------------------------------------------------------------------------

test.describe('StepSummaryReporter — generateSummary stats table', () => {
  test('includes suite heading defaulting to E2E Tests', () => {
    const reporter = new StepSummaryReporter();
    expect(reporter.generateSummary()).toContain('## E2E Tests');
  });

  test('uses SUITE_NAME env var when set', () => {
    process.env['SUITE_NAME'] = 'My Custom Suite';
    const reporter = new StepSummaryReporter();
    delete process.env['SUITE_NAME'];
    expect(reporter.generateSummary()).toContain('## My Custom Suite');
  });

  test('omits run-metadata line entirely outside CI', () => {
    const wasCI = process.env['CI'];
    delete process.env['CI'];
    const reporter = new StepSummaryReporter();
    const summary = reporter.generateSummary();
    if (wasCI !== undefined) process.env['CI'] = wasCI;
    expect(summary).not.toContain('**Branch**');
    expect(summary).not.toContain('**Started**');
  });

  test('includes branch, commit, run link, and timestamp when GITHUB_* env vars are set in CI', () => {
    const originalEnv = {
      CI: process.env['CI'],
      GITHUB_REF_NAME: process.env['GITHUB_REF_NAME'],
      GITHUB_SHA: process.env['GITHUB_SHA'],
      GITHUB_RUN_ID: process.env['GITHUB_RUN_ID'],
      GITHUB_SERVER_URL: process.env['GITHUB_SERVER_URL'],
      GITHUB_REPOSITORY: process.env['GITHUB_REPOSITORY'],
    };
    process.env['CI'] = 'true';
    process.env['GITHUB_REF_NAME'] = 'feature/my-branch';
    process.env['GITHUB_SHA'] = 'abc1234def5678900000000000000000000000';
    process.env['GITHUB_RUN_ID'] = '999888777';
    process.env['GITHUB_SERVER_URL'] = 'https://github.com';
    process.env['GITHUB_REPOSITORY'] = 'example-org/example-repo';

    const reporter = new StepSummaryReporter();
    const summary = reporter.generateSummary();

    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }

    expect(summary).toContain('**Branch**: `feature/my-branch`');
    expect(summary).toContain('**Commit**: `abc1234`');
    expect(summary).toContain(
      '**Run**: [999888777](https://github.com/example-org/example-repo/actions/runs/999888777)',
    );
    expect(summary).toMatch(/\*\*Started\*\*: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  test('degrades gracefully when only some GITHUB_* env vars are set (e.g. no run link without run id)', () => {
    const originalEnv = {
      CI: process.env['CI'],
      GITHUB_REF_NAME: process.env['GITHUB_REF_NAME'],
      GITHUB_SHA: process.env['GITHUB_SHA'],
      GITHUB_RUN_ID: process.env['GITHUB_RUN_ID'],
      GITHUB_SERVER_URL: process.env['GITHUB_SERVER_URL'],
      GITHUB_REPOSITORY: process.env['GITHUB_REPOSITORY'],
    };
    process.env['CI'] = 'true';
    process.env['GITHUB_REF_NAME'] = 'main';
    delete process.env['GITHUB_SHA'];
    delete process.env['GITHUB_RUN_ID'];
    delete process.env['GITHUB_SERVER_URL'];
    delete process.env['GITHUB_REPOSITORY'];

    const reporter = new StepSummaryReporter();
    const summary = reporter.generateSummary();

    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }

    expect(summary).toContain('**Branch**: `main`');
    expect(summary).not.toContain('**Commit**');
    expect(summary).not.toContain('**Run**:');
    expect(summary).toMatch(/\*\*Started\*\*: \d{4}/);
  });

  test('shows zero counts before any tests run', () => {
    const reporter = new StepSummaryReporter();
    const summary = reporter.generateSummary();
    expect(summary).toContain('| Passed | 0 |');
    expect(summary).toContain('| Failed | 0 |');
    expect(summary).toContain('| Flaky | 0 |');
    expect(summary).toContain('| Skipped | 0 |');
    expect(summary).toContain('| Interrupted | 0 |');
    expect(summary).toContain('| **Total** | **0** |');
  });

  test('reflects counts tallied by onTestEnd', () => {
    const reporter = new StepSummaryReporter();
    reporter.onTestEnd(makeTestCase({}), makeResult({ status: 'passed' }));
    reporter.onTestEnd(makeTestCase({}), makeResult({ status: 'passed' }));
    reporter.onTestEnd(makeTestCase({}), makeResult({ status: 'failed' }));
    const summary = reporter.generateSummary();
    expect(summary).toContain('| Passed | 2 |');
    expect(summary).toContain('| Failed | 1 |');
    expect(summary).toContain('| **Total** | **3** |');
  });

  test('formats duration from onEnd into summary', () => {
    const reporter = new StepSummaryReporter();
    reporter.onEnd(makeFullResult());
    // duration is 5000 ms = 5s
    expect(reporter.generateSummary()).toContain('**Duration**: 5s');
  });

  test('formats duration in minutes and seconds', () => {
    const reporter = new StepSummaryReporter();
    reporter.onEnd({ status: 'passed', duration: 125_000 } as unknown as FullResult);
    expect(reporter.generateSummary()).toContain('**Duration**: 2m 5s');
  });

  test('ends with a horizontal rule', () => {
    const reporter = new StepSummaryReporter();
    expect(reporter.generateSummary().trimEnd()).toMatch(/---\s*$/);
  });
});

// ---------------------------------------------------------------------------
// generateSummary — Failed Tests section
// ---------------------------------------------------------------------------

test.describe('StepSummaryReporter — generateSummary failed section', () => {
  test('omits Failed Tests section when there are no failures', () => {
    const reporter = new StepSummaryReporter();
    expect(reporter.generateSummary()).not.toContain('### Failed Tests');
  });

  test('includes collapsible <details> block per failure', () => {
    const reporter = new StepSummaryReporter();
    reporter.onTestEnd(
      makeTestCase({ title: 'login flow', file: '/tests/auth.spec.ts', line: 42 }),
      makeResult({
        status: 'failed',
        errors: [{ message: 'Expected true to be false', stack: 'at auth.spec.ts:42' }],
      }),
    );
    const summary = reporter.generateSummary();
    expect(summary).toContain('### Failed Tests');
    expect(summary).toContain('<details>');
    expect(summary).toContain('login flow');
    expect(summary).toContain('/tests/auth.spec.ts:42');
    expect(summary).toContain('Expected true to be false');
    expect(summary).toContain('</details>');
  });

  test('strips ANSI codes from error messages', () => {
    const reporter = new StepSummaryReporter();
    reporter.onTestEnd(
      makeTestCase({}),
      makeResult({
        status: 'failed',
        errors: [{ message: '\x1B[31mRed error\x1B[0m', stack: '' }],
      }),
    );
    const summary = reporter.generateSummary();
    expect(summary).toContain('Red error');
    expect(summary).not.toContain('\x1B[');
  });

  test('timedOut status is treated as a failure', () => {
    const reporter = new StepSummaryReporter();
    reporter.onTestEnd(makeTestCase({ title: 'slow test' }), makeResult({ status: 'timedOut' }));
    const summary = reporter.generateSummary();
    expect(summary).toContain('### Failed Tests');
    expect(summary).toContain('slow test');
    expect(reporter.generateSummary()).toContain('| Failed | 1 |');
  });
});

// ---------------------------------------------------------------------------
// generateSummary — Flaky and Interrupted bullet sections
// ---------------------------------------------------------------------------

test.describe('StepSummaryReporter — generateSummary bullet sections', () => {
  test('omits Flaky Tests section when there are no flaky tests', () => {
    const reporter = new StepSummaryReporter();
    expect(reporter.generateSummary()).not.toContain('### Flaky Tests');
  });

  test('includes Flaky Tests section with test title when a test passes on retry', () => {
    const reporter = new StepSummaryReporter();
    const test1 = makeTestCase({ title: 'flaky login', retries: 1 });
    // First attempt fails — not the final attempt, should be ignored for tally
    reporter.onTestEnd(test1, makeResult({ status: 'failed', retry: 0 }));
    // Second attempt passes on retry — this IS the final attempt
    reporter.onTestEnd(test1, makeResult({ status: 'passed', retry: 1 }));
    const summary = reporter.generateSummary();
    expect(summary).toContain('### Flaky Tests');
    expect(summary).toContain('- flaky login');
    expect(summary).toContain('| Flaky | 1 |');
    expect(summary).not.toContain('| Failed | 1 |');
  });

  test('omits Cleanup Failures section when nothing leaked', () => {
    const reporter = new StepSummaryReporter();
    reporter.onTestEnd(makeTestCase({ title: 'clean test' }), makeResult({ status: 'passed' }));
    expect(reporter.generateSummary()).not.toContain('### Cleanup Failures');
  });

  test('reports a cleanup failure from a test that PASSED', () => {
    // The case with no other surface: a green run that left a record behind.
    // A failing test is already in the Failed Tests section; this one would be
    // invisible without the annotation.
    const reporter = new StepSummaryReporter();
    reporter.onTestEnd(
      makeTestCase({
        title: 'leaky test',
        annotations: [
          { type: CLEANUP_FAILED_ANNOTATION, description: 'contact 42 was not cleaned up' },
        ],
      }),
      makeResult({ status: 'passed' }),
    );
    const summary = reporter.generateSummary();
    expect(summary).toContain('### Cleanup Failures');
    expect(summary).toContain('leaky test — contact 42 was not cleaned up');
    expect(summary, 'the test itself still passed').toContain('| Passed | 1 |');
  });

  test('reads the cleanup annotation from the RESULT, which is per-attempt', () => {
    // The branch real Playwright takes: `result.annotations` is populated per
    // attempt, while `test.annotations` is overwritten with the last attempt's.
    // Reading only the latter loses a leak from an attempt that was retried.
    const reporter = new StepSummaryReporter();
    reporter.onTestEnd(
      makeTestCase({ title: 'result-annotated test' }),
      makeResult({
        status: 'passed',
        annotations: [
          { type: CLEANUP_FAILED_ANNOTATION, description: 'deal 7 was not cleaned up' },
        ],
      }),
    );
    const summary = reporter.generateSummary();
    expect(summary).toContain('### Cleanup Failures');
    expect(summary).toContain('result-annotated test — deal 7 was not cleaned up');
  });

  test('keeps a leak from a failed attempt that a retry later cleaned', () => {
    // Each attempt creates and tears down its own records, so a passing retry
    // does not undo what attempt 1 left behind. Reporting only the final
    // attempt would drop it entirely — the silent accumulation this guards.
    const reporter = new StepSummaryReporter();
    const flaky = makeTestCase({ title: 'retried test', retries: 1 });

    reporter.onTestEnd(
      flaky,
      makeResult({
        status: 'failed',
        retry: 0,
        annotations: [
          { type: CLEANUP_FAILED_ANNOTATION, description: 'contact 1 was not cleaned up' },
        ],
      }),
    );
    reporter.onTestEnd(flaky, makeResult({ status: 'passed', retry: 1 }));

    const summary = reporter.generateSummary();
    expect(summary, 'the leak from the failed attempt must survive the retry').toContain(
      'retried test (attempt 1) — contact 1 was not cleaned up',
    );
    expect(summary, 'the test itself is reported as flaky, not failed').toContain('| Flaky | 1 |');
  });

  test('ignores annotations of other types', () => {
    // skip/fixme/fail annotations are routine; only a cleanup failure belongs
    // in this section, or the section becomes noise.
    const reporter = new StepSummaryReporter();
    reporter.onTestEnd(
      makeTestCase({
        title: 'skipped-ish test',
        annotations: [{ type: 'skip', description: 'not on mobile' }],
      }),
      makeResult({ status: 'passed' }),
    );
    expect(reporter.generateSummary()).not.toContain('### Cleanup Failures');
  });

  test('omits Interrupted Tests section when none exist', () => {
    const reporter = new StepSummaryReporter();
    expect(reporter.generateSummary()).not.toContain('### Interrupted Tests');
  });

  test('includes Interrupted Tests section with test title', () => {
    const reporter = new StepSummaryReporter();
    reporter.onTestEnd(
      makeTestCase({ title: 'interrupted test' }),
      makeResult({ status: 'interrupted' }),
    );
    const summary = reporter.generateSummary();
    expect(summary).toContain('### Interrupted Tests');
    expect(summary).toContain('- interrupted test');
    expect(summary).toContain('| Interrupted | 1 |');
  });
});

// ---------------------------------------------------------------------------
// generateSummary — Slowest Tests section
// ---------------------------------------------------------------------------

test.describe('StepSummaryReporter — generateSummary slow tests section', () => {
  test('omits Slowest Tests section when no tests exceed the threshold', () => {
    const reporter = new StepSummaryReporter();
    // Default threshold is 120 000 ms; 100 ms is well under it
    reporter.onTestEnd(makeTestCase({}), makeResult({ status: 'passed', duration: 100 }));
    reporter.onEnd(makeFullResult());
    expect(reporter.generateSummary()).not.toContain('### Slowest Tests');
  });

  test('includes Slowest Tests table when a test exceeds the threshold', () => {
    const reporter = new StepSummaryReporter();
    // onBegin can set the threshold; use a low value to make the test fast
    reporter.onBegin(
      { reportSlowTests: { threshold: 1_000, max: 5 } } as unknown as FullConfig,
      { allTests: () => [] } as never,
    );
    reporter.onTestEnd(
      makeTestCase({ title: 'slow scenario' }),
      makeResult({ status: 'passed', duration: 2_000 }),
    );
    reporter.onEnd(makeFullResult());
    const summary = reporter.generateSummary();
    expect(summary).toContain('### Slowest Tests');
    expect(summary).toContain('slow scenario');
    expect(summary).toContain('2s');
  });

  test('sorts slowest tests descending by duration', () => {
    const reporter = new StepSummaryReporter();
    reporter.onBegin(
      { reportSlowTests: { threshold: 500, max: 5 } } as unknown as FullConfig,
      { allTests: () => [] } as never,
    );
    reporter.onTestEnd(
      makeTestCase({ title: 'medium test', file: '/a.spec.ts', line: 1 }),
      makeResult({ status: 'passed', duration: 1_000 }),
    );
    reporter.onTestEnd(
      makeTestCase({ title: 'slowest test', file: '/b.spec.ts', line: 1 }),
      makeResult({ status: 'passed', duration: 3_000 }),
    );
    reporter.onTestEnd(
      makeTestCase({ title: 'fast test', file: '/c.spec.ts', line: 1 }),
      makeResult({ status: 'passed', duration: 600 }),
    );
    reporter.onEnd(makeFullResult());
    const summary = reporter.generateSummary();
    const slowestIdx = summary.indexOf('slowest test');
    const mediumIdx = summary.indexOf('medium test');
    const fastIdx = summary.indexOf('fast test');
    expect(slowestIdx).toBeLessThan(mediumIdx);
    expect(mediumIdx).toBeLessThan(fastIdx);
  });
});

// ---------------------------------------------------------------------------
// onTestEnd — retry double-counting prevention
// ---------------------------------------------------------------------------

test.describe('StepSummaryReporter — onTestEnd retry handling', () => {
  test('does not tally a non-final failed attempt', () => {
    const reporter = new StepSummaryReporter();
    const testCase = makeTestCase({ retries: 1 });
    // retry=0 with retries=1 means there is still a retry remaining — not final
    reporter.onTestEnd(testCase, makeResult({ status: 'failed', retry: 0 }));
    expect(reporter.generateSummary()).toContain('| Failed | 0 |');
  });

  test('tallies the final failed attempt (retry exhausted)', () => {
    const reporter = new StepSummaryReporter();
    const testCase = makeTestCase({ retries: 1 });
    reporter.onTestEnd(testCase, makeResult({ status: 'failed', retry: 0 })); // not final
    reporter.onTestEnd(testCase, makeResult({ status: 'failed', retry: 1 })); // final
    expect(reporter.generateSummary()).toContain('| Failed | 1 |');
  });

  test('skipped tests are always final (no retries possible)', () => {
    const reporter = new StepSummaryReporter();
    reporter.onTestEnd(makeTestCase({}), makeResult({ status: 'skipped' }));
    expect(reporter.generateSummary()).toContain('| Skipped | 1 |');
  });
});

// ---------------------------------------------------------------------------
// onEnd — file output
// ---------------------------------------------------------------------------

test.describe('StepSummaryReporter — onEnd file output', () => {
  test('appends markdown to summaryPath when set', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'step-summary-test-'));
    try {
      const { reporter, outputPath } = makeReporterWithTmpFile(tmpDir);
      reporter.onEnd(makeFullResult());
      const written = fs.readFileSync(outputPath, 'utf-8');
      expect(written).toContain('## E2E Tests');
      expect(written).toContain('| **Total**');
      expect(written).toContain('---');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('appends to an existing file rather than overwriting', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'step-summary-append-test-'));
    try {
      const { reporter, outputPath } = makeReporterWithTmpFile(tmpDir);
      fs.writeFileSync(outputPath, '# Existing content\n', 'utf-8');
      reporter.onEnd(makeFullResult());
      const written = fs.readFileSync(outputPath, 'utf-8');
      expect(written).toContain('# Existing content');
      expect(written).toContain('## E2E Tests');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('writes no file when summaryPath is null', () => {
    // Ensure neither env var is set so summaryPath stays null
    delete process.env['SUMMARY_OUTPUT_PATH'];
    delete process.env['GITHUB_STEP_SUMMARY'];
    const reporter = new StepSummaryReporter();
    // Should not throw and should not write any file
    expect(() => reporter.onEnd(makeFullResult())).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// onBegin — slow threshold from config
// ---------------------------------------------------------------------------

test.describe('StepSummaryReporter — onBegin', () => {
  test('reads slowThreshold from config.reportSlowTests.threshold', () => {
    const reporter = new StepSummaryReporter();
    reporter.onBegin(
      { reportSlowTests: { threshold: 500, max: 5 } } as unknown as FullConfig,
      { allTests: () => [] } as never,
    );
    // A 600 ms test should now appear in slow tests (threshold is 500 ms)
    reporter.onTestEnd(
      makeTestCase({ title: 'barely slow' }),
      makeResult({ status: 'passed', duration: 600 }),
    );
    reporter.onEnd(makeFullResult());
    expect(reporter.generateSummary()).toContain('### Slowest Tests');
    expect(reporter.generateSummary()).toContain('barely slow');
  });

  test('keeps default 120s threshold when config has no reportSlowTests', () => {
    const reporter = new StepSummaryReporter();
    reporter.onBegin({} as unknown as FullConfig, { allTests: () => [] } as never);
    // A 1 000 ms test should NOT appear (under 120 000 ms default)
    reporter.onTestEnd(makeTestCase({}), makeResult({ status: 'passed', duration: 1_000 }));
    reporter.onEnd(makeFullResult());
    expect(reporter.generateSummary()).not.toContain('### Slowest Tests');
  });
});

// ---------------------------------------------------------------------------
// Playwright Reporter interface methods — onTestBegin, onStepBegin, onStdOut, onError
// ---------------------------------------------------------------------------

test.describe('StepSummaryReporter — reporter interface methods', () => {
  test('onTestBegin does not throw', () => {
    const reporter = new StepSummaryReporter();
    expect(() =>
      reporter.onTestBegin(makeTestCase({}), makeResult({ status: 'passed' })),
    ).not.toThrow();
  });

  test('onStepBegin handles test.step category without throwing', () => {
    const reporter = new StepSummaryReporter();
    expect(() =>
      reporter.onStepBegin(makeTestCase({}), makeResult({ status: 'passed' }), {
        category: 'test.step',
        title: 'click button',
      } as never),
    ).not.toThrow();
  });

  test('onStepBegin handles hook category without throwing', () => {
    const reporter = new StepSummaryReporter();
    expect(() =>
      reporter.onStepBegin(makeTestCase({}), makeResult({ status: 'passed' }), {
        category: 'hook',
        title: 'beforeEach',
      } as never),
    ).not.toThrow();
  });

  test('onStdOut does not throw', () => {
    delete process.env['CI'];
    const reporter = new StepSummaryReporter();
    expect(() => reporter.onStdOut('some stdout output')).not.toThrow();
  });

  test('onError does not throw', () => {
    const reporter = new StepSummaryReporter();
    expect(() =>
      reporter.onError({ message: 'global error', stack: 'at foo.ts:1' } as never),
    ).not.toThrow();
  });

  test('onError handles missing message gracefully', () => {
    const reporter = new StepSummaryReporter();
    expect(() => reporter.onError({} as never)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Quarantine Candidates section in GitHub Step Summary
// ---------------------------------------------------------------------------

test.describe('StepSummaryReporter — Quarantine Candidates section', () => {
  /**
   * Writes a minimal heal-trends.json directly at the path setTrendsFileForTesting
   * points to, and returns that path.
   */
  function writeTrendsFile(tmpDir: string, entries: HealTrendsFile['entries']): string {
    const trendsPath = path.join(tmpDir, 'heal-trends.json');
    setTrendsFileForTesting(trendsPath);
    const file: HealTrendsFile = { updatedAt: new Date().toISOString(), entries };
    fs.writeFileSync(trendsPath, JSON.stringify(file), 'utf-8');
    return trendsPath;
  }

  test.afterEach(() => {
    delete process.env['HEAL_QUARANTINE_THRESHOLD'];
    resetTrendsFileForTesting();
  });

  test('includes Quarantine Candidates section when locator meets default threshold of 3 (AC #5)', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'step-summary-quarantine-'));
    try {
      writeTrendsFile(tmpDir, {
        'ContactsPage::saveButton::testId::save-btn': {
          pageObject: 'ContactsPage',
          method: 'saveButton',
          originalStrategyType: 'testId',
          originalStrategyValue: 'save-btn',
          count: 3,
          firstSeenAt: '2026-01-01T00:00:00.000Z',
          lastSeenAt: '2026-01-03T00:00:00.000Z',
        },
      });
      const reporter = new StepSummaryReporter();
      const summary = reporter.generateSummary();
      expect(summary).toContain('### Quarantine Candidates');
      expect(summary).toContain('ContactsPage.saveButton');
      expect(summary).toContain('3');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('omits Quarantine Candidates section when no locator meets threshold', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'step-summary-no-quarantine-'));
    try {
      writeTrendsFile(tmpDir, {
        'P::m::testId::x': {
          pageObject: 'P',
          method: 'm',
          originalStrategyType: 'testId',
          originalStrategyValue: 'x',
          count: 2, // below default threshold of 3
          firstSeenAt: '2026-01-01T00:00:00.000Z',
          lastSeenAt: '2026-01-02T00:00:00.000Z',
        },
      });
      const reporter = new StepSummaryReporter();
      expect(reporter.generateSummary()).not.toContain('### Quarantine Candidates');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('omits Quarantine Candidates section when heal-trends.json is absent', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'step-summary-no-trends-'));
    try {
      setTrendsFileForTesting(path.join(tmpDir, 'heal-trends.json'));
      const reporter = new StepSummaryReporter();
      expect(reporter.generateSummary()).not.toContain('### Quarantine Candidates');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('HEAL_QUARANTINE_THRESHOLD env var overrides default threshold in section', () => {
    process.env['HEAL_QUARANTINE_THRESHOLD'] = '10';
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'step-summary-threshold-'));
    try {
      writeTrendsFile(tmpDir, {
        'P::m::testId::x': {
          pageObject: 'P',
          method: 'm',
          originalStrategyType: 'testId',
          originalStrategyValue: 'x',
          count: 5, // meets threshold=3 but not threshold=10
          firstSeenAt: '2026-01-01T00:00:00.000Z',
          lastSeenAt: '2026-01-05T00:00:00.000Z',
        },
      });
      const reporter = new StepSummaryReporter();
      // count=5 < threshold=10 → no section
      expect(reporter.generateSummary()).not.toContain('### Quarantine Candidates');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      delete process.env['HEAL_QUARANTINE_THRESHOLD'];
    }
  });

  test('Quarantine Candidates table is sorted by heal count descending', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'step-summary-sorted-'));
    try {
      writeTrendsFile(tmpDir, {
        'P::low::testId::a': {
          pageObject: 'P',
          method: 'low',
          originalStrategyType: 'testId',
          originalStrategyValue: 'a',
          count: 3,
          firstSeenAt: '2026-01-01T00:00:00.000Z',
          lastSeenAt: '2026-01-01T00:00:00.000Z',
        },
        'P::high::testId::b': {
          pageObject: 'P',
          method: 'high',
          originalStrategyType: 'testId',
          originalStrategyValue: 'b',
          count: 9,
          firstSeenAt: '2026-01-01T00:00:00.000Z',
          lastSeenAt: '2026-01-01T00:00:00.000Z',
        },
      });
      const reporter = new StepSummaryReporter();
      const summary = reporter.generateSummary();
      const highIdx = summary.indexOf('P.high');
      const lowIdx = summary.indexOf('P.low');
      expect(highIdx).toBeGreaterThan(-1);
      expect(lowIdx).toBeGreaterThan(-1);
      expect(highIdx).toBeLessThan(lowIdx);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
