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
 * Output is JSONL, NORMALIZED. Every entry repeats its test's file path, the
 * covered file's path, and the test's name — none of which vary per entry for a
 * given test or code unit. At real suite scale (~1300 tests x 2 projects x the
 * units each touches) that repetition is most of the file, and the map has to
 * fit under GitHub's 100MB per-file push limit or it cannot be committed at all.
 *
 * So the file carries three sections, in order:
 *   {"generatedAt":...,"format":2}          header
 *   {"t":<n>,"testId":...,"testName":...,"testFile":...}   one per test
 *   {"u":<n>,"filePath":...,"unitKey":...,"branchId":...}  one per code unit
 *   {"l":[<testRef>,<unitRef>,<hitCount>]}  one per link
 *   {"entryCount":<links>}                  trailer
 *
 * Both dictionaries are bounded by ENTITY count — tests and code units — while
 * only the link lines scale with their product, and a link line is ~45 bytes
 * against ~162 for a denormalized entry. Section order is load-bearing: the
 * reader resolves references as it streams, so a dictionary line must precede
 * any link that names it.
 *
 * The trailer is what lets the reader tell a complete file from one truncated by
 * a killed job — see load-coverage-map.ts.
 *
 * Usage (from repo root):
 *   LOG_DESTINATION=stderr npm run dump:coverage-map --workspace=minicrm-server
 */

import { createWriteStream, renameSync, unlinkSync, existsSync } from 'node:fs';
import { once } from 'node:events';
import { resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  streamAllCoverageTestLinks,
  type CoverageTestLinkExportEntry,
} from '../services/coverageMappingService.js';
import coverageDb from '../coverageDb.js';
import { COVERAGE_MAP_PATH, COVERAGE_MAP_FORMAT } from './coverageMapPath.js';

/**
 * Serializes a stream of entries to a map file.
 *
 * Writes to a temp path and renames on success. A job killed mid-write would
 * otherwise leave a truncated file where the previous good map was, and
 * `git add` would stage it as the new authoritative map. Rename is atomic
 * within a filesystem, so readers see either the old file or the complete new
 * one, never a partial.
 *
 * Takes the source as a callback rather than reading the database directly, so
 * the serialization contract — header, compact entries, entry-count trailer,
 * temp-then-rename, cleanup on failure — is testable without a database and
 * without touching the real committed map.
 *
 * @param mapPath - Destination path.
 * @param source - Produces entries, invoking onBatch per page; returns the total.
 * @returns The number of entries written.
 */
