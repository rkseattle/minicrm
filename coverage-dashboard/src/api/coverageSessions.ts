/**
 * Coverage/TIA session API module. (MINCRM-609..612, MINCRM-663)
 * Wraps the session control endpoints — the manual-testing session recorder
 * moved here from minicrm-client's CoverageSessionRecorderPage.tsx, which is
 * deleted entirely as part of MINCRM-663 (internal CI/dev tooling has no
 * business being reachable through the product's own admin UI). Reimplemented
 * rather than imported: this app shares no code with minicrm-client beyond
 * @shared/schemas types. Endpoints require authentication, admin role, and
 * the COVERAGE_SESSION_MANAGEMENT env var being set at server boot (no
 * longer a product feature_flags row — see server/src/routes/coverageSessions.ts).
 */

import apiClient from './axiosInstance.js';
import type {
  CoverageSession,
  StartCoverageSessionRequest,
} from '@shared/schemas/coverageSessionSchema.js';
import type { PaginatedResponse } from '@shared/schemas/paginationSchema.js';
import { PAGINATION_MAX_LIMIT } from '@shared/schemas/paginationSchema.js';

export const COVERAGE_SESSIONS_QUERY_KEY = ['coverage_sessions'] as const;

interface CoverageSessionResponse {
  session: CoverageSession;
}

export async function startCoverageSession(
  params: StartCoverageSessionRequest,
): Promise<CoverageSession> {
  const response = await apiClient.post<CoverageSessionResponse>(
    '/admin/coverage/sessions',
    params,
  );
  return response.data.session;
}

export interface ListActiveCoverageSessionsParams {
  page?: number;
  limit?: number;
}

export async function listActiveCoverageSessions(
  params: ListActiveCoverageSessionsParams = {},
): Promise<PaginatedResponse<CoverageSession>> {
  const queryParams: Record<string, string> = {};
  if (params.page !== undefined) queryParams['page'] = String(params.page);
  if (params.limit !== undefined) queryParams['limit'] = String(params.limit);

  const response = await apiClient.get<PaginatedResponse<CoverageSession>>(
    '/admin/coverage/sessions',
    { params: queryParams },
  );
  return response.data;
}

/**
 * Fetches every active session across all pages — not just the first
 * PAGINATION_DEFAULT_LIMIT (found via Greptile PR review — "Pagination
 * hides active sessions"). SessionRecorderPage's entire purpose is to be
 * the one place an admin can find and check out ANY active session,
 * including one abandoned long enough that newer sessions pushed it past
 * page 1 — silently dropping it there would leave it active indefinitely
 * with no UI path to end it. Fetches PAGINATION_MAX_LIMIT (100) per page,
 * which comfortably covers the realistic scale of concurrent manual-testing
 * sessions (an internal admin tool, not a customer-facing high-volume list).
 */
export async function listAllActiveCoverageSessions(): Promise<CoverageSession[]> {
  const sessions: CoverageSession[] = [];
  let page = 1;
  for (;;) {
    const response = await listActiveCoverageSessions({ page, limit: PAGINATION_MAX_LIMIT });
    sessions.push(...response.data);
    if (sessions.length >= response.total || response.data.length === 0) break;
    page += 1;
  }
  return sessions;
}

export async function endCoverageSession(
  sessionId: string,
  version: number,
): Promise<CoverageSession> {
  const response = await apiClient.post<CoverageSessionResponse>(
    `/admin/coverage/sessions/${sessionId}/end`,
    { version },
  );
  return response.data.session;
}
