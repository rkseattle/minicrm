/**
 * Keeps Tab inside a modal dialog while it is open, per the WAI-ARIA Authoring Practices
 * modal pattern, using focus-trap (and its tabbable rules) rather than a local copy.
 */

import { useEffect } from 'react';
import { createFocusTrap, type FocusTrapTabbableOptions } from 'focus-trap';

/**
 * jsdom lays nothing out, so tabbable's visibility check would find no Tab stops in a
 * test; real browsers keep the full check.
 */
const TABBABLE_OPTIONS: FocusTrapTabbableOptions = {
  displayCheck: import.meta.env.MODE === 'test' ? 'none' : 'full',
};

/**
 * Traps Tab and Shift+Tab inside the dialog container while active.
 *
 * Initial focus stays with each dialog (its own autofocus), and so does Escape. On close,
 * focus returns to whatever held it when the dialog opened, as the APG modal pattern
 * requires. Traps stack: a dialog opened over another pauses the one below.
 *
 * @param containerRef - Ref to the element with `aria-modal="true"`.
 * @param active - Pass the dialog's open condition when the component outlives the dialog.
 */
export function useFocusTrap(
  containerRef: React.RefObject<HTMLElement | null>,
  active = true,
): void {
  useEffect(() => {
    const container = containerRef.current;
    if (!active || !container) return;
    const trap = createFocusTrap(container, {
      initialFocus: false,
      fallbackFocus: container,
      escapeDeactivates: false,
      allowOutsideClick: true,
      returnFocusOnDeactivate: true,
      tabbableOptions: TABBABLE_OPTIONS,
    });
    trap.activate();
    return () => {
      trap.deactivate();
    };
  }, [containerRef, active]);
}