export async function writeCoverageMap(
  mapPath: string,
  source: (onBatch: (entries: CoverageTestLinkExportEntry[]) => Promise<void>) => Promise<number>,
): Promise<number> {
  const tempPath = `${mapPath}.${process.pid}.tmp`;
  const stream = createWriteStream(tempPath, { encoding: 'utf-8' });

  // A write stream reports I/O failure by EMITTING 'error', not by throwing
  // from write() and not by rejecting whatever the caller happens to be
  // awaiting. Nearly all of this function's wall-clock is spent awaiting a DB
  // page below, so without a listener attached the process dies on an unhandled
  // 'error' event — skipping the caller's catch entirely, which means no
  // temp-file cleanup, no diagnostic, and no pool shutdown. Capturing it here
  // and re-throwing at the next checkpoint routes it through the normal path.
  // ENOSPC on a runner writing a file this size is not hypothetical.
  let streamError: Error | null = null;
  stream.on('error', (err: Error) => {
    streamError = err;
  });

  /** Rethrows a captured stream error at the next safe point. */
  const throwIfStreamFailed = (): void => {
    if (streamError) throw streamError;
  };

  try {
    // generatedAt leads; the entry count follows the entries as a trailer,
    // because the total is not known until the stream is exhausted. The trailer
    // doubles as proof the writer reached the end — a file truncated by a
    // killed job has no trailer at all, which is what lets the reader tell
    // "complete" from "cut short" rather than silently loading a partial map.
    //
    // `format` lets a reader reject a file it does not understand rather than
    // misparse one — the denormalized layout had no version marker, so the only
    // way to detect it was that every line failed validation.
    stream.write(
      JSON.stringify({ generatedAt: new Date().toISOString(), format: COVERAGE_MAP_FORMAT }) + '\n',
    );

    // Interned dictionaries, emitted lazily: a test or unit line is written the
    // first time a link references it, so the reader has always seen a
    // reference before it needs to resolve it. Held in memory deliberately —
    // both are bounded by entity count (tests, code units), not by the link
    // count that made the old format unbounded.
    const testRefs = new Map<string, number>();
    const unitRefs = new Map<string, number>();

    const total = await source(async (entries) => {
      throwIfStreamFailed();
      for (const entry of entries) {
        let testRef = testRefs.get(entry.testId);
        if (testRef === undefined) {
          testRef = testRefs.size;
          testRefs.set(entry.testId, testRef);
          stream.write(
            JSON.stringify({
              t: testRef,
              testId: entry.testId,
              testName: entry.testName,
              testFile: entry.testFile,
            }) + '\n',
          );
        }

        // branch_id is part of the unit's identity, not the link's: two
        // branches of one function are distinct units covered independently.
        const unitKeyStr = `${entry.filePath}\u0000${entry.unitKey}\u0000${entry.branchId ?? ''}`;
        let unitRef = unitRefs.get(unitKeyStr);
        if (unitRef === undefined) {
          unitRef = unitRefs.size;
          unitRefs.set(unitKeyStr, unitRef);
          stream.write(
            JSON.stringify({
              u: unitRef,
              filePath: entry.filePath,
              unitKey: entry.unitKey,
              branchId: entry.branchId,
            }) + '\n',
          );
        }

        stream.write(JSON.stringify({ l: [testRef, unitRef, entry.hitCount] }) + '\n');
      }
      // Let the drain event through if the buffer is full, so a slow disk
      // applies backpressure instead of queuing the whole map in memory.
      // Racing against 'error' too, or a failed stream never drains and this
      // waits forever.
      if (stream.writableNeedDrain) {
        // AbortController, not a bare Promise.race over two once() promises:
        // race settles on the first, but never detaches the loser's listener,
        // and once() only detaches on resolution. Backpressure fires on
        // essentially every page at real export size, so that pattern leaks one
        // permanent 'error' listener per page — hundreds by the end, plus a
        // MaxListenersExceededWarning in the log of the run that is supposed to
        // prove this export works.
        const drained = new AbortController();
        try {
          await Promise.race([
            once(stream, 'drain', { signal: drained.signal }),
            once(stream, 'error', { signal: drained.signal }),
          ]);
        } catch (err) {
          // An abort from our own finally is not a failure; anything else is.
          if (!drained.signal.aborted) throw err;
        } finally {
          drained.abort();
        }
        throwIfStreamFailed();
      }
    });

    throwIfStreamFailed();
    stream.write(JSON.stringify({ entryCount: total }) + '\n');
    stream.end();
    // Runs exactly once per export, so no listener accumulates here.
    const finished = new AbortController();
    try {
      await Promise.race([
        once(stream, 'finish', { signal: finished.signal }),
        once(stream, 'error', { signal: finished.signal }),
      ]);
    } catch (err) {
      if (!finished.signal.aborted) throw err;
    } finally {
      finished.abort();
    }
    throwIfStreamFailed();

    // Only a fully-written file is ever renamed into place, so a failed export
    // leaves the previous good map untouched rather than replacing it with a
    // truncated one.
    renameSync(tempPath, mapPath);
    return total;
  } catch (err) {
    stream.destroy();
    // Leave no partial temp file behind for the next run to trip over.
    if (existsSync(tempPath)) {
      try {
        unlinkSync(tempPath);
      } catch {
        // Best-effort cleanup; the original error is what matters.
      }
    }
    throw err;
  }
}

async function main(): Promise<void> {
  try {
    const total = await writeCoverageMap(COVERAGE_MAP_PATH, streamAllCoverageTestLinks);
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
    process.stderr.write(
      `[dump-coverage-map] fatal: ${err instanceof Error ? err.stack : String(err)}\n`,
    );
    process.exitCode = 1;
  });
}
