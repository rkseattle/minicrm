/**
 * useVisualViewportHeight — tracks window.visualViewport's height in pixels.
 *
 * `dvh` alone does not shrink when a mobile keyboard overlays the layout
 * viewport instead of resizing it (notably Android Chrome and some iOS
 * Safari versions/keyboard modes) — the CSS viewport units keep reporting
 * the full, keyboard-obscured height. The VisualViewport API's `resize` and
 * `scroll` events fire in that overlay case, so subscribing to it gives an
 * accurate "actually visible" height to constrain a fixed-height shell with.
 *
 * Returns undefined in environments without VisualViewport support (SSR,
 * jsdom, older browsers) so callers can fall back to a CSS-only height.
 */

import { useState, useLayoutEffect } from 'react';

export function useVisualViewportHeight(): number | undefined {
  const [height, setHeight] = useState<number | undefined>(undefined);

  useLayoutEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;

    function handleResize(): void {
      // Re-read here (not captured) since TS can't narrow the outer-scope
      // `viewport` as non-null inside this closure.
      setHeight(window.visualViewport?.height);
    }

    handleResize();

    viewport.addEventListener('resize', handleResize);
    viewport.addEventListener('scroll', handleResize);
    return () => {
      viewport.removeEventListener('resize', handleResize);
      viewport.removeEventListener('scroll', handleResize);
    };
  }, []);

  return height;
}
