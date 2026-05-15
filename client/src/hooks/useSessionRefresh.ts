/**
 * useSessionRefresh — sliding idle timeout for authenticated sessions. (MINCRM-365)
 *
 * Listens for user activity (mouse, keyboard, click, scroll, touch) and calls
 * POST /api/auth/refresh when the user is active and the session is within
 * REFRESH_BEFORE_EXPIRY_MS of its idle expiry.
 *
 * The server's JWT idle expiry is 30 minutes. The client tracks when the last
 * refresh happened in a module-level variable and only fires a new refresh once
 * per DEBOUNCE_MS window to avoid hammering the endpoint.
 *
 * A 401 from the refresh endpoint means either the idle window expired (unlikely
 * — the call only goes out when the user is active) or the 8-hour absolute cap
 * was reached. Either way, the global Axios interceptor handles the redirect to
 * /login?reason=session_expired.
 *
 * This hook has no side effects when the user is unauthenticated — it only
 * attaches listeners while isAuthenticated is true.
 */

import { useEffect, useRef } from 'react';
import { refreshSession } from '@/api/auth.js';

/** JWT idle expiry configured on the server (30 minutes). */
const IDLE_EXPIRY_MS = 30 * 60 * 1000;

/**
 * How far before expiry to trigger a refresh.
 * Fires a refresh when the last known refresh was more than (IDLE_EXPIRY_MS - REFRESH_BEFORE_EXPIRY_MS) ago.
 */
const REFRESH_BEFORE_EXPIRY_MS = 5 * 60 * 1000;

/** Minimum gap between refresh calls (debounce activity events). */
const DEBOUNCE_MS = 30 * 1000;

/** Activity events that indicate the user is not idle. */
const ACTIVITY_EVENTS = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart'] as const;

/**
 * Attaches activity listeners that refresh the session JWT before the idle
 * timeout expires. Call this hook from a top-level authenticated component
 * (e.g., ProtectedRoute). Safe to call when unauthenticated — no listeners
 * are attached while isAuthenticated is false.
 *
 * @param isAuthenticated - Whether the user currently has a valid session.
 */
export function useSessionRefresh(isAuthenticated: boolean): void {
  // Tracks when we last successfully issued a refresh. Using a ref (not state)
  // because changing this value must not cause a re-render.
  // Initialized to 0 (not Date.now()) to comply with the react-hooks/purity rule;
  // the real timestamp is set inside useEffect on mount.
  const lastRefreshAt = useRef<number>(0);

  useEffect(() => {
    if (!isAuthenticated) return;

    // Treat the hook mounting as a fresh start — the session is currently valid.
    lastRefreshAt.current = Date.now();

    let refreshPending = false;

    const handleActivity = (): void => {
      if (refreshPending) return;

      const now = Date.now();
      const msSinceLastRefresh = now - lastRefreshAt.current;
      const refreshThresholdMs = IDLE_EXPIRY_MS - REFRESH_BEFORE_EXPIRY_MS;

      if (msSinceLastRefresh < DEBOUNCE_MS) return;
      if (msSinceLastRefresh < refreshThresholdMs) return;

      refreshPending = true;
      refreshSession()
        .then(() => {
          lastRefreshAt.current = Date.now();
        })
        .catch(() => {
          // 401 from refresh is handled by the global Axios interceptor (MINCRM-365).
          // Any other error is transient — the next activity event will retry.
        })
        .finally(() => {
          refreshPending = false;
        });
    };

    for (const event of ACTIVITY_EVENTS) {
      window.addEventListener(event, handleActivity, { passive: true });
    }

    return () => {
      for (const event of ACTIVITY_EVENTS) {
        window.removeEventListener(event, handleActivity);
      }
    };
  }, [isAuthenticated]);
}
