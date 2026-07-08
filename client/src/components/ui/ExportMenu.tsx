/**
 * ExportMenu component.
 * Renders a single "Export" trigger button that reveals a dropdown of export
 * actions (CSV, PDF, admin-only "export all", etc.), consolidating what was
 * previously a row of standalone buttons on each list/report page. (MINCRM-652)
 *
 * Follows the WAI-ARIA menu button pattern: trigger has aria-haspopup/aria-expanded,
 * the panel has role="menu" with role="menuitem" children, and focus moves onto
 * the first item on open with roving arrow-key/Home/End navigation between items.
 * Escape and an outside click close the menu and return focus to the trigger.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useOnClickOutside } from '@/hooks/useOnClickOutside.js';

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

const ITEM_BASE_CLASSES =
  'block w-full px-4 py-2 text-start text-sm text-gray-700 hover:bg-gray-50 ' +
  'focus:bg-gray-50 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50';

/**
 * Single "Export" dropdown trigger that reveals a list of export actions.
 *
 * @param props - See ExportMenuProps.
 */
export function ExportMenu({ label, testId, items, menuLabel }: ExportMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | HTMLAnchorElement | null>>([]);

  const visibleItems = items.filter((item) => !item.hidden);

  const close = useCallback((restoreFocus: boolean) => {
    setIsOpen(false);
    if (restoreFocus) {
      triggerRef.current?.focus();
    }
  }, []);

  useOnClickOutside(containerRef, () => close(false));

  // Move focus onto the first enabled item as soon as the menu opens.
  useEffect(() => {
    if (!isOpen) return;
    const firstEnabledIndex = visibleItems.findIndex((item) => !item.disabled);
    if (firstEnabledIndex >= 0) {
      itemRefs.current[firstEnabledIndex]?.focus();
    }
    // Only re-run when the menu opens/closes — item identity changes shouldn't steal focus back.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  function focusItemAt(index: number): void {
    const clamped = (index + visibleItems.length) % visibleItems.length;
    itemRefs.current[clamped]?.focus();
  }

  function handleMenuKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    const currentIndex = itemRefs.current.findIndex((el) => el === document.activeElement);

    switch (event.key) {
      case 'Escape':
        event.preventDefault();
        close(true);
        break;
      case 'ArrowDown':
        event.preventDefault();
        focusItemAt(currentIndex < 0 ? 0 : currentIndex + 1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        focusItemAt(currentIndex < 0 ? visibleItems.length - 1 : currentIndex - 1);
        break;
      case 'Home':
        event.preventDefault();
        focusItemAt(0);
        break;
      case 'End':
        event.preventDefault();
        focusItemAt(visibleItems.length - 1);
        break;
      case 'Tab':
        // Standard menu-button behavior: Tab closes the menu without trapping focus.
        close(false);
        break;
      default:
        break;
    }
  }

  return (
    <div ref={containerRef} className="relative inline-block">
      <button
        ref={triggerRef}
        type="button"
        data-testid={testId}
        className="inline-flex items-center justify-center gap-1.5 rounded-md border font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 bg-white text-gray-700 hover:bg-gray-50 focus:ring-primary-500 border-gray-300 px-3 py-1.5 text-xs min-h-[44px] sm:min-h-0"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((prev) => !prev)}
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
            item.href !== undefined ? (
              <a
                key={item.key}
                ref={(el) => {
                  itemRefs.current[index] = el;
                }}
                href={item.href}
                download
                role="menuitem"
                aria-disabled={item.disabled}
                data-testid={item.testId}
                className={[
                  ITEM_BASE_CLASSES,
                  item.disabled ? 'pointer-events-none' : '',
                  item.className,
                ]
                  .filter(Boolean)
                  .join(' ')}
                onClick={(event) => {
                  if (item.disabled) {
                    event.preventDefault();
                    return;
                  }
                  close(true);
                }}
              >
                {item.label}
              </a>
            ) : (
              <button
                key={item.key}
                ref={(el) => {
                  itemRefs.current[index] = el;
                }}
                type="button"
                role="menuitem"
                data-testid={item.testId}
                disabled={item.disabled}
                className={[ITEM_BASE_CLASSES, item.className].filter(Boolean).join(' ')}
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
