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

/**
 * Resolves the build SHA a session should be tagged with. Same precedence as
 * the server's coverageConfig.ts: GIT_COMMIT_SHA (explicit, vendor-neutral
 * override) > GITHUB_SHA (set natively in GitHub Actions) > 'unknown'. Kept
 * independent of the server's resolver rather than importing it — this
 * module runs in the QA workspace's own process, not the server's.
 */
export function resolveSessionBuildSha(): string {
  return process.env['GIT_COMMIT_SHA'] ?? process.env['GITHUB_SHA'] ?? UNKNOWN_COMMIT_SHA;
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
