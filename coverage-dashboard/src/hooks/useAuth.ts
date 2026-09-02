/**
 * Auth hook — wraps AUTH_ME_QUERY_KEY in the shape ProtectedRoute/LoginPage need.
 * Reuses minicrm-server's existing session-cookie auth (see api/auth.ts).
 *
 * VITE_COVERAGE_DASHBOARD_NO_AUTH=true skips the GET /auth/me call entirely
 * and reports "authenticated, no user" unconditionally — this dashboard is a
 * pure internal tool with no auth system of its own, and requiring a CRM
 * admin login just to view coverage/gap data is unnecessary friction when
 * the server this app talks to has its own matching
 * COVERAGE_DASHBOARD_NO_AUTH=true (see coverageReporting.ts). If only this
 * client flag is set without the server-side counterpart, ProtectedRoute
 * still passes through, but every actual API call the app makes will 401
 * from the server's own auth check — the two flags are meant to be set
 * together, not independently.
 */

import { useQuery } from '@tanstack/react-query';
import { AUTH_ME_QUERY_KEY, fetchCurrentUser } from '@/api/auth.js';

/**
 * Read at call time, not captured in a module-level constant: Vitest's
 * import.meta.env stubbing (vi.stubEnv) only affects reads that happen
 * AFTER the stub is applied — a `const` computed once at module-import
 * time (before any test's beforeEach runs) would never observe a later
 * per-test stub, making this untestable without a full module re-import
 * per test case (mirrors the same lesson learned server-side in
 * coverageReporting.ts's own COVERAGE_DASHBOARD_NO_AUTH check).
 */
export function isNoAuthMode(): boolean {
  return import.meta.env.VITE_COVERAGE_DASHBOARD_NO_AUTH === 'true';
}

/**
 * The current-user query's options, shared so a caller warming the cache writes
 * an entry with the same staleTime this hook reads it under. Declared in two
 * places, they drift, and a warm-up written under the client default is stale on
 * arrival — the refetch it exists to avoid.
 */
export const authQueryOptions = {
  queryKey: AUTH_ME_QUERY_KEY,
  queryFn: fetchCurrentUser,
  staleTime: 5 * 60 * 1000,
  retry: false,
} as const;

export function useAuth() {
  const { data: user, isLoading } = useQuery({
    ...authQueryOptions,
    enabled: !isNoAuthMode(),
  });

  if (isNoAuthMode()) {
    return { user: null, isAuthenticated: true, isLoading: false };
  }

  return {
    user: user ?? null,
    isAuthenticated: user !== null && user !== undefined,
    isLoading,
  };
}
