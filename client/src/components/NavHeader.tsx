/**
 * NavHeader — shared top-bar header used by all three nav layouts.
 *
 * Renders: brand, search, user name, language selector, logout, and an
 * optional hamburger toggle button. The language and logout mutations are
 * handled internally so callers don't duplicate that logic. (MINCRM-133)
 */

import { useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useAuth, AUTH_QUERY_KEY } from '@/hooks/useAuth.js';
import { logout } from '@/api/auth.js';
import { setMyLanguage, MY_LANGUAGE_QUERY_KEY } from '@/api/users.js';
import { Button } from '@/components/ui/Button.js';
import { SUPPORTED_LOCALES, type SupportedLocale } from '@shared/schemas/settingsSchema.js';
import { LOCALE_NATIVE_NAME } from './navLinks.js';
import GlobalSearch from './GlobalSearch.js';

/** Props for the optional hamburger toggle button. */
export interface HamburgerProps {
  /** Whether the controlled drawer is currently open. */
  isOpen: boolean;
  /** Toggles the drawer open/closed. */
  onToggle: () => void;
  /** Value for aria-controls — the id of the drawer element. */
  controls: string;
  /**
   * When true the button is only rendered below the `lg` breakpoint.
   * Used by NavTop, which shows full nav links on desktop and only needs
   * the hamburger on mobile.
   */
  mobileOnly?: boolean;
  /**
   * Optional ref attached to the toggle button so callers can exclude it
   * from outside-click handlers that close the drawer.
   */
  toggleEl?: React.RefObject<HTMLButtonElement | null>;
  /**
   * data-testid for the toggle button. Callers must pass a layout-specific
   * value to avoid testId collisions when multiple nav layouts share the page.
   */
  testId?: string;
}

export interface NavHeaderProps {
  /**
   * When provided, renders a hamburger toggle button wired to a drawer.
   * Omit for NavLeft, which has no hamburger.
   */
  hamburger?: HamburgerProps;
}

/** Hamburger / close icon SVG paths. */
const HAMBURGER_PATH = 'M4 6h16M4 12h16M4 18h16';
const CLOSE_PATH = 'M6 18L18 6M6 6l12 12';

/**
 * Shared navigation header bar. Handles language and logout mutations
 * internally; callers only supply hamburger toggle state where needed.
 */
export default function NavHeader({ hamburger }: NavHeaderProps) {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const previousLocaleRef = useRef<string | null>(null);

  const logoutMutation = useMutation({
    mutationFn: logout,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: AUTH_QUERY_KEY });
      navigate('/login', { replace: true });
    },
  });

  const languageMutation = useMutation({
    mutationFn: (locale: SupportedLocale) => setMyLanguage(locale),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: MY_LANGUAGE_QUERY_KEY });
      previousLocaleRef.current = null;
    },
    onError: () => {
      if (previousLocaleRef.current) {
        void i18n.changeLanguage(previousLocaleRef.current);
        previousLocaleRef.current = null;
      }
    },
  });

  /**
   * Handles language selection. Applies the change optimistically and reverts
   * to the previous locale if the API call fails.
   *
   * @param locale - The selected locale code.
   */
  function handleLanguageChange(locale: SupportedLocale): void {
    previousLocaleRef.current = i18n.language;
    void i18n.changeLanguage(locale);
    languageMutation.mutate(locale);
  }

  // Destructure hamburger props so the linter doesn't flag plain value accesses
  // as "ref access during render" due to the co-located toggleEl RefObject.
  const hamburgerIsOpen = hamburger?.isOpen ?? false;
  const hamburgerOnToggle = hamburger?.onToggle;
  const hamburgerControls = hamburger?.controls;
  const hamburgerToggleEl = hamburger?.toggleEl;
  const hamburgerButtonClass = [
    'flex items-center justify-center w-11 h-11 rounded-md text-gray-600',
    'hover:text-gray-900 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500',
    hamburger?.mobileOnly ? 'lg:hidden' : '',
  ]
    .join(' ')
    .trim();

  return (
    <div className="px-6 flex items-center min-h-12 gap-3 py-2">
      {/* Brand */}
      <span className="text-indigo-600 font-bold text-lg tracking-tight select-none flex-shrink-0">
        MiniCRM
      </span>

      {/* Search */}
      <div className="flex-1">
        <GlobalSearch />
      </div>

      {/* Right controls */}
      <div className="flex items-center gap-3 ms-auto">
        {user && (
          <span className="text-sm text-gray-500 hidden sm:block truncate max-w-[12rem]">
            {user.name}
          </span>
        )}
        <select
          aria-label={t('nav.languageSelector')}
          data-testid="nav-language-select"
          value={i18n.language}
          onChange={(e) => handleLanguageChange(e.target.value as SupportedLocale)}
          className="hidden lg:block text-sm text-gray-600 bg-transparent border-none focus:outline-none focus:ring-2 focus:ring-indigo-500 rounded cursor-pointer"
        >
          {SUPPORTED_LOCALES.map((locale) => (
            <option key={locale} value={locale}>
              {LOCALE_NATIVE_NAME[locale]}
            </option>
          ))}
        </select>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          data-testid="nav-logout"
          onClick={() => logoutMutation.mutate()}
          disabled={logoutMutation.isPending}
          className="hidden lg:inline-flex"
        >
          {t('nav.logout')}
        </Button>

        {hamburger && (
          <button
            ref={hamburgerToggleEl}
            type="button"
            aria-label={hamburgerIsOpen ? t('nav.close') : t('nav.menu')}
            aria-expanded={hamburgerIsOpen}
            aria-controls={hamburgerControls}
            data-testid={hamburger?.testId ?? 'nav-menu-toggle'}
            onClick={hamburgerOnToggle}
            className={hamburgerButtonClass}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-6 w-6"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d={hamburgerIsOpen ? CLOSE_PATH : HAMBURGER_PATH}
              />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
