/**
 * Coverage/TIA env configuration. (MINCRM-604, MINCRM-607)
 *
 * Centralizes env-var parsing for the coverage instrumentation framework,
 * mirroring how server.ts validates JWT_SECRET/NODE_ENCRYPTION_KEY once at
 * startup rather than reading process.env ad hoc elsewhere.
 */

import { execFileSync } from 'child_process';
import { join } from 'path';
import logger from '../logger.js';

/**
 * Directory backend/browser coverage dumps are written under.
 *
 * Single source of truth: both server.ts (constructing the agent) and
 * coverageDumpService.ts (ingesting browser dumps, looking up dumps by ID)
 * must resolve to the exact same path, or dumps written by one and looked
 * up by the other would silently miss.
 */
export const COVERAGE_DUMPS_ROOT = join(process.cwd(), 'coverage-dumps');

/** Coverage granularity: block/branch-level (default) or function-level only. */
export type CoverageGranularity = 'block' | 'function';

export interface CoverageConfig {
  /** Whether the backend V8 coverage agent should start at all. */
  enabled: boolean;
  /** V8 coverage detail level. Only meaningful when enabled=true. */
  granularity: CoverageGranularity;
  /** Commit/build SHA to tag dumps with. Never throws — falls back to 'unknown'. */
  commitSha: string;
}

const DEFAULT_GRANULARITY: CoverageGranularity = 'block';
const UNKNOWN_COMMIT_SHA = 'unknown';

// Commit SHA is used verbatim as a directory segment under COVERAGE_DUMPS_ROOT
// (see NodeV8CoverageAgent.persist / coverageDumpService.ingestBrowserCoverage).
// A path-separator or traversal sequence in an operator/CI-supplied
// GIT_COMMIT_SHA/GITHUB_SHA value could otherwise move dump writes outside
// the intended dumps root — restrict to a safe filename-segment charset.
const SAFE_PATH_SEGMENT_PATTERN = /^(?!\.\.?$)[A-Za-z0-9._-]+$/;

function resolveGranularity(): CoverageGranularity {
  return process.env.COVERAGE_GRANULARITY === 'function' ? 'function' : DEFAULT_GRANULARITY;
}

/**
 * Resolves the commit SHA to tag coverage dumps with.
 *
 * Precedence: GIT_COMMIT_SHA (explicit, vendor-neutral override) >
 * GITHUB_SHA (set natively in GitHub Actions) > `git rev-parse HEAD` (local
 * dev fallback). Never throws — a missing .git directory (e.g. some prod
 * containers) or a value unsafe to use as a filesystem path segment
 * degrades to 'unknown' rather than crashing server startup or writing
 * outside the dumps root.
 */
function resolveCommitSha(): string {
  const explicit = process.env.GIT_COMMIT_SHA ?? process.env.GITHUB_SHA;
  if (explicit) {
    if (!SAFE_PATH_SEGMENT_PATTERN.test(explicit)) {
      logger.warn(
        { explicit },
        'coverageConfig: GIT_COMMIT_SHA/GITHUB_SHA contains characters unsafe for a filesystem path segment — tagging dumps as unknown',
      );
      return UNKNOWN_COMMIT_SHA;
    }
    return explicit;
  }

  try {
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    // git rev-parse HEAD output is a 40-char hex SHA under normal operation,
    // so this should always match SAFE_PATH_SEGMENT_PATTERN — validated
    // anyway for defense in depth against an unexpected/corrupted .git state.
    return SAFE_PATH_SEGMENT_PATTERN.test(sha) ? sha : UNKNOWN_COMMIT_SHA;
  } catch (err) {
    logger.warn(
      { err },
      'coverageConfig: could not resolve commit SHA via git rev-parse — tagging dumps as unknown',
    );
    return UNKNOWN_COMMIT_SHA;
  }
}

/**
 * Resolves the coverage instrumentation config from the current environment.
 * Call once at server boot and pass the result down — do not re-read
 * process.env per request.
 */
export function resolveCoverageConfig(): CoverageConfig {
  return {
    enabled: process.env.COVERAGE_INSTRUMENTATION === 'true',
    granularity: resolveGranularity(),
    commitSha: resolveCommitSha(),
  };
}
