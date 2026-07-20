/**
 * Coverage/TIA env configuration. (MINCRM-604, MINCRM-607)
 *
 * Centralizes env-var parsing for the coverage instrumentation framework,
 * mirroring how server.ts validates JWT_SECRET/NODE_ENCRYPTION_KEY once at
 * startup rather than reading process.env ad hoc elsewhere.
 */

import { execFileSync } from 'child_process';
import logger from '../logger.js';

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

function resolveGranularity(): CoverageGranularity {
  return process.env.COVERAGE_GRANULARITY === 'function' ? 'function' : DEFAULT_GRANULARITY;
}

/**
 * Resolves the commit SHA to tag coverage dumps with.
 *
 * Precedence: GIT_COMMIT_SHA (explicit, vendor-neutral override) >
 * GITHUB_SHA (set natively in GitHub Actions) > `git rev-parse HEAD` (local
 * dev fallback). Never throws — a missing .git directory (e.g. some prod
 * containers) degrades to 'unknown' rather than crashing server startup.
 */
function resolveCommitSha(): string {
  const explicit = process.env.GIT_COMMIT_SHA ?? process.env.GITHUB_SHA;
  if (explicit) return explicit;

  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
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
