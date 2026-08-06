/**
 * report-coverage-map-size.ts
 *
 * Measures what the coverage-map export actually produced, so the size question
 * is settled by data rather than estimate. Writes a Markdown table to stdout for
 * tia-record-mode.yml to append to the job summary.
 *
 * WHY THIS EXISTS
 * ---------------
 * Streaming the export removed the 512MB string ceiling that was killing it, but
 * removing a crash is not the same as guaranteeing the result is committable:
 * GitHub rejects any push containing a file over 100MB. Nothing in the repo can
 * predict the collapsed size — it depends on how many commits accumulated in the
 * database and how much the collapse folds them down — so this reports the real
 * numbers BEFORE the commit step attempts a push, turning a would-be failed push
 * into a measurement.
 *
 * The two cardinality counts are the input to deciding whether the map needs
 * normalizing into linked files: they are what a normalized layout would move
 * out of the per-link rows.
 *
 * Uses the same pooled connection every other database step in that workflow
 * uses. An earlier revision shelled out to `psql`, which is not established to
 * exist on the runner host and appears nowhere else in this repo's workflows.
 */

import { statSync, existsSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import coverageDb from '../coverageDb.js';
import { COVERAGE_MAP_PATH } from './coverageMapPath.js';

/** GitHub rejects a push containing any file larger than this. */
const GITHUB_MAX_FILE_BYTES = 100 * 1024 * 1024;

async function main(): Promise<void> {
  try {
    const { rows } = await coverageDb.query<{
      raw_rows: string;
      distinct_shas: string;
      collapsed_entries: string;
      distinct_tests: string;
      distinct_units: string;
    }>(
      `SELECT
         count(*)                                                            AS raw_rows,
         count(DISTINCT commit_sha)                                          AS distinct_shas,
         count(DISTINCT (unit_key, COALESCE(branch_id, ''), file_path, test_id)) AS collapsed_entries,
         count(DISTINCT test_id)                                             AS distinct_tests,
         count(DISTINCT (file_path, unit_key, COALESCE(branch_id, '')))      AS distinct_units
       FROM coverage_test_links`,
    );

    const stats = rows[0];
    const bytes = existsSync(COVERAGE_MAP_PATH) ? statSync(COVERAGE_MAP_PATH).size : 0;
    const megabytes = (bytes / (1024 * 1024)).toFixed(1);
    const headroom = ((bytes / GITHUB_MAX_FILE_BYTES) * 100).toFixed(1);

    const lines = [
      '### Coverage map',
      '',
      '| Metric | Value |',
      '| --- | --- |',
      `| Rows in coverage_test_links | ${stats.raw_rows} |`,
      `| Distinct commit SHAs | ${stats.distinct_shas} |`,
      `| Entries after collapse | ${stats.collapsed_entries} |`,
      `| Distinct test IDs | ${stats.distinct_tests} |`,
      `| Distinct code units | ${stats.distinct_units} |`,
      `| Map size | ${megabytes} MB |`,
      `| Of GitHub's 100MB per-file limit | ${headroom}% |`,
      '',
    ];

    const overLimit = bytes > GITHUB_MAX_FILE_BYTES;
    if (overLimit) {
      lines.push(
        "> **The map exceeds GitHub's per-file limit and cannot be committed.**",
        '> Collapsing alone is not enough at this volume — the map needs',
        '> normalizing into linked files, or genuine retention.',
        '',
      );
    }

    process.stdout.write(lines.join('\n') + '\n');

    // Fail rather than merely report. A measurement nothing acts on is not a
    // guard: the commit step that follows would push the oversized file and be
    // rejected by GitHub at the last step of a multi-hour run — the exact
    // outcome this exists to convert into an early, legible failure.
    if (overLimit) {
      process.stderr.write(
        `[report-coverage-map-size] ${COVERAGE_MAP_PATH} is ${megabytes} MB, over ` +
          `GitHub's ${GITHUB_MAX_FILE_BYTES / (1024 * 1024)} MB per-file limit — ` +
          `refusing to continue to the commit step.\n`,
      );
      process.exitCode = 1;
    }
  } finally {
    await coverageDb.end();
  }
}

const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] && __filename === resolvePath(process.argv[1])) {
  main().catch((err: unknown) => {
    process.stderr.write(
      `[report-coverage-map-size] fatal: ${err instanceof Error ? err.stack : String(err)}\n`,
    );
    process.exitCode = 1;
  });
}
