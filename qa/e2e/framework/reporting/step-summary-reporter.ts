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
import type { HealTrendEntry } from '../healing/heal-trends.js';
import { readTrends, quarantineCandidates } from '../healing/heal-trends.js';
import { CLEANUP_FAILED_ANNOTATION, ENVIRONMENT_DRIFT_ANNOTATION } from './cleanup-annotations.js';

// Suite name is injected via SUITE_NAME env var so this file stays domain-agnostic.
const DEFAULT_SUITE_NAME = 'E2E Tests';

const ReportType = {
  TEST_SUITE: 'TestSuite',
  TEST_CASE: 'TestCase',
  TEST_STEP: 'TestStep',
  TEST_HOOK: 'TestHook',
  ERROR: 'Error',
} as const;
type ReportType = (typeof ReportType)[keyof typeof ReportType];

const CategoryType = {
  HOOK: 'hook',
  STEP: 'test.step',
} as const;

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

interface TestDurationEntry {
  title: string;
  duration: number;
}

function isCI(): boolean {
  return !!process.env['CI'];
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
  private testDurations: Map<string, TestDurationEntry>;
  private flakyTests: string[];
  private interruptedTests: string[];
  private cleanupFailures: string[];
  private environmentDrift: string[];
  private slowThreshold: number;

  constructor() {
    this.pad = isCI() ? '' : '  ';
    this.suiteName = process.env['SUITE_NAME'] ?? DEFAULT_SUITE_NAME;
    this.summaryPath =
      process.env['SUMMARY_OUTPUT_PATH'] ?? process.env['GITHUB_STEP_SUMMARY'] ?? null;
    this.stats = { passed: 0, failed: 0, skipped: 0, flaky: 0, interrupted: 0, duration: 0 };
    this.failedTests = [];
    this.slowTests = [];
    this.testDurations = new Map();
    this.flakyTests = [];
    this.interruptedTests = [];
    this.cleanupFailures = [];
    this.environmentDrift = [];
    this.slowThreshold = 120_000;
  }

  private log(text: string, type?: ReportType, lineBreak = true): void {
    const lb = lineBreak && !isCI() ? '\n' : '';
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

  /**
   * Run identification line (branch, commit, run link, timestamp) so a
   * failure in this summary can be traced back to the exact CI run/commit
   * without cross-referencing the workflow run separately. Sourced entirely
   * from GitHub Actions' own standard env vars (set automatically on every
   * runner, per this file's own doc comment on GITHUB_STEP_SUMMARY) — no
   * app-domain knowledge, so this stays framework-pure. Empty string outside
   * CI (GITHUB_* vars unset locally), since a local run has no remote run to
   * link back to.
   */
  private buildRunMetadataLine(): string {
    if (!isCI()) return '';

    const branch = process.env['GITHUB_REF_NAME'];
    const sha = process.env['GITHUB_SHA'];
    const shortSha = sha ? sha.slice(0, 7) : undefined;
    const runUrl =
      process.env['GITHUB_SERVER_URL'] &&
      process.env['GITHUB_REPOSITORY'] &&
      process.env['GITHUB_RUN_ID']
        ? `${process.env['GITHUB_SERVER_URL']}/${process.env['GITHUB_REPOSITORY']}/actions/runs/${process.env['GITHUB_RUN_ID']}`
        : undefined;
    const timestamp = new Date().toISOString();

    const parts: string[] = [];
    if (branch) parts.push(`**Branch**: \`${branch}\``);
    if (shortSha) parts.push(`**Commit**: \`${shortSha}\``);
    if (runUrl) parts.push(`**Run**: [${process.env['GITHUB_RUN_ID']}](${runUrl})`);
    parts.push(`**Started**: ${timestamp}`);

    return parts.length > 0 ? parts.join(' · ') + '\n\n' : '';
  }

  private buildStatsTable(): string {
    const { passed, failed, flaky, skipped, interrupted } = this.stats;
    const total = passed + failed + skipped + flaky + interrupted;
    const duration = this.formatDuration(this.stats.duration);
    return (
      `## ${this.suiteName}\n\n` +
      this.buildRunMetadataLine() +
      `| Status | Count |\n|--------|-------|\n` +
      `| Passed | ${passed} |\n` +
      `| Failed | ${failed} |\n` +
      `| Flaky | ${flaky} |\n` +
      `| Skipped | ${skipped} |\n` +
      `| Interrupted | ${interrupted} |\n` +
      `| **Total** | **${total}** |\n\n` +
      `**Duration**: ${duration}\n`
    );
  }

  private buildFailedSection(): string {
    if (this.failedTests.length === 0) return '';
    const lines = ['\n### Failed Tests\n'];
    for (const test of this.failedTests) {
      lines.push(
        `<details>\n<summary>${test.title} — ${test.location}</summary>\n\n` +
          `\`\`\`\n${test.error}\n\`\`\`\n</details>\n`,
      );
    }
    return lines.join('\n');
  }

  private buildBulletSection(heading: string, items: string[]): string {
    if (items.length === 0) return '';
    return `\n### ${heading}\n` + items.map((t) => `- ${t}\n`).join('');
  }

  private buildSlowTestsSection(): string {
    if (this.slowTests.length === 0) return '';
    const thresholdLabel = this.formatDuration(this.slowThreshold);
    const rows = [...this.slowTests]
      .sort((a, b) => b.duration - a.duration)
      .map((t) => `| ${t.title} | ${this.formatDuration(t.duration)} |\n`)
      .join('');
    return `\n### Slowest Tests (> ${thresholdLabel})\n| Test | Duration |\n|------|----------|\n${rows}`;
  }

  /**
   * Builds the "Quarantine Candidates" section for the GitHub Step Summary.
   * Reads heal-trends.json from the standard output directory and lists any locator
   * whose accumulated count meets or exceeds HEAL_QUARANTINE_THRESHOLD.
   * Returns an empty string when no candidates exist or when the trends file is absent.
   */
  private buildQuarantineSection(): string {
    const threshold = parseInt(process.env['HEAL_QUARANTINE_THRESHOLD'] ?? '3', 10);
    let entries: Record<string, HealTrendEntry> = {};
    try {
      entries = readTrends();
    } catch {
      return '';
    }
    const candidates = quarantineCandidates(entries, threshold);
    if (candidates.length === 0) return '';
    const rows = candidates
      .sort((a, b) => b.count - a.count)
      .map(
        (e) =>
          `| ${e.pageObject}.${e.method} | \`${e.originalStrategyType}="${e.originalStrategyValue}"\` | ${e.count} |\n`,
      )
      .join('');
    return (
      `\n### Quarantine Candidates (healed ≥ ${threshold} times)\n` +
      `| Locator | Original Strategy | Heal Count |\n` +
      `|---------|-------------------|------------|\n` +
      rows
    );
  }

  generateSummary(): string {
    return (
      this.buildStatsTable() +
      this.buildFailedSection() +
      this.buildBulletSection('Cleanup Failures', this.cleanupFailures) +
      this.buildBulletSection('Environment Drift', this.environmentDrift) +
      this.buildBulletSection('Flaky Tests', this.flakyTests) +
      this.buildBulletSection('Interrupted Tests', this.interruptedTests) +
      this.buildSlowTestsSection() +
      this.buildQuarantineSection() +
      '\n---\n\n'
    );
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

    // Collect cleanup failures from EVERY attempt, before the final-attempt
    // gate below. Each attempt creates and cleans up its own records, so a
    // retry that succeeds does not undo what attempt 1 leaked — and reading
    // `test.annotations` after the fact would miss it entirely, since
    // Playwright overwrites that array with the last attempt's. Passing tests
    // are included deliberately: a failing test is already reported, while a
    // green run that left a row behind is the case with no other surface.
    //
    // `?? []` because a Reporter may be driven by a hand-built TestCase or
    // TestResult that omits optional fields — this file's own specs do that.
    for (const annotation of result.annotations ?? test.annotations ?? []) {
      if (annotation.type === ENVIRONMENT_DRIFT_ANNOTATION) {
        // Reported even though the test PASSED: this marks a documented fact
        // about the environment that no longer holds, which makes prose stale
        // without making the run wrong.
        this.environmentDrift.push(`${test.title} — ${annotation.description ?? 'no detail'}`);
      }
      if (annotation.type === CLEANUP_FAILED_ANNOTATION) {
        // Label whenever the test can retry, so two entries from the same
        // test are distinguishable rather than one labeled and one bare.
        const attempt = test.retries > 0 ? ` (attempt ${result.retry + 1})` : '';
        this.cleanupFailures.push(
          `${test.title}${attempt} — ${annotation.description ?? 'no detail'}`,
        );
      }
    }

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
    const key = `${test.location.file}:${test.location.line}`;
    const existing = this.testDurations.get(key);
    this.testDurations.set(key, {
      title: test.title,
      duration: (existing?.duration ?? 0) + result.duration,
    });
  }

  onStepBegin(_test: TestCase, _result: TestResult, step: TestStep): void {
    if (step.category === CategoryType.STEP) {
      this.log(step.title, ReportType.TEST_STEP);
    } else if (step.category === CategoryType.HOOK) {
      this.log(step.title, ReportType.TEST_HOOK);
    }
  }

  onStdOut(chunk: string | Buffer): void {
    if (isCI()) return;
    this.log(chunk.toString(), undefined, false);
  }

  onError(error: TestError): void {
    this.log(`Error: ${error.message ?? ''}`, ReportType.ERROR);
  }

  onEnd(result: FullResult): void {
    this.stats.duration = result.duration;

    for (const { title, duration } of this.testDurations.values()) {
      if (duration > this.slowThreshold) {
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
