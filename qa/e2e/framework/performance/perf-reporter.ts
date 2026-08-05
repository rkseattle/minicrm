/**
 * PerfReporter — custom Playwright reporter that merges per-worker perf samples
 * into a single test-results/perf-report.json at the end of the run.
 *
 * Mirrors the structure of HealingReporter so the report is easy to consume
 * in CI alongside healing-report.json.
 *
 * Register in playwright.config.ts under the `perf` project only:
 *   reporters: [['./framework/performance/perf-reporter.ts']]
 *
 */

import type { Reporter, FullResult } from '@playwright/test/reporter';
import fs from 'node:fs';
import path from 'node:path';
import { PerfRegistry } from './perf-registry.js';
import type { PerfSample } from './perf-metrics.js';
import { readWorkerArtifact } from '../reporting/worker-artifact-utils.js';

const OUTPUT_DIR = 'test-results';
const WORKER_FILE_PATTERN = /^perf-(shard\d+-worker\d+|\d+)\.json$/;
const REPORT_FILE = path.join(OUTPUT_DIR, 'perf-report.json');

/** Schema of the merged performance report file. */
export interface PerfReport {
  generatedAt: string;
  totalSamples: number;
  scenarios: string[];
  samples: PerfSample[];
}

function readWorkerFile(filePath: string): PerfSample[] {
  return readWorkerArtifact<PerfSample>(filePath, 'samples', 'PerfReporter');
}

export class PerfReporter implements Reporter {
  onEnd(_result: FullResult): void {
    if (process.env['PW_WORKER_INDEX'] !== undefined) {
      PerfRegistry.instance.flush();
    }

    const allSamples: PerfSample[] = [];
    let workerFiles: string[] = [];
    try {
      workerFiles = fs
        .readdirSync(OUTPUT_DIR)
        .filter((name) => WORKER_FILE_PATTERN.test(name))
        .map((name) => path.join(OUTPUT_DIR, name));
    } catch {
      // Output dir may not exist if no perf tests ran.
    }

    for (const filePath of workerFiles) {
      allSamples.push(...readWorkerFile(filePath));
    }

    const scenarios = [...new Set(allSamples.map((s) => s.scenario))];

    const report: PerfReport = {
      generatedAt: new Date().toISOString(),
      totalSamples: allSamples.length,
      scenarios,
      samples: allSamples,
    };

    try {
      fs.mkdirSync(OUTPUT_DIR, { recursive: true });
      fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2), 'utf-8');
    } catch (err) {
      console.error(`[PerfReporter] Failed to write report: ${String(err)}`);
    }

    this._logSummary(report);
  }

  _logSummary(report: PerfReport): void {
    if (report.totalSamples === 0) {
      console.log('[PerfReporter] No performance samples recorded.');
      return;
    }
    console.log(
      `\n[PerfReporter] Performance summary — ${report.totalSamples} sample(s) across ${report.scenarios.length} scenario(s): ${report.scenarios.join(', ')}`,
    );
    for (const sample of report.samples) {
      const { vitals, apiTimings, scenario } = sample;
      const lcp = vitals.lcp !== null ? `LCP=${vitals.lcp.toFixed(0)}ms` : 'LCP=n/a';
      const cls = vitals.cls !== null ? `CLS=${vitals.cls.toFixed(3)}` : 'CLS=n/a';
      const ttfb = vitals.ttfb !== null ? `TTFB=${vitals.ttfb.toFixed(0)}ms` : 'TTFB=n/a';
      const apiSummary =
        apiTimings.length > 0
          ? `API[${apiTimings.map((t) => `${t.ttfb.toFixed(0)}ms`).join(',')}]`
          : 'API=n/a';
      console.log(`  [${scenario}] ${lcp} ${cls} ${ttfb} ${apiSummary}`);
    }
  }
}

export default PerfReporter;
