/**
 * dump-coverage-map.ts — Exports coverage_test_links to the committed map
 * file. (pr-tia-8)
 *
 * The counterpart to load-coverage-map.ts. Called ONLY at the end of
 * tia-record-mode.yml, after that workflow's own full-suite run has
 * ingested real coverage dumps into a live, freshly-populated
 * coverage_test_links — the one place in this whole pipeline where the
 * database actually reflects a genuine, authoritative test run rather
 * than a previously-committed snapshot. The workflow commits the
 * resulting qa/coverage-map.json back to main with [skip ci], the same
 * pattern update-timing-baseline.yml already establishes for
 * test-timing-baseline.json.
 *
 * Usage:
 *   LOG_DESTINATION=stderr tsx src/scripts/dump-coverage-map.ts
 */

import { writeFileSync } from 'node:fs';
import { resolve as resolvePath, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exportAllCoverageTestLinks } from '../services/coverageMappingService.js';
import coverageDb from '../coverageDb.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolvePath(__dirname, '../../..');
const COVERAGE_MAP_PATH = resolvePath(REPO_ROOT, 'qa/coverage-map.json');

async function main(): Promise<void> {
  try {
    const entries = await exportAllCoverageTestLinks();
    const content = {
      generatedAt: new Date().toISOString(),
      entries,
    };
    writeFileSync(COVERAGE_MAP_PATH, JSON.stringify(content, null, 2) + '\n', 'utf-8');
    process.stderr.write(
      `[dump-coverage-map] Wrote ${entries.length} mapping(s) to ${COVERAGE_MAP_PATH}.\n`,
    );
  } finally {
    await coverageDb.end();
  }
}

if (process.argv[1] && __filename === resolvePath(process.argv[1])) {
  main().catch((err: unknown) => {
    process.stderr.write(
      `[dump-coverage-map] fatal: ${err instanceof Error ? err.stack : String(err)}\n`,
    );
    process.exitCode = 1;
  });
}
