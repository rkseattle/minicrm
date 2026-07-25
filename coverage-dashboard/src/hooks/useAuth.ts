/**
 * Auth hook — wraps AUTH_ME_QUERY_KEY in the shape ProtectedRoute/LoginPage need.
 * Reuses minicrm-server's existing session-cookie auth (see api/auth.ts).
 */

import { useQuery } from '@tanstack/react-query';
import { AUTH_ME_QUERY_KEY, fetchCurrentUser } from '@/api/auth.js';

export function useAuth() {
  const { data: user, isLoading } = useQuery({
    queryKey: AUTH_ME_QUERY_KEY,
    queryFn: fetchCurrentUser,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  return {
    user: user ?? null,
    isAuthenticated: user !== null && user !== undefined,
    isLoading,
  };
}
