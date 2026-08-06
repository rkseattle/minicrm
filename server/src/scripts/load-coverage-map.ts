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
import { COVERAGE_MAP_PATH, COVERAGE_MAP_FORMAT } from './coverageMapPath.js';

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

/**
 * Exit code used when the committed map itself is corrupt, as distinct from an
 * infrastructure failure (database unreachable, missing credentials).
 *
 * Callers that treat a load as best-effort still need to tell the two apart: a
 * corrupt committed artifact is a real defect somebody must fix, while a local
 * database being down is a routine environment problem. Without a distinct
 * code the only option is to swallow both, which is the conflation this script
 * exists to remove. (MINCRM-703)
 */
export const EXIT_MAP_UNREADABLE = 2;

/** Raised when the map exists but cannot be used. Always fatal. */
export class CoverageMapUnreadableError extends Error {
  constructor(reason: string, mapPath: string = COVERAGE_MAP_PATH) {
    super(`${mapPath} is present but unusable: ${reason}`);
    this.name = 'CoverageMapUnreadableError';
  }
}

/** A test dictionary line: identity plus display metadata, written once. */
interface TestDictLine {
  t: number;
  testId: string;
  testName: string | null;
  testFile: string | null;
}

/** A unit dictionary line: the covered code unit's identity, written once. */
interface UnitDictLine {
  u: number;
  filePath: string;
  unitKey: string;
  branchId: string | null;
}

/**
 * Resolves one link line against the dictionaries seen so far.
 *
 * References are resolved as the file streams rather than after a full pass,
 * which is what keeps the reader's memory bounded by entity count. It also
 * means a link naming a reference that has not been defined yet is a real
 * error, not a forward declaration — the writer emits each dictionary line
 * before any link that uses it.
 *
 * @param link - The `l` tuple: [testRef, unitRef, hitCount].
 * @param tests - Test dictionary accumulated so far.
 * @param units - Unit dictionary accumulated so far.
 * @param lineNumber - 1-based line number, for the error message.
 * @param mapPath - File being read, for the error message.
 * @returns The reassembled entry.
 */
function resolveLink(
  link: unknown,
  tests: Map<number, TestDictLine>,
  units: Map<number, UnitDictLine>,
  lineNumber: number,
  mapPath: string,
): CoverageTestLinkExportEntry {
  if (!Array.isArray(link) || link.length !== 3) {
    throw new CoverageMapUnreadableError(
      `line ${lineNumber}'s link is not a [testRef, unitRef, hitCount] triple`,
      mapPath,
    );
  }
  const [testRef, unitRef, hitCount] = link as [unknown, unknown, unknown];
  if (typeof testRef !== 'number' || typeof unitRef !== 'number' || typeof hitCount !== 'number') {
    throw new CoverageMapUnreadableError(
      `line ${lineNumber}'s link has a non-numeric member`,
      mapPath,
    );
  }

  const test = tests.get(testRef);
  if (!test) {
    throw new CoverageMapUnreadableError(
      `line ${lineNumber} references test ${testRef}, which no earlier line defines`,
      mapPath,
    );
  }
  const unit = units.get(unitRef);
  if (!unit) {
    throw new CoverageMapUnreadableError(
      `line ${lineNumber} references unit ${unitRef}, which no earlier line defines`,
      mapPath,
    );
  }

  return {
    unitKey: unit.unitKey,
    branchId: unit.branchId,
    filePath: unit.filePath,
    testId: test.testId,
    testName: test.testName,
    testFile: test.testFile,
    hitCount,
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
  // Bounded by entity count — tests and code units — not by the link count,
  // which is the product of the two and the thing that must never be resident.
  const tests = new Map<number, TestDictLine>();
  const units = new Map<number, UnitDictLine>();
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
        // Reject an unrecognized layout rather than misparse it. The
        // denormalized version had no marker, so a file written by an older
        // exporter reports itself as version 1 by omission.
        const format = (header as { format?: unknown }).format ?? 1;
        if (format !== COVERAGE_MAP_FORMAT) {
          throw new CoverageMapUnreadableError(
            `it declares format ${String(format)}, but this reader understands ` +
              `only format ${COVERAGE_MAP_FORMAT} — regenerate it with the current exporter`,
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

      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch (err) {
        throw new CoverageMapUnreadableError(
          `line ${lineNumber} is not valid JSON (${err instanceof Error ? err.message : String(err)})`,
          mapPath,
        );
      }
      if (typeof parsed !== 'object' || parsed === null) {
        throw new CoverageMapUnreadableError(`line ${lineNumber} is not an object`, mapPath);
      }
      const record = parsed as Record<string, unknown>;

      // Dictionary lines define references; link lines consume them.
      //
      // Validated, not cast. A cast lets `{"t":0}` through with testId
      // undefined, which reaches the INSERT as NULL against a NOT NULL column —
      // surfacing as a raw pg error rather than CoverageMapUnreadableError. That
      // matters beyond tidiness: the exit code would then be 1 rather than
      // EXIT_MAP_UNREADABLE, and pre-push-tia.ts branches on exactly that code,
      // so a genuinely corrupt map would be reclassified as a local
      // infrastructure blip and the push would proceed.
      if (typeof record['t'] === 'number') {
        if (typeof record['testId'] !== 'string') {
          throw new CoverageMapUnreadableError(
            `line ${lineNumber} defines test ${record['t']} without a string testId`,
            mapPath,
          );
        }
        tests.set(record['t'], {
          t: record['t'],
          testId: record['testId'],
          testName: typeof record['testName'] === 'string' ? record['testName'] : null,
          testFile: typeof record['testFile'] === 'string' ? record['testFile'] : null,
        });
        continue;
      }
      if (typeof record['u'] === 'number') {
        if (typeof record['filePath'] !== 'string' || typeof record['unitKey'] !== 'string') {
          throw new CoverageMapUnreadableError(
            `line ${lineNumber} defines unit ${record['u']} without a string filePath and unitKey`,
            mapPath,
          );
        }
        units.set(record['u'], {
          u: record['u'],
          filePath: record['filePath'],
          unitKey: record['unitKey'],
          branchId: typeof record['branchId'] === 'string' ? record['branchId'] : null,
        });
        continue;
      }
      if (!('l' in record)) {
        throw new CoverageMapUnreadableError(
          `line ${lineNumber} is neither a test, a unit, nor a link`,
          mapPath,
        );
      }

      batch.push(resolveLink(record['l'], tests, units, lineNumber, mapPath));
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
    process.exitCode = err instanceof CoverageMapUnreadableError ? EXIT_MAP_UNREADABLE : 1;
  });
}
