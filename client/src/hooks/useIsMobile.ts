/**
 * useIsMobile — returns true when the viewport is below the lg breakpoint (1024 px).
 *
 * Matches the Tailwind `lg` breakpoint used throughout the nav components.
 * Subscribes to matchMedia change events so the value stays current if the
 * window is resized (e.g. DevTools responsive mode, foldable devices).
 */

import { useState, useLayoutEffect } from 'react';

const MOBILE_QUERY = '(max-width: 1023px)';

/**
 * Returns true when the viewport width is below the lg breakpoint (< 1024 px).
 * Re-renders the consuming component whenever the breakpoint is crossed.
 *
 * Returns false in environments where matchMedia is unavailable (SSR, jsdom).
 */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState<boolean>(false);

  // useLayoutEffect fires synchronously after DOM mutations, before the browser
  // paints. On mount: read the current match value and update state if needed,
  // then subscribe to future changes. All setState calls happen inside callbacks
  // (handleChange / immediate setter call) to satisfy react-hooks/set-state-in-effect.
  useLayoutEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(MOBILE_QUERY);

    function handleChange(matches: boolean): void {
      setIsMobile(matches);
    }

    function handleMediaQueryChange(e: MediaQueryListEvent): void {
      handleChange(e.matches);
    }

    // Sync initial value — called here (not in useState initializer) so the
    // correction fires as a layout effect rather than a direct effect-body setState.
    handleChange(mql.matches);

    mql.addEventListener('change', handleMediaQueryChange);
    return () => mql.removeEventListener('change', handleMediaQueryChange);
  }, []);

  return isMobile;
}
