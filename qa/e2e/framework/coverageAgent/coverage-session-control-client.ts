/**
 * Reference client for the coverage session control API
 * (start/end/list/get/record-dump). Thin wrapper around RestClient, mirroring
 * coverage-control-client.ts's shape.
 *
 * Requires an authenticated RestClient (admin session) and the
 * coverage session management feature flag enabled, since the control API
 * is admin-only and flag-gated.
 */

import type { RestClient } from '../clients/rest-client.js';

const SESSIONS_ENDPOINT = '/api/v1/admin/coverage/sessions';

/** Correlation-ID header propagated to attribute requests to a session. */
export const CORRELATION_ID_HEADER = 'x-coverage-correlation-id';

const UNKNOWN_COMMIT_SHA = 'unknown';
const DEFAULT_ENVIRONMENT = 'local';

// Mirrors the server-side coverageConfig.ts pattern of the same name. There,
// the SHA becomes a filesystem path segment, so the check is a traversal
// guard. Here it never touches the filesystem — it goes into a SQL parameter
// — so the motive is purely DIAGNOSTIC: a malformed value (a branch-style ref
// like "feature/foo", stray whitespace, a value quoted by a misfiring
// `$(...)`) is far more useful as a warning at record time than as a
// zero-row query in the attestation gate forty minutes later.
//
// Deliberately NOT a 40-hex-SHA check: GIT_COMMIT_SHA is vendor-neutral and
// may legitimately carry a non-SHA build identifier.
const SAFE_BUILD_SHA_PATTERN = /^(?!\.\.?$)[A-Za-z0-9._-]+$/;

/**
 * Reasons already warned about in this process, keyed so each distinct
 * misconfiguration is reportable while the hundreds of identical repeats a
 * per-test resolver would otherwise produce are collapsed to one line.
 *
 * The resolver runs once per test inside each Playwright worker, so an
 * unguarded warning would be scrolled past. (The server's equivalent warns
 * unconditionally only because it resolves a single time at module load.)
 *
 * Injectable rather than reset via a test-only seam: playwright.config.ts sets
 * testDir: './tests' with fullyParallel, so framework specs share worker
 * processes — and this module instance — with functional tests that call this
 * resolver for every test. A reset seam would re-arm the latch underneath
 * those concurrent callers; passing a fresh set instead keeps each test's
 * warn-once behaviour entirely its own.
 */
const warnedBuildShaReasons = new Set<string>();

/**
 * The environment a SHA is resolved from. Injectable so tests never mutate the
 * real process.env: playwright.config.ts sets fullyParallel, and the per-test
 * fixture calls resolveSessionBuildSha() for EVERY test, so a spec that
 * reassigned process.env would corrupt the buildSha of unrelated functional
 * tests sharing its worker — reintroducing the exact defect this module
 * exists to prevent.
 */
export interface BuildShaEnv {
  GIT_COMMIT_SHA?: string | undefined;
  GITHUB_SHA?: string | undefined;
}

/** Sink the degradation warning is written to. Injectable for the same reason. */
export type BuildShaWarnSink = (message: string) => void;

function warnOnceAboutUnknownBuildSha(
  detail: string,
  warn: BuildShaWarnSink,
  seen: Set<string>,
): void {
  if (seen.has(detail)) return;
  seen.add(detail);
  warn(
    `[coverage-session] ${detail} — recording sessions with buildSha "${UNKNOWN_COMMIT_SHA}". ` +
      "These sessions will NOT match the attestation gate's --sha, which surfaces later as " +
      '"no-session-attribution" on an otherwise correct run. Fix: ' +
      'export GIT_COMMIT_SHA=$(git rev-parse HEAD) before starting the test stack. ' +
      'See docs/dev/coverage.md.',
  );
}

/**
 * Resolves the build SHA a session should be tagged with.
 *
 * Precedence: GIT_COMMIT_SHA (explicit, vendor-neutral override) > GITHUB_SHA
 * (set natively in GitHub Actions) > 'unknown'. Each variable is tested for a
 * NON-EMPTY value independently. An empty value previously won the `??` chain
 * outright and returned '', which the API rejects (coverageSessionSchema's
 * buildSha is min(1)) — and because the per-test fixture swallows a failed
 * start, that produced NO session at all rather than a bad one. Same
 * invisible outcome as 'unknown', different mechanism.
 *
 * This matches the server's coverageConfig.ts resolver on every input, empty
 * string included — that resolver was corrected to `||` in the same change so
 * the two cannot disagree. They must not: this one tags coverage SESSIONS
 * (what the attestation gate joins on) while that one tags coverage DUMPS
 * (what the coverage map keys on), and a split between them is invisible
 * until a map turns out to be unusable. The only remaining difference is the
 * last resort — the server can shell out to `git rev-parse HEAD`, meaningless
 * in its own container since no .git is mounted there.
 *
 * Kept independent of the server's resolver rather than importing it — this
 * module runs in the QA workspace's own process, not the server's.
 *
 * Degrading to 'unknown' is warned about once per process rather than being
 * silent: it is not an error (a run with no coverage attribution is still a
 * valid test run) but it is never what the operator wanted.
 */
