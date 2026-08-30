/**
 * ExportMenu component.
 * Renders a single "Export" trigger button that reveals a dropdown of export
 * actions (CSV, PDF, admin-only "export all", etc.), consolidating what was
 * previously a row of standalone buttons on each list/report page.
 *
 * Follows the WAI-ARIA menu button pattern: trigger has aria-haspopup/aria-expanded,
 * the panel has role="menu" with role="menuitem" children, and focus moves onto
 * the first item on open with roving arrow-key/Home/End navigation between items.
 * Escape and an outside click close the menu and return focus to the trigger.
 */

import { useMenuButton } from '@/hooks/useMenuButton.js';
import { MENU_ITEM_CLASSES } from '@/components/ui/menuItemClasses.js';

interface ExportMenuActionItemConfig {
  /** Unique key for React list rendering — not rendered. */
  key: string;
  /** data-testid for this menu item, preserving the page's existing convention. */
  testId: string;
  /** Visible label. */
  label: string;
  /** Invoked when the item is activated (click or Enter/Space while focused). */
  onClick: () => void;
  href?: undefined;
  /** Disables this item (e.g. while its export is in flight). */
  disabled?: boolean;
  /** Omits this item entirely (e.g. role-gated "export all"). Defaults to visible. */
  hidden?: boolean;
  /** Optional additional classes, e.g. for destructive-style items. */
  className?: string;
}

interface ExportMenuLinkItemConfig {
  /** Unique key for React list rendering — not rendered. */
  key: string;
  /** data-testid for this menu item, preserving the page's existing convention. */
  testId: string;
  /** Visible label. */
  label: string;
  onClick?: undefined;
  /**
   * Renders this item as a plain `<a href download>` instead of a button —
   * for pages whose export is a direct GET URL download rather than a
   * blob-fetch click handler (e.g. Custom Report Builder). Preserves native
   * browser download semantics (right-click "save as", opening in a new tab).
   */
  href: string;
  /** Disables this item (e.g. while its export is in flight). */
  disabled?: boolean;
  /** Omits this item entirely (e.g. role-gated "export all"). Defaults to visible. */
  hidden?: boolean;
  /** Optional additional classes, e.g. for destructive-style items. */
  className?: string;
}

export type ExportMenuItemConfig = ExportMenuActionItemConfig | ExportMenuLinkItemConfig;

export interface ExportMenuProps {
  /** Label shown on the trigger button, e.g. t('common.export'). */
  label: string;
  /** data-testid for the trigger button, conventionally `${page}-export-menu-button`. */
  testId: string;
  /** Menu items, in display order. */
  items: ExportMenuItemConfig[];
  /** Accessible label for the menu panel; falls back to `label` if omitted. */
  menuLabel?: string;
}

/**
 * Single "Export" dropdown trigger that reveals a list of export actions.
 *
 * @param props - See ExportMenuProps.
 */
export function ExportMenu({ label, testId, items, menuLabel }: ExportMenuProps) {
  const visibleItems = items.filter((item) => !item.hidden);
  const firstEnabledIndex = visibleItems.findIndex((item) => !item.disabled);

  const { isOpen, containerRef, triggerRef, registerItem, toggle, close, handleMenuKeyDown } =
    useMenuButton<HTMLButtonElement | HTMLAnchorElement>({
      itemCount: visibleItems.length,
      initialFocusIndex: firstEnabledIndex >= 0 ? firstEnabledIndex : 0,
    });

  return (
    <div ref={containerRef} className="relative inline-block">
      <button
        ref={triggerRef}
        type="button"
        data-testid={testId}
        className="inline-flex items-center justify-center gap-1.5 rounded-md border font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 bg-white text-gray-700 hover:bg-gray-50 focus:ring-primary-500 border-gray-300 px-3 py-1.5 text-xs min-h-[44px] sm:min-h-0"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={toggle}
      >
        {label}
      </button>

      {isOpen && (
        <div
          className="absolute z-50 mt-1 w-56 rounded-md border border-gray-200 bg-white py-1 shadow-md end-0"
          role="menu"
          aria-label={menuLabel ?? label}
          tabIndex={-1}
          onKeyDown={handleMenuKeyDown}
        >
          {visibleItems.map((item, index) =>
            item.href !== undefined && item.disabled ? (
              // Disabled link items render as a disabled <button>, not an <a> with a
              // suppressed href — an anchor remains a real, keyboard-activatable link
              // regardless of aria-disabled/pointer-events, so a disabled export link
              // must not be an anchor at all.
              <button
                key={item.key}
                ref={registerItem(index)}
                type="button"
                role="menuitem"
                data-testid={item.testId}
                disabled
                className={[MENU_ITEM_CLASSES, 'py-2', item.className].filter(Boolean).join(' ')}
              >
                {item.label}
              </button>
            ) : item.href !== undefined ? (
              <a
                key={item.key}
                ref={registerItem(index)}
                href={item.href}
                download
                role="menuitem"
                data-testid={item.testId}
                className={[MENU_ITEM_CLASSES, 'py-2', item.className].filter(Boolean).join(' ')}
                onClick={() => close(true)}
              >
                {item.label}
              </a>
            ) : (
              <button
                key={item.key}
                ref={registerItem(index)}
                type="button"
                role="menuitem"
                data-testid={item.testId}
                disabled={item.disabled}
                className={[MENU_ITEM_CLASSES, 'py-2', item.className].filter(Boolean).join(' ')}
                onClick={() => {
                  close(true);
                  item.onClick();
                }}
              >
                {item.label}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}
