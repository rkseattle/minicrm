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
// Exported solely so the QA-side session resolver's parity test can assert
// against THIS definition rather than a copy of it. The two resolvers are
// deliberately not shared code (qa/e2e/framework/ must stay free of server
// imports at runtime), so a test is what pins them together — the same
// arrangement CLAUDE.md documents for the
// qa/scripts/junit-xml.ts <-> server/src/scripts/junitXml.ts pair. A copy of
// the regex in the test would go on passing while the two implementations
// drifted, which is exactly the failure it exists to catch.
export const SAFE_PATH_SEGMENT_PATTERN = /^(?!\.\.?$)[A-Za-z0-9._-]+$/;

function resolveGranularity(): CoverageGranularity {
  return process.env.COVERAGE_GRANULARITY === 'function' ? 'function' : DEFAULT_GRANULARITY;
}

/**
 * Resolves the repo root coverage symbolication relativizes file paths
 * against (see coverageSymbolicationService.ts's use of this for both the
 * backend V8 and frontend Istanbul paths).
 *
 * process.cwd() is NOT reliably the repo root: `npm run <script>
 * --workspace=<name>` sets the spawned process's cwd to that workspace's
 * own subdirectory (e.g. server/), not the repo root, on every npm version
 * from 7 onward. This repo's own e2e-functional/e2e-serial CI jobs start
 * the server via exactly that form (`npm run start --workspace=minicrm-server`),
 * so process.cwd() there is <repo>/server — anything under shared/ or
 * client/ (e.g. every frontend Istanbul dump) then fails
 * resolveScriptPath's/symbolicateIstanbulCoverageMap's containment check
 * and falls back to an unrelativized, unportable absolute path (found via a
 * real local coverage-map generation run, MINCRM-636/637). CI sets
 * COVERAGE_SOURCE_ROOT=github.workspace (see e2e-infra/action.yml) to fix
 * this, since both the backend and Vite there run under one shared
 * checkout.
 *
 * This resolves ONLY the backend-vs-workspace-cwd mismatch above. Local
 * Docker's test-server container has no such mismatch for its OWN process
 * (its command is a direct `npx tsx server/src/server.ts` with WORKDIR /app
 * as the repo root, so process.cwd() already IS the repo root there) — but
 * that local topology has a SEPARATE, unresolved problem this function does
 * not fix: the E2E harness runs Vite directly on the host while the server
 * runs inside this container, so every frontend Istanbul dump's absolute
 * path is a host path (e.g. /Users/x/minicrm/client/src/...) the container
 * can never see under any COVERAGE_SOURCE_ROOT value, since the host tree
 * isn't bind-mounted at a matching path. Locally, frontend units fall back
 * to their raw absolute path and are marked resolved=false — a known,
 * accepted limitation of this split topology, not something this env var
 * addresses.
 */
export function resolveSourceRoot(): string {
  return process.env.COVERAGE_SOURCE_ROOT ?? process.cwd();
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
  // `||`, not `??`: docker-compose.test.yml sets `GIT_COMMIT_SHA:
  // ${GIT_COMMIT_SHA:-}`, so an operator who never exported the variable gives
  // this process an EMPTY string rather than an unset one. Under `??` that
  // empty value shadowed GITHUB_SHA entirely and skipped straight to the
  // git-rev-parse fallback, contradicting the documented precedence above.
  // Matches the QA-side resolver in
  // qa/e2e/framework/coverageAgent/coverage-session-control-client.ts, which
  // tags coverage SESSIONS while this one tags coverage DUMPS — the two must
  // agree or the attestation gate and the coverage map key off different SHAs.
  const explicit = process.env.GIT_COMMIT_SHA || process.env.GITHUB_SHA;
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
