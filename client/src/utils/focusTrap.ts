/**
 * Keeps Tab inside a modal dialog, per the WAI-ARIA Authoring Practices modal pattern:
 * Tab from the last control wraps to the first, Shift+Tab from the first to the last.
 */

/** Elements that can take focus at all; tabbableElements then keeps the real Tab stops. */
const FOCUS_CANDIDATES =
  'a[href], area[href], button, input, select, textarea, iframe, summary, ' +
  'audio[controls], video[controls], [contenteditable]:not([contenteditable="false"]), [tabindex]';

/**
 * An element's place in Tab order. Without a tabindex attribute, an editable region, a
 * summary and a media player are in it even where the DOM reports -1, as tabbable reads them.
 */
function tabOrderOf(element: HTMLElement): number {
  if (element.hasAttribute('tabindex')) return element.tabIndex;
  const nativelyTabbable =
    element.isContentEditable ||
    element.getAttribute('contenteditable') === 'true' ||
    element.getAttribute('contenteditable') === '' ||
    ['SUMMARY', 'AUDIO', 'VIDEO'].includes(element.tagName);
  return nativelyTabbable ? 0 : element.tabIndex;
}

/** A candidate Tab passes over: disabled, removed from sequential order, or not rendered. */
function skippedByTab(element: HTMLElement): boolean {
  if (tabOrderOf(element) < 0) return true;
  if (element.matches(':disabled')) return true;
  if (element instanceof HTMLInputElement && element.type === 'hidden') return true;
  if (element.closest('[hidden], [inert]')) return true;
  // A closed <details> renders only its own <summary>.
  const closedDetails = element.closest('details:not([open])');
  if (!closedDetails) return false;
  const summary = closedDetails.querySelector(':scope > summary');
  return !(summary && summary.contains(element));
}

/**
 * Whether a radio is its group's Tab stop: the checked one, or the first when none is
 * checked. The browser moves within the group by arrow keys, not Tab.
 */
function isRadioTabStop(radio: HTMLInputElement, container: HTMLElement): boolean {
  if (!radio.name) return true;
  const group = [
    ...container.querySelectorAll<HTMLInputElement>(
      `input[type="radio"][name="${CSS.escape(radio.name)}"]`,
    ),
  ].filter((member) => member.form === radio.form);
  const checked = group.find((member) => member.checked);
  return checked ? checked === radio : group[0] === radio;
}

/**
 * The controls Tab stops on inside `container`, in the order Tab visits them: positive
 * tabindex ascending, then document order. The rules follow the `tabbable` library, which
 * focus-trap and most dialog libraries build on.
 */
export function tabbableElements(container: HTMLElement): HTMLElement[] {
  const stops = [...container.querySelectorAll<HTMLElement>(FOCUS_CANDIDATES)].filter(
    (element) =>
      !skippedByTab(element) &&
      !(
        element instanceof HTMLInputElement &&
        element.type === 'radio' &&
        !isRadioTabStop(element, container)
      ),
  );
  const ordered = stops.filter((element) => tabOrderOf(element) > 0);
  ordered.sort((a, b) => tabOrderOf(a) - tabOrderOf(b));
  return [...ordered, ...stops.filter((element) => tabOrderOf(element) === 0)];
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
