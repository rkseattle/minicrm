/**
 * Shared axios instance.
 * All API modules import from here so that withCredentials (for httpOnly cookie
 * handling) and the base URL are applied consistently.
 *
 * setupInterceptors() wires a global 401 interceptor that clears
 * the React Query cache and redirects to /login?reason=session_expired when any
 * authenticated API call receives a 401. Call once from main.tsx after the
 * QueryClient is created.
 */

import axios from 'axios';
import type { QueryClient } from '@tanstack/react-query';
import { CORRELATION_ID_HEADER } from '@shared/schemas/coverageSessionSchema.js';
import { getPersistedCoverageCorrelationId } from '../coverageCorrelation.js';

const apiClient = axios.create({
  baseURL: '/api/v1',
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

// forwards a manual-testing coverage session's correlation ID
// (see coverageCorrelation.ts) on every outgoing request, so requests made
// in this CRM tab are attributed to the session started in the separate
// coverage-dashboard app. Reads localStorage on every request rather than
// caching the value once, since a check-out (or a fresh check-in) can
// change it mid-session without a page reload. A no-op — no header set —
// for the overwhelming majority of requests, where no session is active.
apiClient.interceptors.request.use((config) => {
  const correlationId = getPersistedCoverageCorrelationId();
  if (correlationId) {
    config.headers.set(CORRELATION_ID_HEADER, correlationId);
  }
  return config;
});

/**
 * Paths that must NOT trigger the session-expired redirect on 401.
 * - /auth/login: a 401 here means wrong credentials, not session expiry
 * - /auth/me: handled by ProtectedRoute; redirecting here would cause a
 *   double-redirect flash on initial page load
 */
const SESSION_EXPIRY_EXCLUDED_PATHS = [
  '/auth/login',
  '/auth/me',
  // Public endpoint — called by the login page before any session exists
  '/settings/sso/status',
];

/**
 * Registers the global 401 interceptor.
 *
 * On any 401 response from an authenticated API call, clears the React Query
 * cache and navigates to /login with ?reason=session_expired and the current
 * path as ?next= so the user lands back where they were after re-authenticating.
 *
 * Must be called exactly once, after the QueryClient is created.
 */
export function setupInterceptors(queryClient: QueryClient): void {
  apiClient.interceptors.response.use(
    (response) => response,
    (error: unknown) => {
      if (!axios.isAxiosError(error)) return Promise.reject(error);

      const status = error.response?.status;
      const requestPath = error.config?.url ?? '';

      const isExcluded = SESSION_EXPIRY_EXCLUDED_PATHS.some((p) => requestPath.includes(p));

      if (status === 401 && !isExcluded) {
        // Clear all cached query data so stale authenticated content is not shown
        // after the user re-authenticates.
        queryClient.clear();

        // Preserve current location so the user returns there after re-authenticating.
        const next = encodeURIComponent(window.location.pathname + window.location.search);
        window.location.href = `/login?reason=session_expired&next=${next}`;
      }

      return Promise.reject(error);
    },
  );
}

export default apiClient;
