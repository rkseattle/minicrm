import * as fs from 'node:fs';
import type {
  FullConfig,
  FullResult,
  Reporter,
  Suite,
  TestCase,
  TestError,
  TestResult,
  TestStep,
} from '@playwright/test/reporter';

// Suite name is injected via SUITE_NAME env var so this file stays domain-agnostic.
const DEFAULT_SUITE_NAME = 'E2E Tests';

enum ReportType {
  TEST_SUITE = 'TestSuite',
  TEST_CASE = 'TestCase',
  TEST_STEP = 'TestStep',
  TEST_HOOK = 'TestHook',
  ERROR = 'Error',
}

enum CategoryType {
  HOOK = 'hook',
  STEP = 'test.step',
}

interface TestStats {
  passed: number;
  failed: number;
  skipped: number;
  flaky: number;
  interrupted: number;
  duration: number;
}

interface FailedTest {
  title: string;
  location: string;
  error: string;
}

interface SlowTest {
  title: string;
  duration: number;
}

/**
 * Custom Playwright reporter that appends a markdown job summary to
 * $GITHUB_STEP_SUMMARY when running in CI. Locally, it prints structured
 * console output and writes no files.
 *
 * Output path resolution order:
 *   1. SUMMARY_OUTPUT_PATH env var (allows local testing of file output)
 *   2. GITHUB_STEP_SUMMARY env var (set automatically on every GHA runner)
 *   3. null — no file output (normal local runs)
 *
 * Register in playwright.config.ts:
 *   ['./framework/reporting/step-summary-reporter.ts']
 */
export class StepSummaryReporter implements Reporter {
  private readonly pad: string;
  private readonly suiteName: string;
  private readonly summaryPath: string | null;
  private stats: TestStats;
  private failedTests: FailedTest[];
  private slowTests: SlowTest[];
  private testDurations: Map<string, number>;
  private flakyTests: string[];
  private interruptedTests: string[];
  private slowThreshold: number;

  constructor() {
    this.pad = this.isCI() ? '' : '  ';
    this.suiteName = process.env['SUITE_NAME'] ?? DEFAULT_SUITE_NAME;
    this.summaryPath =
      process.env['SUMMARY_OUTPUT_PATH'] ?? process.env['GITHUB_STEP_SUMMARY'] ?? null;
    this.stats = { passed: 0, failed: 0, skipped: 0, flaky: 0, interrupted: 0, duration: 0 };
    this.failedTests = [];
    this.slowTests = [];
    this.testDurations = new Map();
    this.flakyTests = [];
    this.interruptedTests = [];
    this.slowThreshold = 120_000;
  }

  private isCI(): boolean {
    return !!process.env['CI'];
  }

  private log(text: string, type?: ReportType, lineBreak = true): void {
    const lb = lineBreak && !this.isCI() ? '\n' : '';
    console.log(`${this.pad}${type ? `[${type}]: ` : ''}${text}${lb}`);
  }

  private formatDuration(ms: number): string {
    const minutes = Math.floor(ms / 60_000);
    const seconds = Math.floor((ms % 60_000) / 1_000);
    return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
  }

