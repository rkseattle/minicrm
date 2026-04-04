/**
 * NavHamburger — icon-triggered overlay navigation layout.
 * A persistent top bar shows only the brand + hamburger icon.
 * Clicking the icon opens a full-height overlay drawer with all nav links.
 * Functional at all viewport widths. (MINCRM-133)
 */

import { NavLink, useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useRef, useState, useEffect } from 'react';
import { useAuth, AUTH_QUERY_KEY } from '@/hooks/useAuth.js';
import { logout } from '@/api/auth.js';
import { setMyLanguage, MY_LANGUAGE_QUERY_KEY } from '@/api/users.js';
import { Button } from '@/components/ui/Button.js';
import { SUPPORTED_LOCALES, type SupportedLocale } from '@shared/schemas/settingsSchema.js';
import { NAV_LINKS, DESTINATION_NAME } from './navLinks.js';

/**
 * Native name for each supported locale, displayed in the language selector.
 */
const LOCALE_NATIVE_NAME: Record<SupportedLocale, string> = {
  en: 'English',
  'zh-Hans': '中文（简体）',
  es: 'Español',
  fr: 'Français',
  de: 'Deutsch',
};

/**
 * Returns Tailwind classes for an overlay nav link based on its active state.
 *
 * @param isActive - Whether the link matches the current route.
 */
function overlayLinkClass({ isActive }: { isActive: boolean }): string {
  return [
    'flex items-center w-full px-4 py-3 text-base font-medium rounded-md transition-colors min-h-[44px]',
    isActive
      ? 'bg-indigo-50 text-indigo-700'
      : 'text-gray-700 hover:text-gray-900 hover:bg-gray-50',
  ].join(' ');
}

/**
 * Hamburger overlay navigation layout component. (MINCRM-133)
 */
export default function NavHamburger() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [menuOpen, setMenuOpen] = useState(false);
  const hamburgerRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
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
   * Handles language selection. Applies optimistically; reverts on error.
   *
   * @param locale - The selected locale code.
   */
  function handleLanguageChange(locale: SupportedLocale): void {
    previousLocaleRef.current = i18n.language;
    void i18n.changeLanguage(locale);
    languageMutation.mutate(locale);
  }

  /** Close the overlay and restore focus to the hamburger button. */
  function closeMenu(): void {
    setMenuOpen(false);
    hamburgerRef.current?.focus();
  }

  // Close on outside tap/click
  useEffect(() => {
    if (!menuOpen) return;
    function handlePointerDown(e: PointerEvent): void {
      if (
        drawerRef.current &&
        !drawerRef.current.contains(e.target as Node) &&
        !hamburgerRef.current?.contains(e.target as Node)
      ) {
        closeMenu();
      }
    }
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [menuOpen]);

  // Move focus into drawer when it opens
  useEffect(() => {
    if (menuOpen && drawerRef.current) {
      const firstLink = drawerRef.current.querySelector<HTMLElement>('a, button');
      firstLink?.focus();
    }
  }, [menuOpen]);

  const isAdmin = user?.role === 'admin';
  const visibleLinks = NAV_LINKS.filter((link) => !link.adminOnly || isAdmin);

  return (
    <>
      {/* Top bar — brand + hamburger toggle only */}
      <nav className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 flex items-center justify-between min-h-14 py-2">
          <span className="text-indigo-600 font-bold text-lg tracking-tight select-none">
            MiniCRM
          </span>

          <div className="flex items-center gap-3">
            {user && <span className="text-sm text-gray-500 hidden sm:block">{user.name}</span>}
            <select
              aria-label={t('nav.languageSelector')}
              data-testid="nav-language-select"
              value={i18n.language}
              onChange={(e) => handleLanguageChange(e.target.value as SupportedLocale)}
              className="text-sm text-gray-600 bg-transparent border-none focus:outline-none focus:ring-2 focus:ring-indigo-500 rounded cursor-pointer"
            >
              {SUPPORTED_LOCALES.map((locale) => (
                <option key={locale} value={locale}>
                  {LOCALE_NATIVE_NAME[locale]}
                </option>
              ))}
            </select>

            <button
              ref={hamburgerRef}
              type="button"
              aria-label={menuOpen ? t('nav.close') : t('nav.menu')}
              aria-expanded={menuOpen}
              aria-controls="hamburger-nav-drawer"
              data-testid="nav-menu-toggle"
              onClick={() => setMenuOpen((open) => !open)}
              className="flex items-center justify-center w-11 h-11 rounded-md text-gray-600 hover:text-gray-900 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {menuOpen ? (
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-6 w-6"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                  aria-hidden="true"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              ) : (
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-6 w-6"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                  aria-hidden="true"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              )}
            </button>
          </div>
        </div>
      </nav>

      {/* Overlay drawer */}
      {menuOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/30"
          aria-hidden="true"
          data-testid="nav-hamburger-backdrop"
        />
      )}
      {menuOpen && (
        <div
          id="hamburger-nav-drawer"
          ref={drawerRef}
          role="dialog"
          aria-label={t('nav.menu')}
          className="fixed inset-y-0 start-0 z-30 w-72 max-w-full bg-white shadow-xl flex flex-col"
          data-testid="nav-hamburger-drawer"
        >
          {/* Drawer header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 min-h-14">
            <span className="text-indigo-600 font-bold text-base tracking-tight select-none">
              MiniCRM
            </span>
            <button
              type="button"
              aria-label={t('nav.close')}
              data-testid="nav-hamburger-close"
              onClick={closeMenu}
              className="flex items-center justify-center w-9 h-9 rounded-md text-gray-500 hover:text-gray-900 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-5 w-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
                aria-hidden="true"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Nav links */}
          <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-0.5">
            {visibleLinks.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                end={link.end}
                className={overlayLinkClass}
                data-testid={`nav-hamburger-${DESTINATION_NAME[link.to]}`}
                onClick={closeMenu}
              >
                {t(link.labelKey)}
              </NavLink>
            ))}
          </nav>

          {/* Footer */}
          <div className="border-t border-gray-100 px-3 py-3">
            {user && <p className="px-1 mb-2 text-xs text-gray-500 truncate">{user.name}</p>}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              data-testid="nav-logout"
              onClick={() => {
                closeMenu();
                logoutMutation.mutate();
              }}
              disabled={logoutMutation.isPending}
              className="w-full justify-start min-h-[44px]"
            >
              {t('nav.logout')}
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
