/**
 * Shared axios instance for the standalone Coverage/TIA dashboard.
 * External HTTP client of minicrm-server's public API only — no shared
 * codebase, no direct DB access: own repo, build and deploy, and no shared
 * route table.
 *
 * withCredentials + VITE_API_BASE_URL: in dev, Vite's own proxy (see
 * vite.config.ts) makes requests to '/api/v1' same-origin, so the httpOnly
 * session cookie from POST /auth/login is sent automatically. In a real
 * independent deployment (this app's own build and deploy target), the API
 * lives on a different origin — VITE_API_BASE_URL
 * must then be set to that origin's full /api/v1 URL, and the server's
 * CORS_ORIGIN allowlist must include this app's origin (server/src/app.ts),
 * since withCredentials requires an explicit CORS allowlist entry, not a
 * wildcard.
 */

import axios from 'axios';
import type { QueryClient } from '@tanstack/react-query';

const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? '/api/v1',
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
});

const SESSION_EXPIRY_EXCLUDED_PATHS = ['/auth/login', '/auth/me'];

/**
 * Registers the global 401 interceptor — same pattern as minicrm-client's
 * own axiosInstance.ts, reimplemented here rather than
 * imported since this app shares no code with minicrm-client.
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
        queryClient.clear();
        const next = encodeURIComponent(window.location.pathname + window.location.search);
        window.location.href = `/login?reason=session_expired&next=${next}`;
      }

      return Promise.reject(error);
    },
  );
}

export default apiClient;
