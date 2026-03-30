/**
 * useAuth hook.
 * Wraps the /api/auth/me query with React Query.
 * Components use this to access the current user and authentication state.
 */

import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import type { AxiosError } from 'axios';
import { getMe } from '@/api/auth.js';
import { applyResolvedLanguage } from '@/i18n.js';
import type { UserResponse } from '@shared/schemas/userSchema.js';

/** React Query cache key for the current user */
export const AUTH_QUERY_KEY = ['auth', 'me'] as const;

interface UseAuthResult {
  user: UserResponse | null;
  isLoading: boolean;
  isAuthenticated: boolean;
}

/**
 * Returns the current user from the server, or null if unauthenticated.
 */
export function useAuth(): UseAuthResult {
  const { data, isLoading } = useQuery({
    queryKey: AUTH_QUERY_KEY,
    queryFn: getMe,
    // Do not retry on 401 — unauthenticated is a valid state, not an error
    retry: (failureCount, error) => {
      const axiosError = error as AxiosError;
      if (axiosError?.response?.status === 401) return false;
      return failureCount < 2;
    },
    // Treat 401 as a successful "no user" response rather than an error state
    throwOnError: false,
  });

  // Apply the resolved language whenever auth state is loaded.
  // preferredLanguage is the personal preference stored on the user record;
  // applyResolvedLanguage falls through to the system default when it is null.
  useEffect(() => {
    if (data !== undefined) {
      void applyResolvedLanguage(data?.preferredLanguage ?? null);
    }
  }, [data]);

  const user = data?.user ?? null;

  return {
    user,
    isLoading,
    isAuthenticated: user !== null,
  };
}
