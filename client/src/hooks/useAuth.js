/**
 * useAuth hook.
 * Wraps the /api/auth/me query with React Query.
 * Components use this to access the current user and authentication state.
 */

import { useQuery } from '@tanstack/react-query';
import { getMe } from '@/api/auth.js';

/** React Query cache key for the current user */
export const AUTH_QUERY_KEY = ['auth', 'me'];

/**
 * Returns the current user from the server, or null if unauthenticated.
 *
 * @returns {{ user: object|null, isLoading: boolean, isAuthenticated: boolean }}
 */
export function useAuth() {
  const { data, isLoading } = useQuery({
    queryKey: AUTH_QUERY_KEY,
    queryFn: getMe,
    // Do not retry on 401 — unauthenticated is a valid state, not an error
    retry: (failureCount, error) => {
      if (error?.response?.status === 401) return false;
      return failureCount < 2;
    },
    // Treat 401 as a successful "no user" response rather than an error state
    throwOnError: false,
  });

  const user = data?.user ?? null;

  return {
    user,
    isLoading,
    isAuthenticated: user !== null,
  };
}
