/**
 * Coverage/TIA session API module. (MINCRM-609..612)
 * Wraps the session control endpoints. All endpoints require authentication,
 * admin role, and the coverage_session_management feature flag.
 */

import apiClient from './axiosInstance.js';
import type {
  CoverageSession,
  StartCoverageSessionRequest,
} from '@shared/schemas/coverageSessionSchema.js';
import type { PaginatedResponse } from '@shared/schemas/paginationSchema.js';

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
