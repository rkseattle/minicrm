/**
 * Append-only index of coverage dumps, for cheap dumpId lookups. (MINCRM-606)
 *
 * Deliberately minimal: this is a lookup aid for the control API's
 * GET /dumps/:dumpId endpoint, not a mapping/query engine. One line per
 * dump written to `<dumpsRoot>/index.jsonl`; lookups tail an in-process
 * cache first, falling back to a linear scan of the file for cold starts.
 */

import { appendFile, mkdir, readFile } from 'fs/promises';
import { dirname, join } from 'path';
import type { CoverageDump } from './CoverageAgent.js';

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
