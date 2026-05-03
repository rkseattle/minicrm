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
 *
 * MINCRM-332
 */

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { StepSummaryReporter } from '../../framework/reporting/step-summary-reporter.js';
import type { FullConfig, FullResult, TestCase, TestResult } from '@playwright/test/reporter';

// ---------------------------------------------------------------------------
// Minimal stub factories — only the fields each test actually needs.
// ---------------------------------------------------------------------------

function makeTestCase(overrides: {
  title?: string;
  file?: string;
  line?: number;
  retries?: number;
}): TestCase {
  return {
    title: overrides.title ?? 'a test',
    location: {
      file: overrides.file ?? '/tests/foo.spec.ts',
      line: overrides.line ?? 1,
      column: 0,
    },
    retries: overrides.retries ?? 0,
  } as unknown as TestCase;
}

function makeResult(overrides: {
  status: TestResult['status'];
  retry?: number;
  duration?: number;
  errors?: TestResult['errors'];
}): TestResult {
  return {
    status: overrides.status,
    retry: overrides.retry ?? 0,
    duration: overrides.duration ?? 100,
    errors: overrides.errors ?? [],
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
