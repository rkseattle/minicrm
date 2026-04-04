/**
 * NavTop — top navigation bar layout.
 * Desktop: sticky tab bar across the top with all nav links visible.
 * Mobile (below lg): hamburger button triggers a full-width slide-down drawer.
 * (MINCRM-133)
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
import { NAV_LINKS, DESTINATION_NAME, LOCALE_NATIVE_NAME } from './navLinks.js';

/**
 * Returns Tailwind classes for a desktop nav link based on its active state.
 *
 * @param isActive - Whether the link matches the current route.
 */
function navLinkClass({ isActive }: { isActive: boolean }): string {
  return [
    'px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
    isActive
      ? 'bg-indigo-50 text-indigo-700'
      : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50',
  ].join(' ');
}

/**
 * Returns Tailwind classes for a mobile drawer nav link based on its active state.
 *
 * @param isActive - Whether the link matches the current route.
 */
function mobileNavLinkClass({ isActive }: { isActive: boolean }): string {
  return [
    'flex items-center w-full px-4 py-3 text-base font-medium rounded-md transition-colors min-h-[44px]',
    isActive
      ? 'bg-indigo-50 text-indigo-700'
      : 'text-gray-700 hover:text-gray-900 hover:bg-gray-50',
  ].join(' ');
}

/**
 * Top navigation bar layout component. (MINCRM-133)
 */
export default function NavTop() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const hamburgerRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);

  const logoutMutation = useMutation({
    mutationFn: logout,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: AUTH_QUERY_KEY });
      navigate('/login', { replace: true });
    },
  });

  const previousLocaleRef = useRef<string | null>(null);

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

  /** Close mobile drawer and restore focus to the hamburger button. */
  function closeMobileMenu(): void {
    setMobileMenuOpen(false);
    hamburgerRef.current?.focus();
  }

  useEffect(() => {
    if (!mobileMenuOpen) return;
    function handlePointerDown(e: PointerEvent): void {
      if (
        drawerRef.current &&
        !drawerRef.current.contains(e.target as Node) &&
        !hamburgerRef.current?.contains(e.target as Node)
      ) {
        closeMobileMenu();
      }
    }
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [mobileMenuOpen]);

  useEffect(() => {
    if (mobileMenuOpen && drawerRef.current) {
      const firstLink = drawerRef.current.querySelector<HTMLElement>('a, button');
      firstLink?.focus();
    }
  }, [mobileMenuOpen]);

  const isAdmin = user?.role === 'admin';
  const visibleLinks = NAV_LINKS.filter((link) => !link.adminOnly || isAdmin);

  return (
    <nav className="bg-white border-b border-gray-200 sticky top-0 z-10">
      <div className="max-w-7xl mx-auto px-6 flex items-center justify-between min-h-14 gap-y-1 py-2">
        {/* Brand */}
        <span className="text-indigo-600 font-bold text-lg tracking-tight select-none">
          MiniCRM
        </span>

        {/* Desktop nav links — hidden below lg */}
        <div className="hidden lg:flex items-center gap-1 flex-wrap">
          {visibleLinks.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.end}
              className={navLinkClass}
              data-testid={`nav-top-${DESTINATION_NAME[link.to]}`}
            >
              {t(link.labelKey)}
            </NavLink>
          ))}
        </div>

        {/* Right controls */}
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

          {/* Hamburger button — visible below lg */}
          <button
            ref={hamburgerRef}
            type="button"
            aria-label={mobileMenuOpen ? t('nav.close') : t('nav.menu')}
            aria-expanded={mobileMenuOpen}
            aria-controls="mobile-nav-drawer"
            data-testid="nav-menu-toggle"
            onClick={() => setMobileMenuOpen((open) => !open)}
            className="lg:hidden flex items-center justify-center w-11 h-11 rounded-md text-gray-600 hover:text-gray-900 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            {mobileMenuOpen ? (
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

      {/* Mobile nav drawer */}
      {mobileMenuOpen && (
        <div
          id="mobile-nav-drawer"
          ref={drawerRef}
          role="dialog"
          aria-label={t('nav.menu')}
          className="lg:hidden border-t border-gray-200 bg-white px-4 py-3 space-y-1"
        >
          {visibleLinks.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.end}
              className={mobileNavLinkClass}
              data-testid={`nav-top-${DESTINATION_NAME[link.to]}-mobile`}
              onClick={closeMobileMenu}
            >
              {t(link.labelKey)}
            </NavLink>
          ))}
          <div className="pt-2 border-t border-gray-100">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              data-testid="nav-logout-mobile"
              onClick={() => {
                closeMobileMenu();
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
    </nav>
  );
}
