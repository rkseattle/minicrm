/**
 * useMenuButton — the WAI-ARIA menu button mechanism shared by the header's user
 * menu and the list pages' export menu.
 *
 * Owns open/close state, focus-on-open, focus restore to the trigger, outside-click
 * dismissal, and roving ArrowUp/ArrowDown/Home/End with Tab-to-close. Callers register
 * their items and render their own markup, so the two menus can differ in content
 * without the keyboard contract drifting between them.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useOnClickOutside } from '@/hooks/useOnClickOutside.js';

/** Shared menu-item styling, so the two menus cannot drift visually. */
export const MENU_ITEM_CLASSES =
  'block w-full px-4 py-2 text-start text-sm text-gray-700 hover:bg-gray-50 ' +
  'focus:bg-gray-50 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50';

export interface UseMenuButtonOptions {
  /**
   * How many items the menu currently renders. Required because the ref array is
   * grown by index and never shrinks, so its length is a high-water mark: a menu
   * that once rendered a role-gated item would keep wrapping past the end of the
   * list after that item is hidden.
   */
  itemCount: number;
  /** Index focused on open, so a caller can skip a leading disabled item. */
  initialFocusIndex?: number;
}

export interface UseMenuButtonResult<TItem extends HTMLElement> {
  isOpen: boolean;
  /** Wrap the whole control: outside clicks here are treated as inside. */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** Attach to the trigger so focus can be restored to it. */
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  /**
   * Registers an item at its render position; the roving keys walk them in order.
   * Pass the result straight to `ref` on each menu item.
   */
  registerItem: (index: number) => (element: TItem | null) => void;
  toggle: () => void;
  close: (restoreFocus: boolean) => void;
  /** Bind to the role="menu" element, not to a wrapper holding other controls. */
  handleMenuKeyDown: (event: React.KeyboardEvent) => void;
  /**
   * Escape handler for elements outside the menu list that still sit in the popup.
   * Stops propagation so an ancestor's document-level Escape (NavHamburger's drawer)
   * does not also fire and steal the focus this restores. ExportMenu inherits that
   * on extraction; none of its call sites nests inside a component with its own
   * Escape handler, so nothing there changes behavior.
   */
  handleEscape: (event: React.KeyboardEvent) => void;
}

export function useMenuButton<TItem extends HTMLElement>({
  itemCount,
  initialFocusIndex = 0,
}: UseMenuButtonOptions): UseMenuButtonResult<TItem> {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Array<TItem | null>>([]);

  const close = useCallback((restoreFocus: boolean) => {
    setIsOpen(false);
    if (restoreFocus) {
      triggerRef.current?.focus();
    }
  }, []);

  const toggle = useCallback(() => {
    setIsOpen((previous) => !previous);
  }, []);

  useOnClickOutside(containerRef, () => close(false));

  useEffect(() => {
    if (!isOpen) return;
    itemRefs.current[initialFocusIndex]?.focus();
    // Only on open/close — item identity changing must not steal focus back.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const focusItemAt = useCallback(
    (index: number): void => {
      if (itemCount === 0) return;
      itemRefs.current[(index + itemCount) % itemCount]?.focus();
    },
    [itemCount],
  );

  const handleEscape = useCallback(
    (event: React.KeyboardEvent): void => {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    },
    [close],
  );

  const handleMenuKeyDown = useCallback(
    (event: React.KeyboardEvent): void => {
      const currentIndex = itemRefs.current.findIndex((el) => el === document.activeElement);

      switch (event.key) {
        case 'Escape':
          handleEscape(event);
          break;
        case 'ArrowDown':
          event.preventDefault();
          focusItemAt(currentIndex < 0 ? 0 : currentIndex + 1);
          break;
        case 'ArrowUp':
          event.preventDefault();
          focusItemAt(currentIndex < 0 ? itemCount - 1 : currentIndex - 1);
          break;
        case 'Home':
          event.preventDefault();
          focusItemAt(0);
          break;
        case 'End':
          event.preventDefault();
          focusItemAt(itemCount - 1);
          break;
        case 'Tab':
          // Standard menu-button behavior: Tab leaves without trapping focus.
          close(false);
          break;
        default:
          break;
      }
    },
    [close, focusItemAt, handleEscape, itemCount],
  );

  const registerItem = useCallback(
    (index: number) => (element: TItem | null) => {
      itemRefs.current[index] = element;
    },
    [],
  );

  return {
    isOpen,
    containerRef,
    triggerRef,
    registerItem,
    toggle,
    close,
    handleMenuKeyDown,
    handleEscape,
  };
}
