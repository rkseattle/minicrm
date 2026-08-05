/**
 * Shared reader for per-worker JSON artifacts.
 *
 * Parallel workers each write their own artifact file, which a merge step then
 * combines into one report. Three modules had byte-identical copies of this
 * read — healing events, merged healing events, and performance samples —
 * differing only in the payload key.
 *
 * All three swallowed every failure into an empty array, so a corrupt or
 * unreadable artifact silently dropped that worker's entire contribution from
 * the merged report with no signal. That is a wrong result, not a degraded one:
 * healed locators are the evidence used to diagnose selector drift, and
 * reporting fewer than occurred inverts the signal; a perf report that
 * under-counts samples misstates the measurement it exists to produce.
 *
 * Absent still yields an empty array — a worker that recorded nothing writes no
 * file, which is normal. Present-but-unreadable now says so on stderr before
 * degrading, so the shortfall is diagnosable. Deliberately not a throw: these
 * run inside reporters at the end of a suite, and failing the run over a
 * reporting problem would be worse than the under-count.
 */

import fs from 'node:fs';

/**
 * Reads an array payload from a worker artifact.
 *
 * @param filePath - Path to the worker's JSON artifact.
 * @param key - Property holding the array (e.g. 'events', 'samples').
 * @param label - Prefix for the diagnostic, naming the calling reporter.
 * @returns The array, or empty when the file is absent or unusable.
 */
export function readWorkerArtifact<T>(filePath: string, key: string, label: string): T[] {
  if (!fs.existsSync(filePath)) return [];

  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const payload = parsed[key];
    if (!Array.isArray(payload)) {
      process.stderr.write(
        `[${label}] ${filePath} has no '${key}' array — this worker's records are missing from the merged report.\n`,
      );
      return [];
    }
    return payload as T[];
  } catch (err) {
    process.stderr.write(
      `[${label}] ${filePath} exists but could not be read or parsed ` +
        `(${err instanceof Error ? err.message : String(err)}) — this worker's ` +
        `records are missing from the merged report.\n`,
    );
    return [];
  }
}

/**
 * Reads records from an append-only JSONL history file.
 *
 * Malformed lines are skipped rather than fatal — deliberately, and unlike the
 * coverage map: these files accumulate across runs, so one corrupt record must
 * not make the rest of the history unreadable. But the count of skipped lines is
 * reported, because "silently dropped some records" and "the file was clean" are
 * otherwise indistinguishable, and a steadily-growing skip count is the only
 * visible symptom of a writer that has started emitting bad lines.
 *
 * A missing file yields an empty array — normal, since nothing has been recorded
 * yet. A file that exists but cannot be READ says so, since that is a different
 * problem with a different fix.
 *
 * @param filePath - Path to the JSONL file.
 * @param label - Prefix for diagnostics, naming the calling reporter.
 * @returns Every well-formed record in the file.
 */
export function readJsonlRecords<T>(filePath: string, label: string): T[] {
  if (!fs.existsSync(filePath)) return [];

  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    process.stderr.write(
      `[${label}] ${filePath} exists but could not be read ` +
        `(${err instanceof Error ? err.message : String(err)}) — treating it as empty.\n`,
    );
    return [];
  }

  const records: T[] = [];
  let skipped = 0;
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      records.push(JSON.parse(trimmed) as T);
    } catch {
      skipped++;
    }
  }

  if (skipped > 0) {
    process.stderr.write(
      `[${label}] skipped ${skipped} malformed line(s) in ${filePath} — ` +
        `the remaining ${records.length} were read.\n`,
    );
  }

  return records;
}
