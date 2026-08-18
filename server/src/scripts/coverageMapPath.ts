/**
 * Location of the committed coverage map.
 *
 * Shared by dump-coverage-map.ts and load-coverage-map.ts, which previously
 * derived the same path independently — a latent drift where the writer and the
 * reader could disagree about which file is authoritative, and the reader would
 * report "no map found" rather than anything pointing at the mismatch.
 *
 * .jsonl, not .json: the file is now line-delimited JSON so neither end has to
 * hold it in memory, and a .json extension on a file that is not valid JSON
 * breaks every generic reader silently.
 */

import { resolve as resolvePath, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Repo root, from server/src/scripts/. */
const REPO_ROOT = resolvePath(__dirname, '../../..');

/** The committed map. */
export const COVERAGE_MAP_PATH = resolvePath(REPO_ROOT, 'qa/coverage-map.jsonl');

/**
 * Version of the committed map's layout.
 *
 * 2 is the normalized layout: interned test and unit dictionaries followed by
 * compact link rows. 1 was the denormalized one, where every entry repeated its
 * test name and both file paths — most of the file at real scale, and enough to
 * push it past GitHub's 100MB per-file push limit.
 *
 * Present so a reader can reject a file it does not understand rather than
 * misparse one. Version 1 had no marker at all, so the only symptom of reading
 * the wrong layout was that every line failed validation.
 */
export const COVERAGE_MAP_FORMAT = 2;
