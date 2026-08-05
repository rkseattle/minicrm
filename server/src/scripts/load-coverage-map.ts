/**
 * load-coverage-map.ts
 *
 * Re-populates coverage_test_links from the committed map before any
 * selection-time query runs, so TIA has real mapping data in an otherwise-empty
 * database. Invoked by ci.yml's tia-selection job and by the pre-push hook.
 *
 * STREAMS the file line by line. The previous implementation read the whole map
 * into one string and JSON.parse'd it, hitting V8's 512MB max string length at
 * the same threshold that killed the writer — a file the exporter had
 * successfully produced could still be unreadable here.
 *
 * ABSENT IS NOT THE SAME AS UNREADABLE. The previous implementation returned
 * null for both from a bare `catch {}`, after which main() printed "No
 * committed map found ... (or it failed to parse)" and exited 0. A map too
 * large, truncated, or corrupt therefore degraded TIA to the full-suite safety
 * net silently and greenly, in both CI and pre-push. ci.yml's own comments
 * record that this fallback already masked a real infrastructure failure once.
 * So: a missing file is a legitimate no-op and exits 0; a file that is present
 * but cannot be read, parsed, or verified complete is a hard failure.
 *
 * Usage (from repo root):
 *   npm run load:coverage-map --workspace=minicrm-server -- --sha=<commit-sha>
 */

import { existsSync, createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  beginCoverageMapLoad,
  type CoverageMapLoadSession,
  type CoverageTestLinkExportEntry,
} from '../services/coverageMappingService.js';
import coverageDb from '../coverageDb.js';
import { COVERAGE_MAP_PATH } from './coverageMapPath.js';

/** Entries buffered before being flushed to the open transaction. */
const LOAD_BATCH_SIZE = 5000;

/**
 * Exported for direct unit testing (MINCRM-696). The `=`-preserving split below
 * is a correctness property, not a style choice, and it was previously unpinned
 * in every copy of this idiom in the repo.
 */
export function parseArgs(argv: readonly string[]): { sha: string } {
  const shaArg = argv.find((a) => a.startsWith('--sha='));
  // .slice(1).join('=') rather than [1]: --sha is not always a 40-hex SHA.
  // pre-push-tia.ts's resolveMainSha falls back to the literal symbolic ref
  // `main`, and a ref may contain '=' (`git check-ref-format
  // 'refs/heads/foo=bar'` exits 0). Truncating at the first '=' would key
  // coverage_test_links to a DIFFERENT commit, silently narrowing the selection
  // that mapping feeds. (MINCRM-696)
  const sha = shaArg?.split('=').slice(1).join('=');
  if (!sha) {
    throw new Error('Usage: --sha=<commit-sha>');
  }
  return { sha };
}

/** Raised when the map exists but cannot be used. Always fatal. */
export class CoverageMapUnreadableError extends Error {
  constructor(reason: string, mapPath: string = COVERAGE_MAP_PATH) {
    super(`${mapPath} is present but unusable: ${reason}`);
    this.name = 'CoverageMapUnreadableError';
  }
}

/**
 * Parses one entry line, rejecting anything that would not survive the insert.
 *
 * Validated rather than cast: the previous implementation cast the parsed file
 * to its expected type and checked only that `entries` was an array, so a
 * malformed entry passed the gate and failed later inside the SQL insert, with
 * an error naming a constraint rather than the file.
 *
 * @param line - Raw JSONL line.
 * @param lineNumber - 1-based line number, for the error message.
 * @returns The parsed entry.
 */
function parseEntryLine(
  line: string,
  lineNumber: number,
  mapPath: string,
): CoverageTestLinkExportEntry {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch (err) {
    throw new CoverageMapUnreadableError(
      `line ${lineNumber} is not valid JSON (${err instanceof Error ? err.message : String(err)})`,
      mapPath,
    );
  }

  const entry = parsed as Partial<CoverageTestLinkExportEntry>;
  if (
    typeof entry.unitKey !== 'string' ||
    typeof entry.filePath !== 'string' ||
    typeof entry.testId !== 'string' ||
    typeof entry.hitCount !== 'number'
  ) {
    throw new CoverageMapUnreadableError(
      `line ${lineNumber} is missing a required field (unitKey, filePath, testId, hitCount)`,
      mapPath,
    );
  }

  return {
    unitKey: entry.unitKey,
    branchId: entry.branchId ?? null,
    filePath: entry.filePath,
    testId: entry.testId,
    testName: entry.testName ?? null,
    testFile: entry.testFile ?? null,
    hitCount: entry.hitCount,
  };
}

/**
 * Recognizes the entry-count trailer.
 *
 * @param line - Raw JSONL line.
 * @returns The declared count, or null when this line is not a trailer.
 */
function tryParseTrailer(line: string): number | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    // Not JSON at all — let the entry parser report it, with its line number.
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const count = (parsed as { entryCount?: unknown }).entryCount;
  return typeof count === 'number' ? count : null;
}

/**
 * Streams the map into the database under the given commit SHA.
 *
 * @param sha - Commit SHA every entry is re-keyed to.
 * @param mapPath - File to read. Overridable so tests never touch the real
 *   committed map, which only a multi-hour record-mode run can regenerate.
 * @returns The number of entries loaded, or null when no map file exists.
 */
