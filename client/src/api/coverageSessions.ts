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

export const COVERAGE_SESSIONS_QUERY_KEY = ['coverage_sessions'] as const;

interface CoverageSessionResponse {
  session: CoverageSession;
}

interface ListCoverageSessionsResponse {
  sessions: CoverageSession[];
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

export async function listActiveCoverageSessions(): Promise<CoverageSession[]> {
  const response = await apiClient.get<ListCoverageSessionsResponse>('/admin/coverage/sessions');
  return response.data.sessions;
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
