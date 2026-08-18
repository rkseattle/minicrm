/**
 * Append-only index of coverage dumps, for cheap dumpId lookups.
 *
 * Deliberately minimal: this is a lookup aid for the control API's
 * GET /dumps/:dumpId endpoint, not a mapping/query engine. One line per
 * dump written to `<dumpsRoot>/index.jsonl`; lookups tail an in-process
 * cache first, falling back to a linear scan of the file for cold starts.
 *
 * Use getSharedDumpIndex(dumpsRoot), not `new DumpIndex(dumpsRoot)`, from
 * any new call site — see that function's docblock for why two independent
 * instances against the same root is a correctness bug, not just a missed
 * cache-sharing optimization.
 */

import { appendFile, mkdir, readFile } from 'fs/promises';
import { dirname, join } from 'path';
import type { CoverageDump } from './sdk/CoverageAgentPlugin.js';

interface IndexEntry {
  dumpId: string;
  commitSha: string;
  capturedAt: string;
  metaPath: string;
}

/**
 * Append-only, file-backed index mapping dumpId -> dump metadata location.
 * One instance should be constructed per dumps-root directory.
 */
export class DumpIndex {
  private readonly indexPath: string;
  private readonly cache = new Map<string, IndexEntry>();
  // Caches the in-flight warm operation itself, not just a completion flag —
  // storing a boolean set before the read resolves would let a second
  // concurrent cold-start lookup see "warmed" while the cache is still
  // empty, producing a false negative for a dump that exists on disk.
  private warmPromise: Promise<void> | undefined;

  constructor(private readonly dumpsRoot: string) {
    this.indexPath = join(dumpsRoot, 'index.jsonl');
  }

  /** Appends an entry for a newly written dump. */
  async append(dump: CoverageDump, metaPath: string): Promise<void> {
    const entry: IndexEntry = {
      dumpId: dump.dumpId,
      commitSha: dump.commitSha,
      capturedAt: dump.capturedAt,
      metaPath,
    };
    await mkdir(dirname(this.indexPath), { recursive: true });
    await appendFile(this.indexPath, `${JSON.stringify(entry)}\n`, 'utf8');
    this.cache.set(entry.dumpId, entry);
  }

  /** Returns the metadata file path for a dumpId, or undefined if not found. */
  async lookup(dumpId: string): Promise<string | undefined> {
    if (this.cache.has(dumpId)) {
      return this.cache.get(dumpId)?.metaPath;
    }
    await this.warmCache();
    return this.cache.get(dumpId)?.metaPath;
  }

  private warmCache(): Promise<void> {
    // Assign synchronously so a second concurrent caller sees the same
    // promise instead of starting its own redundant read.
    this.warmPromise ??= this.readIndexIntoCache();
    return this.warmPromise;
  }

  private async readIndexIntoCache(): Promise<void> {
    let raw: string;
    try {
      raw = await readFile(this.indexPath, 'utf8');
    } catch {
      // Index file doesn't exist yet — no dumps have been written.
      return;
    }

    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      const entry = JSON.parse(line) as IndexEntry;
      this.cache.set(entry.dumpId, entry);
    }
  }
}

// One DumpIndex instance per dumpsRoot, process-wide. Both NodeV8CoverageAgent
// (which appends dumps as it writes them) and coverageDumpService (which
// looks dumps up by ID, e.g. for GET /dumps/:dumpId and, later, ingestion)
// must observe each other's writes through the SAME in-memory cache — each
// constructing its own `new DumpIndex(root)` against the same directory
// would let one instance's warmCache() permanently cache a stale "not
// found" for entries only ever appended to the other instance's cache
// (warmCache() cold-reads index.jsonl at most once per instance; an entry
// appended after that point via a different instance is invisible until
// process restart). Found via coverageIngestionService.test.ts reproducing
// a false "dump not found" for a dump written after an earlier lookup had
// already warmed a separate instance's cache.
const sharedIndexesByRoot = new Map<string, DumpIndex>();

/** Returns the single shared DumpIndex for a given dumps root, constructing it on first use. */
export function getSharedDumpIndex(dumpsRoot: string): DumpIndex {
  let index = sharedIndexesByRoot.get(dumpsRoot);
  if (!index) {
    index = new DumpIndex(dumpsRoot);
    sharedIndexesByRoot.set(dumpsRoot, index);
  }
  return index;
}

/**
 * Test-only: clears the shared-instance registry so the next
 * getSharedDumpIndex(dumpsRoot) call constructs a fresh DumpIndex instead
 * of reusing one whose in-memory cache refers to a dumpsRoot directory a
 * previous test already deleted. Without this, a test suite that deletes
 * and recreates the same COVERAGE_DUMPS_ROOT between tests (see
 * coverageIngestionService.test.ts / coveragePipelineController.test.ts)
 * would have its second test reuse the first test's now-stale DumpIndex
 * instance — same failure mode the shared singleton exists to prevent in
 * production, reintroduced across test boundaries instead of across
 * agent/service instances. Mirrors featureFlagService.__clearCacheForTest
 * and brandingService.__clearCacheForTest's naming convention.
 */
export function __clearSharedDumpIndexesForTest(): void {
  sharedIndexesByRoot.clear();
}