export function resolveSessionBuildSha(
  env: BuildShaEnv = process.env,
  warn: BuildShaWarnSink = console.warn,
  seen: Set<string> = warnedBuildShaReasons,
): string {
  const explicit = env.GIT_COMMIT_SHA || env.GITHUB_SHA;

  if (!explicit) {
    warnOnceAboutUnknownBuildSha('Neither GIT_COMMIT_SHA nor GITHUB_SHA is set', warn, seen);
    return UNKNOWN_COMMIT_SHA;
  }

  if (!SAFE_BUILD_SHA_PATTERN.test(explicit)) {
    warnOnceAboutUnknownBuildSha(
      `GIT_COMMIT_SHA/GITHUB_SHA is set to a malformed value ("${explicit}")`,
      warn,
      seen,
    );
    return UNKNOWN_COMMIT_SHA;
  }

  return explicit;
}

/**
 * Resolves the environment label a session should be tagged with.
 * E2E_ENVIRONMENT lets CI/local setups self-identify (e.g. 'ci', 'local',
 * 'staging'); defaults to 'local' for a bare developer machine run.
 */
export function resolveSessionEnvironment(): string {
  return process.env['E2E_ENVIRONMENT'] ?? DEFAULT_ENVIRONMENT;
}

export type CoverageSessionSource = 'automated-e2e' | 'manual';
export type CoverageSessionStatus = 'active' | 'ended';

/** A coverage session, as returned by the control API. */
export interface CoverageSessionMetadata {
  id: string;
  label: string;
  source: CoverageSessionSource;
  status: CoverageSessionStatus;
  correlationId: string;
  buildSha: string;
  environment: string;
  issueKey: string | null;
  // Nullable — the starting user may have been deleted since (ON DELETE SET
  // NULL on coverage_sessions.started_by; see db migration 157 and
  // shared/schemas/coverageSessionSchema.ts's own CoverageSession type,
  // which this interface otherwise mirrors).
  startedById: string | null;
  startedAt: string;
  endedAt: string | null;
  version: number;
}

/** A single dump's attribution record within a session. */
export interface CoverageSessionDumpMetadata {
  id: string;
  sessionId: string;
  dumpId: string;
  correlationId: string;
  testId: string | null;
  testName: string | null;
  testFile: string | null;
  attempt: number;
  recordedAt: string;
}

export interface StartCoverageSessionParams {
  label: string;
  source: CoverageSessionSource;
  buildSha: string;
  environment: string;
  issueKey?: string;
}

/** Starts a new coverage session, minting a correlation ID for the caller to propagate. */
export async function startCoverageSession(
  restClient: RestClient,
  params: StartCoverageSessionParams,
): Promise<CoverageSessionMetadata> {
  const response = await restClient.post<{ session: CoverageSessionMetadata }>(
    SESSIONS_ENDPOINT,
    params,
  );
  return response.body.session;
}

/** Ends an active coverage session. Optimistic-locked on `version`. */
export async function endCoverageSession(
  restClient: RestClient,
  sessionId: string,
  version: number,
): Promise<CoverageSessionMetadata> {
  const response = await restClient.post<{ session: CoverageSessionMetadata }>(
    `${SESSIONS_ENDPOINT}/${sessionId}/end`,
    { version },
  );
  return response.body.session;
}

/** Looks up a single coverage session. */
export async function getCoverageSession(
  restClient: RestClient,
  sessionId: string,
): Promise<CoverageSessionMetadata> {
  const response = await restClient.get<{ session: CoverageSessionMetadata }>(
    `${SESSIONS_ENDPOINT}/${sessionId}`,
  );
  return response.body.session;
}

/**
 * Lists currently-active coverage sessions. The control API paginates this
 * endpoint (see paginationParamsSchema) — this wrapper always requests the
 * first page. Callers needing more than PAGINATION_DEFAULT_LIMIT sessions
 * should call the endpoint directly with an explicit page/limit.
 */
export async function listActiveCoverageSessions(
  restClient: RestClient,
): Promise<CoverageSessionMetadata[]> {
  const response = await restClient.get<{
    data: CoverageSessionMetadata[];
    total: number;
    page: number;
    limit: number;
  }>(SESSIONS_ENDPOINT);
  return response.body.data;
}

export interface RecordCoverageSessionDumpParams {
  dumpId: string;
  correlationId: string;
  testId?: string;
  testName?: string;
  testFile?: string;
  attempt?: number;
}

/** Records a coverage dump's attribution to a session (call after dumpCoverage). */
export async function recordCoverageSessionDump(
  restClient: RestClient,
  sessionId: string,
  params: RecordCoverageSessionDumpParams,
): Promise<CoverageSessionDumpMetadata> {
  const response = await restClient.post<{ sessionDump: CoverageSessionDumpMetadata }>(
    `${SESSIONS_ENDPOINT}/${sessionId}/dumps`,
    params,
  );
  return response.body.sessionDump;
}
