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
 *
 * Terminates on a short page (data.length < limit), NEVER on comparing the
 * running count against `total` (found via Greptile PR review — "Concurrent
 * pagination omits sessions"): the underlying query is `WHERE status =
 * 'active' OFFSET ... LIMIT ...`, re-evaluated fresh on every request, so a
 * session ended (removed from the active set) between two page fetches
 * shifts every later row backward by one offset AND shrinks `total` — a
 * total-based check can true-positive on a stale, now-too-low total and
 * stop before the last (shifted) page is ever fetched. A short page is the
 * only signal that can't be fooled by concurrent deletes. The same shift
 * can also cause a row straddling two fetches to appear on both pages, so
 * results are deduplicated by id before returning.
 */
export async function listAllActiveCoverageSessions(): Promise<CoverageSession[]> {
  const seen = new Map<string, CoverageSession>();
  let page = 1;
  for (;;) {
    const response = await listActiveCoverageSessions({ page, limit: PAGINATION_MAX_LIMIT });
    for (const session of response.data) {
      seen.set(session.id, session);
    }
    if (response.data.length < PAGINATION_MAX_LIMIT) break;
    page += 1;
  }
  return Array.from(seen.values());
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
