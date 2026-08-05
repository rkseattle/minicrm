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
 * breaks every generic reader silently. (MINCRM-703)
 */

import { resolve as resolvePath, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Repo root, from server/src/scripts/. */
const REPO_ROOT = resolvePath(__dirname, '../../..');

/** The committed map. */
export const COVERAGE_MAP_PATH = resolvePath(REPO_ROOT, 'qa/coverage-map.jsonl');

/**
 * Where the export writes before renaming into place.
 *
 * PID-scoped so concurrent writers cannot collide on it.
 */
export const COVERAGE_MAP_TEMP_PATH = `${COVERAGE_MAP_PATH}.${process.pid}.tmp`;
