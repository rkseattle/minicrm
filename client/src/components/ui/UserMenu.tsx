/**
 * UserMenu — the header's single per-user control: the signed-in user's name as a
 * trigger opening Profile Settings, the language preference, and Log out.
 *
 * Follows the WAI-ARIA menu button pattern as ExportMenu does: the trigger carries
 * aria-haspopup/aria-expanded, the item list is role="menu" with role="menuitem"
 * children, focus moves onto the first item on open with roving arrow/Home/End
 * navigation, and Escape or an outside click closes and restores focus.
 *
 * The language select is a sibling of the menu list, not a child: combobox is not a
 * valid owned element of role="menu". The wrapper is a named role="group" so that
 * control is announced with the menu rather than orphaned; the menu carries the name
 * too, since a group does not lend its name to a nested menu.
 */

import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { logout } from '@/api/auth.js';
import { useLanguagePreference } from '@/hooks/useLanguagePreference.js';
import { useMenuButton } from '@/hooks/useMenuButton.js';
import { MENU_ITEM_CLASSES } from '@/components/ui/menuItemClasses.js';
import { Button } from '@/components/ui/Button.js';
import { Select } from '@/components/ui/Select.js';
import { SUPPORTED_LOCALES, type SupportedLocale } from '@shared/schemas/settingsSchema.js';
import { LOCALE_NATIVE_NAME } from '@/components/navLinks.js';

export interface UserMenuProps {
  /** Signed-in user's display name — the trigger's visible label and accessible name. */
  userName: string;
}

/** Pairs the language select with its visible label. */
const LANGUAGE_SELECT_ID = 'nav-user-menu-language';

/**
 * Profile Settings, Log out, and the language select. The select is not a menu item —
 * combobox is not a valid child of role="menu" — but it is a roving target, or arrow
 * keys would cycle the two items forever and Tab would close the popup before focus
 * could land on it, leaving it reachable by mouse alone.
 */
const ROVING_TARGET_COUNT = 3;

/** Chevron indicating the trigger opens a menu. */
const CHEVRON_PATH = 'M19 9l-7 7-7-7';

export function UserMenu({ userName }: UserMenuProps) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const {
    isOpen,
    containerRef,
    triggerRef,
    registerItem,
    toggle,
    close,
    handleMenuKeyDown,
    handleEscape,
  } = useMenuButton<HTMLElement>({ itemCount: ROVING_TARGET_COUNT });

  const { save: handleLanguageChange } = useLanguagePreference({ optimistic: true });

  const logoutMutation = useMutation({
    mutationFn: logout,
    onSuccess: () => {
      // Clear, not invalidate: invalidation leaves the value readable on the next
      // mount while it refetches, so the next user on this tab sees the previous
      // user's data. No ['users','me',...] key carries a user id.
      queryClient.clear();
      // Document load, not navigate(): providers above the router survive a route
      // change, so their observers would refetch after the clear and 401 into the
      // session-expired redirect. Matches the 401 interceptor.
      window.location.href = '/login';
    },
    onError: () => {
      // The server may already have dropped the session even though the response
      // failed, so leaving the user signed in with a live cache is the worse of
      // the two guesses. Clear and leave regardless.
      queryClient.clear();
      window.location.href = '/login';
    },
  });

  return (
    <div ref={containerRef} className="relative inline-block">
      <Button
        ref={triggerRef}
        variant="ghost"
        size="sm"
        data-testid="nav-user-menu-button"
        aria-label={t('nav.userMenuTrigger', { name: userName })}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={toggle}
        className="max-w-[7rem] sm:max-w-[12rem]"
      >
        <span className="truncate">{userName}</span>
        <svg
          className="h-4 w-4 flex-shrink-0"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d={CHEVRON_PATH} />
        </svg>
      </Button>

      {isOpen && (
        <div
          role="group"
          aria-label={t('nav.userMenuLabel')}
          className="absolute end-0 z-40 mt-1 w-56 rounded-md border border-gray-200 bg-white shadow-md"
        >
          <div
            role="menu"
            aria-label={t('nav.userMenuLabel')}
            tabIndex={-1}
            onKeyDown={handleMenuKeyDown}
          >
            <button
              ref={registerItem(0)}
              type="button"
              role="menuitem"
              data-testid="nav-user-menu-profile"
              onClick={() => {
                close(true);
                navigate('/profile');
              }}
              className={`${MENU_ITEM_CLASSES} py-3 sm:py-2`}
            >
              {t('nav.profileSettings')}
            </button>
            <button
              ref={registerItem(1)}
              type="button"
              role="menuitem"
              data-testid="nav-logout"
              disabled={logoutMutation.isPending}
              onClick={() => {
                logoutMutation.mutate();
                close(true);
              }}
              className={`${MENU_ITEM_CLASSES} py-3 sm:py-2`}
            >
              {t('nav.logout')}
            </button>
          </div>

          <div className="border-t border-gray-100 px-4 py-3">
            <Select
              ref={registerItem(2)}
              id={LANGUAGE_SELECT_ID}
              label={t('nav.languageSelector')}
              data-testid="nav-language-select"
              value={i18n.language}
              onChange={(e) => handleLanguageChange(e.target.value as SupportedLocale)}
              onKeyDown={(e) => {
                // Escape and Tab behave as they do in the menu list. Arrow keys are
                // left to the select, which uses them to change the selected option.
                if (e.key === 'Escape') handleEscape(e);
                if (e.key === 'Tab') close(false);
              }}
            >
              {SUPPORTED_LOCALES.map((locale) => (
                <option key={locale} value={locale}>
                  {LOCALE_NATIVE_NAME[locale]}
                </option>
              ))}
            </Select>
          </div>
        </div>
      )}
    </div>
  );
}
