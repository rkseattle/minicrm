/**
 * Coverage/TIA session API — CRM-client side. (MINCRM-663)
 *
 * The CRM client never starts or lists sessions itself (that UI lives in the
 * standalone coverage-dashboard app — see coverage-dashboard/src/api/
 * coverageSessions.ts). It only needs to reconcile against the session its
 * own persisted correlation ID (see coverageCorrelation.ts) points to: to
 * end it from the CRM's own "Check out" affordance, and to detect the
 * session was already ended from the dashboard so it can stop attaching a
 * dead correlation ID to every request.
 */

import apiClient from './axiosInstance.js';
import type { CoverageSession } from '@shared/schemas/coverageSessionSchema.js';

interface CoverageSessionResponse {
  session: CoverageSession;
}

/**
 * Looks up the active session for a correlation ID, or null if none is
 * active for it (unknown ID, or already ended elsewhere).
 */
export async function findActiveCoverageSessionByCorrelationId(
  correlationId: string,
): Promise<CoverageSession | null> {
  try {
    const response = await apiClient.get<CoverageSessionResponse>(
      `/admin/coverage/sessions/by-correlation/${correlationId}`,
    );
    return response.data.session;
  } catch {
    // 404 (unknown/ended), 403 (coverage_session_management routes
    // unregistered), or any other transient failure — all treated the same
    // way by callers: nothing currently reconciles, so behave as if there is
    // no active session for this correlation ID.
    return null;
  }
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
