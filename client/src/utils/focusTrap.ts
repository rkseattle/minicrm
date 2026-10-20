/**
 * Keeps Tab inside a modal dialog, per the WAI-ARIA Authoring Practices modal pattern:
 * Tab from the last control wraps to the first, Shift+Tab from the first to the last.
 */

const TABBABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), ' +
  'select:not([disabled]), textarea:not([disabled]), iframe, [tabindex]:not([tabindex="-1"])';

/** The controls Tab stops on inside `container`, in document order. */
export function tabbableElements(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(TABBABLE)];
}

/** The parts of a key press this reads, so a native and a React keyboard event both fit. */
export type TabKeyEvent = Pick<KeyboardEvent, 'key' | 'shiftKey' | 'preventDefault'>;

/** Wraps a Tab key press at either end of `container`; any other key passes through. */
export function keepTabInside(event: TabKeyEvent, container: HTMLElement | null): void {
  if (event.key !== 'Tab' || !container) return;
  const tabbable = tabbableElements(container);
  const first = tabbable[0];
  const last = tabbable[tabbable.length - 1];
  if (!first || !last) {
    event.preventDefault();
    return;
  }
  const active = document.activeElement;
  // A dialog focused on open is no Tab stop, so treat it as outside.
  const outside = active === container || !container.contains(active);
  if (event.shiftKey && (active === first || outside)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (active === last || outside)) {
    event.preventDefault();
    first.focus();
  }
}
