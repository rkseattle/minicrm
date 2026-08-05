/**
 * dump-coverage-map.ts
 *
 * Exports every coverage mapping this database knows to the committed map file,
 * for tia-record-mode.yml to commit back to main. ci.yml's tia-selection job and
 * the pre-push hook load it into their own ephemeral databases before selecting
 * tests, since CI has no persistent coverage database.
 *
 * STREAMS, line by line, and never holds the map in memory. The previous
 * implementation buffered every row, mapped it into a second array, and handed
 * the lot to JSON.stringify(content, null, 2) — which threw
 * `RangeError: Invalid string length` once the serialized form crossed V8's
 * 512MB max string length, and would have done so on every run from then on.
 * Pretty-printing was a 2-3x multiplier on a file no human reads.
 *
 * Output is JSONL: a header line carrying generatedAt, one compact entry per
 * line, and an entry-count trailer. The trailer is what lets the reader tell a
 * complete file from one truncated by a killed job — see load-coverage-map.ts.
 *
 * Usage (from repo root):
 *   LOG_DESTINATION=stderr npm run dump:coverage-map --workspace=minicrm-server
 */

import { createWriteStream, renameSync, unlinkSync, existsSync } from 'node:fs';
import { once } from 'node:events';
import { resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { streamAllCoverageTestLinks } from '../services/coverageMappingService.js';
import coverageDb from '../coverageDb.js';
import { COVERAGE_MAP_PATH, COVERAGE_MAP_TEMP_PATH } from './coverageMapPath.js';

async function main(): Promise<void> {
  try {
    // Written to a temp path and renamed on success. A job killed mid-write
    // would otherwise leave a truncated file where the previous good map was,
    // and `git add` would stage it as the new authoritative map. Rename is
    // atomic within a filesystem, so readers see either the old file or the
    // complete new one, never a partial.
    const stream = createWriteStream(COVERAGE_MAP_TEMP_PATH, { encoding: 'utf-8' });

    // generatedAt leads; the entry count follows the entries as a trailer,
    // because the total is not known until the stream is exhausted. The trailer
    // doubles as proof the writer reached the end — a file truncated by a
    // killed job has no trailer at all, which is what lets the reader tell
    // "complete" from "cut short" rather than silently loading a partial map.
    stream.write(JSON.stringify({ generatedAt: new Date().toISOString() }) + '\n');

    const total = await streamAllCoverageTestLinks(async (entries) => {
      for (const entry of entries) {
        stream.write(JSON.stringify(entry) + '\n');
      }
      // Let the drain event through if the buffer is full, so a slow disk
      // applies backpressure instead of queuing the whole map in memory.
      if (stream.writableNeedDrain) await once(stream, 'drain');
    });

    stream.write(JSON.stringify({ entryCount: total }) + '\n');
    stream.end();
    await once(stream, 'finish');

    renameSync(COVERAGE_MAP_TEMP_PATH, COVERAGE_MAP_PATH);
    process.stderr.write(
      `[dump-coverage-map] Wrote ${total} mapping(s) to ${COVERAGE_MAP_PATH}.\n`,
    );
  } finally {
    await coverageDb.end();
  }
}

const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] && __filename === resolvePath(process.argv[1])) {
  main().catch((err: unknown) => {
    // Leave no partial temp file behind for the next run to trip over.
    if (existsSync(COVERAGE_MAP_TEMP_PATH)) {
      try {
        unlinkSync(COVERAGE_MAP_TEMP_PATH);
      } catch {
        // Best-effort cleanup; the real error below is what matters.
      }
    }
    process.stderr.write(
      `[dump-coverage-map] fatal: ${err instanceof Error ? err.stack : String(err)}\n`,
    );
    process.exitCode = 1;
  });
}
