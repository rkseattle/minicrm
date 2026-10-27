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
 * On open, focus stays where a dialog's own autofocus put it, or else moves to its first
 * control; on close it returns to whatever held it before, as the APG modal pattern
 * requires. Escape stays with each dialog. Traps stack: one opened over another pauses it.
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
