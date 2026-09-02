/**
 * useAuth hook.
 * Wraps the /api/v1/auth/me query with React Query.
 * Components use this to access the current user and authentication state.
 */

import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import type { AxiosError } from 'axios';
import { getMe } from '@/api/auth.js';
import { applyResolvedLanguage } from '@/i18n.js';
import type { UserResponse } from '@shared/schemas/userSchema.js';

/**
 * Module-level flag — survives component remounts across navigations.
 * Ensures applyResolvedLanguage runs at most once per page load/session,
 * even though useAuth is called by multiple components (NavBar, ProtectedRoute, etc.).
 *
 * Safe across an account switch only because no client-side transition ever ENDS
 * a session: logout and the 401 interceptor both leave by full document load,
 * which resets this module. The in-tree session entries (login, MFA verify,
 * password reset) all arrive on a fresh /login load, so the flag is already
 * unset. A client-side logout would strand it set, and the next user would keep
 * the previous user's language.
 */
let languageApplied = false;

/** React Query cache key for the current user */
export const AUTH_QUERY_KEY = ['auth', 'me'] as const;

interface UseAuthResult {
  user: UserResponse | null;
  /** The user's effective capabilities, resolved server-side across all their roles. */
  capabilities: string[];
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

  // Apply the resolved language exactly once per session — when auth data first loads.
  // The module-level flag (not a ref) survives component remounts on navigation,
  // preventing subsequent refetches from resetting a language the user already changed.
  useEffect(() => {
    if (data !== undefined && !languageApplied) {
      languageApplied = true;
      void applyResolvedLanguage(data?.user?.preferred_language ?? null);
    }
  }, [data]);

  const user = data?.user ?? null;

  return {
    user,
    capabilities: data?.capabilities ?? [],
    isLoading,
    isAuthenticated: user !== null,
  };
}
