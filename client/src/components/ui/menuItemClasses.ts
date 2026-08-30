/**
 * Shared menu-item styling for the WAI-ARIA menu buttons, so UserMenu and ExportMenu
 * cannot drift visually.
 *
 * Vertical padding is deliberately absent: callers set their own, and emitting a
 * `py-*` here that a caller then overrides would leave two padding utilities in one
 * class string, resolved by stylesheet order rather than by the order written.
 */
export const MENU_ITEM_CLASSES =
  'block w-full px-4 text-start text-sm text-gray-700 hover:bg-gray-50 ' +
  'focus:bg-gray-50 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50';
