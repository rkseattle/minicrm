/**
 * Keeps Tab inside a modal dialog while it is open — the WAI-ARIA Authoring Practices
 * modal pattern, applied the same way to every dialog.
 */

import { useEffect } from 'react';
import { keepTabInside } from '@/utils/focusTrap.js';

/**
 * Listens for Tab on the dialog container and wraps it at either end.
 *
 * A native listener rather than an `onKeyDown` prop, so a dialog needs only a ref.
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
    function handleKeyDown(event: KeyboardEvent): void {
      keepTabInside(event, container);
    }
    container.addEventListener('keydown', handleKeyDown);
    return () => {
      container.removeEventListener('keydown', handleKeyDown);
    };
  }, [containerRef, active]);
}
