/**
 * load-coverage-map.ts — Seeds coverage_test_links from the committed map
 * file. (pr-tia-8)
 *
 * CI has no persistent database (see coverageMappingService.ts's own
 * "Committed-map load/export" section docblock) — every job gets a fresh,
 * empty coverageDb. This script re-populates coverage_test_links from
 * qa/coverage-map.json before any selection-time query runs, so
 * select-tests.ts's existing DB-backed query path (testSelectionService ->
 * coverageMappingService) works completely unchanged against loaded rows.
 *
 * Called by exactly two things, both BEFORE they invoke select-tests.ts:
 *   - ci.yml's tia-selection job (fresh, empty coverageDb every run)
 *   - scripts/pre-push-tia.ts (a fresh checkout's local coverageDb has
 *     nothing in it either; an established dev machine's DB already has
 *     real data, but re-loading is a harmless, idempotent refresh either
 *     way — see loadCoverageTestLinksForCommit's own "replace, not
 *     upsert" semantics)
 *
 * NOT called by tia-record-mode.yml (the writer, not a reader — see
 * dump-coverage-map.ts) or e2e-functional (doesn't query the map today).
 *
 * Usage:
 *   LOG_DESTINATION=stderr tsx src/scripts/load-coverage-map.ts --sha=<commit-sha>
 *
 * If qa/coverage-map.json doesn't exist (e.g. before tia-record-mode.yml's
 * first-ever run), this is a silent no-op — an empty/absent map degrades
 * to the existing "unmapped changes" safety-net fallback exactly like a
 * genuinely fresh, never-populated coverage database always has.
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve as resolvePath, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  loadCoverageTestLinksForCommit,
  type CoverageTestLinkExportEntry,
} from '../services/coverageMappingService.js';
import coverageDb from '../coverageDb.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolvePath(__dirname, '../../..');
const COVERAGE_MAP_PATH = resolvePath(REPO_ROOT, 'qa/coverage-map.json');

interface CoverageMapFile {
  generatedAt: string;
  entries: CoverageTestLinkExportEntry[];
}

function parseArgs(argv: readonly string[]): { sha: string } {
  const shaArg = argv.find((a) => a.startsWith('--sha='));
  const sha = shaArg?.split('=')[1];
  if (!sha) {
    throw new Error('Usage: --sha=<commit-sha>');
  }
  return { sha };
}

function readCoverageMap(): CoverageMapFile | null {
  if (!existsSync(COVERAGE_MAP_PATH)) {
    return null;
  }
  try {
    const raw = readFileSync(COVERAGE_MAP_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as CoverageMapFile;
    if (!Array.isArray(parsed.entries)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const { sha } = parseArgs(process.argv.slice(2));
  try {
    const map = readCoverageMap();
    if (!map) {
      process.stderr.write(
        `[load-coverage-map] No committed map found at ${COVERAGE_MAP_PATH} (or it failed to parse) — leaving coverage_test_links empty for ${sha}. Selection will fall back to the unmapped-changes safety net.\n`,
      );
      return;
    }

    await loadCoverageTestLinksForCommit(sha, map.entries);
    process.stderr.write(
      `[load-coverage-map] Loaded ${map.entries.length} mapping(s) from ${COVERAGE_MAP_PATH} (generated ${map.generatedAt}) for commit ${sha}.\n`,
    );
  } finally {
    await coverageDb.end();
  }
}

if (process.argv[1] && __filename === resolvePath(process.argv[1])) {
  main().catch((err: unknown) => {
    process.stderr.write(
      `[load-coverage-map] fatal: ${err instanceof Error ? err.stack : String(err)}\n`,
    );
    process.exitCode = 1;
  });
}
