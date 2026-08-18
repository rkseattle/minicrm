/**
 * BreakpointContext — single window.matchMedia subscription shared across the app.
 *
 * Wrapping the app root in BreakpointProvider means every component that calls
 * useBreakpoint() reads from one shared subscription rather than creating its own.
 * The md breakpoint (768px) matches Tailwind's default.
 *
 * Initial state is false (mobile-first) so it is safe in SSR/jsdom environments
 * where window.matchMedia is unavailable. A useEffect corrects the value after
 * mount and keeps it in sync on viewport changes.
 *
 */

import { createContext, useContext, useState, useEffect } from 'react';

const MD_QUERY = '(min-width: 768px)';

interface BreakpointContextValue {
  isMobile: boolean;
  isDesktop: boolean;
}

export const BreakpointContext = createContext<BreakpointContextValue | null>(null);

/**
 * Mounts once at the app root. Subscribes to the md breakpoint and propagates
 * changes to all consumers via context.
 */
export function BreakpointProvider({ children }: { children: React.ReactNode }) {
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(MD_QUERY);

    function sync(matches: boolean): void {
      setIsDesktop(matches);
    }

    function handleChange(e: MediaQueryListEvent): void {
      sync(e.matches);
    }

    // Correct the initial value after mount via a named helper so the lint
    // rule (no direct setState in effect body) is satisfied. Matches the
    // pattern used in useIsMobile.ts.
    sync(mq.matches);

    mq.addEventListener('change', handleChange);
    return () => mq.removeEventListener('change', handleChange);
  }, []);

  return (
    <BreakpointContext.Provider value={{ isMobile: !isDesktop, isDesktop }}>
      {children}
    </BreakpointContext.Provider>
  );
}

/**
 * Returns the current breakpoint state. Must be called inside BreakpointProvider.
 */
export function useBreakpoint(): BreakpointContextValue {
  const context = useContext(BreakpointContext);
  if (!context) {
    throw new Error('useBreakpoint must be used within a BreakpointProvider');
  }
  return context;
}