export async function loadCoverageMap(
  sha: string,
  mapPath: string = COVERAGE_MAP_PATH,
): Promise<number | null> {
  if (!existsSync(mapPath)) {
    return null;
  }

  const reader = createInterface({
    input: createReadStream(mapPath, { encoding: 'utf-8' }),
    crlfDelay: Infinity,
  });

  // Opened lazily, on the first batch that actually needs writing. A malformed
  // file is rejected by parsing alone, so a validation failure never opens a
  // transaction, never holds a connection, and never needs a database to be
  // reachable at all.
  let session: CoverageMapLoadSession | undefined;

  /**
   * Returns the load session, opening it on first use.
   *
   * @returns The open session.
   */
  async function openSession(): Promise<CoverageMapLoadSession> {
    if (session === undefined) {
      session = await beginCoverageMapLoad(sha);
    }
    return session;
  }

  let generatedAt: string | null = null;
  let declaredCount: number | null = null;
  let loaded = 0;
  let lineNumber = 0;
  // Counts non-blank lines, so a leading blank line does not shift the header
  // out of position and turn "this is not a header" into the much less useful
  // "an entry is missing a required field".
  let contentLines = 0;
  let batch: CoverageTestLinkExportEntry[] = [];

  try {
    for await (const rawLine of reader) {
      lineNumber++;
      const line = rawLine.trim();
      if (!line) continue;
      contentLines++;

      // Nothing may follow the trailer. Without this the trailer is not
      // actually proof the writer finished — a file with entries appended
      // after it, or two interleaved writers, would load whenever the counts
      // happened to reconcile.
      if (declaredCount !== null) {
        throw new CoverageMapUnreadableError(
          `line ${lineNumber} appears after the entry-count trailer`,
          mapPath,
        );
      }

      if (contentLines === 1) {
        let header: { generatedAt?: unknown };
        try {
          header = JSON.parse(line) as { generatedAt?: unknown };
        } catch (err) {
          throw new CoverageMapUnreadableError(
            `the first line is not valid JSON (${err instanceof Error ? err.message : String(err)})`,
            mapPath,
          );
        }
        if (typeof header.generatedAt !== 'string') {
          throw new CoverageMapUnreadableError(
            'the first line is not a header with generatedAt',
            mapPath,
          );
        }
        generatedAt = header.generatedAt;
        continue;
      }

      // The trailer is the writer's proof it reached the end. Detected by
      // parsing rather than by a byte prefix: the runbook now tells operators
      // to inspect this line by hand, and a re-serialized `{ "entryCount": 1 }`
      // would otherwise be read as an entry and rejected with a confusing
      // "missing a required field".
      const trailerCount = tryParseTrailer(line);
      if (trailerCount !== null) {
        declaredCount = trailerCount;
        continue;
      }

      batch.push(parseEntryLine(line, lineNumber, mapPath));
      if (batch.length >= LOAD_BATCH_SIZE) {
        await (await openSession()).appendBatch(batch);
        loaded += batch.length;
        batch = [];
      }
    }

    if (generatedAt === null) {
      throw new CoverageMapUnreadableError('the file is empty', mapPath);
    }
    // Validate completeness BEFORE writing the tail batch, so a truncated file
    // is rejected without a transaction ever being opened.
    const pendingCount = loaded + batch.length;
    // No trailer means the writer never finished — a job killed mid-export.
    // Loading what is there would silently narrow every later selection.
    if (declaredCount === null) {
      throw new CoverageMapUnreadableError(
        'no entry-count trailer — the export was interrupted and the file is truncated',
        mapPath,
      );
    }
    if (declaredCount !== pendingCount) {
      throw new CoverageMapUnreadableError(
        `entry-count mismatch: the trailer declares ${declaredCount} but ${pendingCount} were read`,
        mapPath,
      );
    }

    if (batch.length > 0) {
      await (await openSession()).appendBatch(batch);
      loaded += batch.length;
    }

    // An empty but well-formed map still has to clear the target SHA's rows,
    // so the session is opened even when there was nothing to append.
    await (await openSession()).commit();
    process.stderr.write(
      `[load-coverage-map] Loaded ${loaded} mapping(s) from ${mapPath} (generated ${generatedAt}) for commit ${sha}.\n`,
    );
    return loaded;
  } catch (error) {
    await session?.rollback();
    throw error;
  } finally {
    reader.close();
  }
}

async function main(): Promise<void> {
  const { sha } = parseArgs(process.argv.slice(2));
  try {
    const loaded = await loadCoverageMap(sha);
    if (loaded === null) {
      // A genuinely absent map is a legitimate state — before the first
      // record-mode run has ever committed one — and must not fail the job.
      process.stderr.write(
        `[load-coverage-map] No committed map at ${COVERAGE_MAP_PATH} — leaving coverage_test_links empty for ${sha}. Selection will fall back to the unmapped-changes safety net.\n`,
      );
    }
  } finally {
    await coverageDb.end();
  }
}

const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] && __filename === resolvePath(process.argv[1])) {
  main().catch((err: unknown) => {
    process.stderr.write(
      `[load-coverage-map] fatal: ${err instanceof Error ? err.stack : String(err)}\n`,
    );
    process.exitCode = 1;
  });
}
