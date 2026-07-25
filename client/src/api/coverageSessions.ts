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

import axios from 'axios';
import apiClient from './axiosInstance.js';
import type { CoverageSession } from '@shared/schemas/coverageSessionSchema.js';

interface CoverageSessionResponse {
  session: CoverageSession;
}

/**
 * Result of a by-correlation-ID lookup, distinguishing a confirmed "no
 * active session" from "the lookup itself failed and tells us nothing" —
 * collapsing both into the same null value (found via Greptile PR review —
 * "Lookup failures erase active sessions") let a transient network/500/403
 * error masquerade as a real 404, causing callers to discard a correlation
 * ID whose session might still be perfectly active.
 */
export type CoverageSessionLookupResult =
  | { status: 'found'; session: CoverageSession }
  | { status: 'not-found' }
  | { status: 'lookup-failed' };

/**
 * Looks up the active session for a correlation ID. Returns 'not-found'
 * ONLY on a confirmed 404 from the server (unknown correlation ID, or its
 * session already ended) — any other failure (network error, 500, 403 from
 * the session-management routes being unregistered, etc.) returns
 * 'lookup-failed' instead, so callers can tell "confirmed gone" apart from
 * "we don't actually know" and avoid treating the latter as the former.
 */
export async function findActiveCoverageSessionByCorrelationId(
  correlationId: string,
): Promise<CoverageSessionLookupResult> {
  try {
    const response = await apiClient.get<CoverageSessionResponse>(
      `/admin/coverage/sessions/by-correlation/${correlationId}`,
    );
    return { status: 'found', session: response.data.session };
  } catch (err) {
    if (axios.isAxiosError(err) && err.response?.status === 404) {
      return { status: 'not-found' };
    }
    return { status: 'lookup-failed' };
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
