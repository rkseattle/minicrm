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
import { AUTH_QUERY_KEY } from '@/hooks/useAuth.js';
import { logout } from '@/api/auth.js';
import { useLanguagePreference } from '@/hooks/useLanguagePreference.js';
import { MENU_ITEM_CLASSES, useMenuButton } from '@/hooks/useMenuButton.js';
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

/** Profile Settings and Log out — the language select is not a menu item. */
const MENU_ITEM_COUNT = 2;

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
  } = useMenuButton<HTMLButtonElement>({ itemCount: MENU_ITEM_COUNT });

  const { save: handleLanguageChange } = useLanguagePreference({ optimistic: true });

  const logoutMutation = useMutation({
    mutationFn: logout,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: AUTH_QUERY_KEY });
      navigate('/login', { replace: true });
    },
  });

  return (
    <div ref={containerRef} className="relative inline-block">
      <Button
        ref={triggerRef}
        variant="ghost"
        size="sm"
        data-testid="nav-user-menu-button"
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
          className="absolute end-0 z-20 mt-1 w-56 rounded-md border border-gray-200 bg-white shadow-md"
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
            <label
              htmlFor={LANGUAGE_SELECT_ID}
              className="mb-1 block text-xs font-medium text-gray-500"
            >
              {t('nav.languageSelector')}
            </label>
            <Select
              id={LANGUAGE_SELECT_ID}
              data-testid="nav-language-select"
              value={i18n.language}
              onChange={(e) => handleLanguageChange(e.target.value as SupportedLocale)}
              onKeyDown={(e) => {
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