  private stripAnsi(text: string): string {
    return text.replace(/\x1B\[[0-9;]*m/g, '');
  }

  private formatError(error: TestError | undefined): string {
    if (!error) return 'Unknown error';
    const message = this.stripAnsi(error.message ?? '');
    const stack = this.stripAnsi(error.stack ?? '');
    return [message, stack].filter(Boolean).join('\n');
  }

  private resultLabel(status: string): string {
    if (status === 'passed') return 'Passed';
    if (status === 'failed') return 'Failed';
    if (status === 'timedOut') return 'Timed out';
    if (status === 'interrupted') return 'Interrupted';
    return 'Unknown';
  }

  generateSummary(): string {
    const total =
      this.stats.passed +
      this.stats.failed +
      this.stats.skipped +
      this.stats.flaky +
      this.stats.interrupted;
    const duration = this.formatDuration(this.stats.duration);

    let md =
      `## ${this.suiteName}\n\n` +
      `| Status | Count |\n|--------|-------|\n` +
      `| Passed | ${this.stats.passed} |\n` +
      `| Failed | ${this.stats.failed} |\n` +
      `| Flaky | ${this.stats.flaky} |\n` +
      `| Skipped | ${this.stats.skipped} |\n` +
      `| Interrupted | ${this.stats.interrupted} |\n` +
      `| **Total** | **${total}** |\n\n` +
      `**Duration**: ${duration}\n`;

    if (this.failedTests.length > 0) {
      md += '\n### Failed Tests\n';
      for (const test of this.failedTests) {
        md +=
          `<details>\n<summary>${test.title} — ${test.location}</summary>\n\n` +
          `\`\`\`\n${test.error}\n\`\`\`\n</details>\n\n`;
      }
    }

    if (this.flakyTests.length > 0) {
      md += '\n### Flaky Tests\n';
      for (const title of this.flakyTests) {
        md += `- ${title}\n`;
      }
    }

    if (this.interruptedTests.length > 0) {
      md += '\n### Interrupted Tests\n';
      for (const title of this.interruptedTests) {
        md += `- ${title}\n`;
      }
    }

    if (this.slowTests.length > 0) {
      const thresholdLabel = this.formatDuration(this.slowThreshold);
      md += `\n### Slowest Tests (> ${thresholdLabel})\n| Test | Duration |\n|------|----------|\n`;
      for (const test of [...this.slowTests].sort((a, b) => b.duration - a.duration)) {
        md += `| ${test.title} | ${this.formatDuration(test.duration)} |\n`;
      }
    }

    md += '\n---\n\n';
    return md;
  }

  onBegin(config: FullConfig, suite: Suite): void {
    const testCount = suite.allTests().length;
    this.slowThreshold = config.reportSlowTests?.threshold ?? this.slowThreshold;
    this.log(`Starting run with ${testCount} test(s)`, ReportType.TEST_SUITE);
  }

  onTestBegin(test: TestCase, _result: TestResult): void {
    this.log(`Starting ${test.title}`, ReportType.TEST_CASE);
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    this.log(`Finished ${test.title}, ${this.resultLabel(result.status)}`, ReportType.TEST_CASE);

    // Only tally on the final attempt to avoid double-counting retries.
    const isFinalAttempt = result.status === 'passed' || result.retry === test.retries;
    if (!isFinalAttempt) return;

    if (result.status === 'passed') {
      if (result.retry > 0) {
        this.stats.flaky++;
        this.flakyTests.push(test.title);
      } else {
        this.stats.passed++;
      }
    } else if (result.status === 'failed' || result.status === 'timedOut') {
      this.stats.failed++;
      this.failedTests.push({
        title: test.title,
        location: `${test.location.file}:${test.location.line}`,
        error: this.formatError(result.errors[0]),
      });
    } else if (result.status === 'skipped') {
      this.stats.skipped++;
    } else if (result.status === 'interrupted') {
      this.stats.interrupted++;
      this.interruptedTests.push(test.title);
    }

    // Accumulate per-test duration for slow-test detection.
    const key = `${test.title}||${test.location.file}:${test.location.line}`;
    this.testDurations.set(key, (this.testDurations.get(key) ?? 0) + result.duration);
  }

  onStepBegin(_test: TestCase, _result: TestResult, step: TestStep): void {
    if (step.category === CategoryType.STEP) {
      this.log(step.title, ReportType.TEST_STEP);
    } else if (step.category === CategoryType.HOOK) {
      this.log(step.title, ReportType.TEST_HOOK);
    }
  }

  onStdOut(chunk: string | Buffer): void {
    if (this.isCI()) return;
    this.log(chunk.toString(), undefined, false);
  }

  onError(error: TestError): void {
    this.log(`Error: ${error.message ?? ''}`, ReportType.ERROR);
  }

  onEnd(result: FullResult): void {
    this.stats.duration = result.duration;

    for (const [key, duration] of this.testDurations) {
      if (duration > this.slowThreshold) {
        const title = key.split('||')[0] ?? key;
        this.slowTests.push({ title, duration });
      }
    }

    this.log(`Test(s) ${this.resultLabel(result.status)}`, ReportType.TEST_SUITE);

    if (this.summaryPath !== null) {
      try {
        const summary = this.generateSummary();
        fs.appendFileSync(this.summaryPath, summary);
        this.log(`Summary appended to ${this.summaryPath}`, ReportType.TEST_SUITE);
      } catch (err) {
        this.log(`Failed to write summary: ${String(err)}`, ReportType.ERROR);
      }
    }
  }
}

export default StepSummaryReporter;
