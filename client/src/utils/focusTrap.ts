/**
 * Keeps Tab inside a modal dialog, per the WAI-ARIA Authoring Practices modal pattern:
 * Tab from the last control wraps to the first, Shift+Tab from the first to the last.
 */

const TABBABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), ' +
  'textarea:not([disabled]), iframe, [tabindex]:not([tabindex="-1"])';

/** Wraps a Tab key press at either end of `container`; any other key passes through. */
export function keepTabInside(event: React.KeyboardEvent, container: HTMLElement | null): void {
  if (event.key !== 'Tab' || !container) return;
  const tabbable = [...container.querySelectorAll<HTMLElement>(TABBABLE)];
  const first = tabbable[0];
  const last = tabbable[tabbable.length - 1];
  if (!first || !last) {
    event.preventDefault();
    return;
  }
  const active = document.activeElement;
  const outside = !container.contains(active);
  if (event.shiftKey && (active === first || outside)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (active === last || outside)) {
    event.preventDefault();
    first.focus();
  }
}
