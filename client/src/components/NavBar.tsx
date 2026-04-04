/**
 * NavBar component.
 * Sticky top navigation displayed on all authenticated pages.
 * Shows the app brand, navigation links with active state, and user controls.
 * On mobile (below lg:) renders a hamburger menu that opens a full-width drawer.
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

/**
 * Native name for each supported locale, displayed in the language selector.
 * Using the language's own script avoids depending on the active translation
 * and ensures users can always identify their language regardless of the current UI language.
 */
const LOCALE_NATIVE_NAME: Record<SupportedLocale, string> = {
  en: 'English',
  'zh-Hans': '中文（简体）',
  es: 'Español',
  fr: 'Français',
  de: 'Deutsch',
};

/**
 * Returns Tailwind classes for a desktop navigation link based on its active state.
 *
 * @param isActive - Whether the link matches the current route
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
 * Returns Tailwind classes for a mobile drawer navigation link based on its active state.
 *
 * @param isActive - Whether the link matches the current route
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
 * Top-level navigation bar.
 */
export default function NavBar() {
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

  /** Tracks the locale active before the most recent optimistic change, for rollback on error */
  const previousLocaleRef = useRef<string | null>(null);

  const languageMutation = useMutation({
    mutationFn: (locale: SupportedLocale) => setMyLanguage(locale),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: MY_LANGUAGE_QUERY_KEY });
      previousLocaleRef.current = null;
    },
    onError: () => {
      // Revert the optimistic language change so the UI stays in sync with the server
      if (previousLocaleRef.current) {
        void i18n.changeLanguage(previousLocaleRef.current);
        previousLocaleRef.current = null;
      }
    },
  });

  /**
   * Handles language selection from the NavBar dropdown.
   * Applies the change optimistically and persists it to the server.
   * Reverts to the previous locale if the save fails.
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

  // Close drawer on outside tap/click
  useEffect(() => {
    if (!mobileMenuOpen) return;

    function handlePointerDown(e: PointerEvent): void {
      if (drawerRef.current && !drawerRef.current.contains(e.target as Node)) {
        closeMobileMenu();
      }
    }

    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [mobileMenuOpen]);

  // Move focus into drawer when it opens
  useEffect(() => {
    if (mobileMenuOpen && drawerRef.current) {
      const firstLink = drawerRef.current.querySelector<HTMLElement>('a, button');
      firstLink?.focus();
    }
  }, [mobileMenuOpen]);

  const isAdmin = user?.role === 'admin';

  return (
    <nav className="bg-white border-b border-gray-200 sticky top-0 z-10">
      <div className="max-w-7xl mx-auto px-6 flex items-center justify-between min-h-14 gap-y-1 py-2">
        {/* Brand */}
        <span className="text-indigo-600 font-bold text-lg tracking-tight select-none">
          MiniCRM
        </span>

        {/* Desktop nav links — hidden below lg */}
        <div className="hidden lg:flex items-center gap-1 flex-wrap">
          <NavLink to="/" end className={navLinkClass} data-testid="nav-link-dashboard">
            {t('nav.dashboard')}
          </NavLink>
          <NavLink to="/contacts" className={navLinkClass} data-testid="nav-link-contacts">
            {t('nav.contacts')}
          </NavLink>
          <NavLink to="/accounts" className={navLinkClass} data-testid="nav-link-accounts">
            {t('nav.accounts')}
          </NavLink>
          <NavLink to="/deals" className={navLinkClass} data-testid="nav-link-deals">
            {t('nav.deals')}
          </NavLink>
          <NavLink to="/tasks" className={navLinkClass} data-testid="nav-link-my-tasks">
            {t('nav.myTasks')}
          </NavLink>
          {isAdmin && (
            <NavLink to="/users" className={navLinkClass} data-testid="nav-link-users">
              {t('nav.users')}
            </NavLink>
          )}
          {isAdmin && (
            <NavLink
              to="/reports/win-loss"
              className={navLinkClass}
              data-testid="nav-link-win-loss-report"
            >
              {t('nav.winLossReport')}
            </NavLink>
          )}
          {isAdmin && (
            <NavLink
              to="/admin/automation"
              className={navLinkClass}
              data-testid="nav-link-automation"
            >
              {t('nav.automation')}
            </NavLink>
          )}
          {isAdmin && (
            <NavLink
              to="/admin/settings"
              className={navLinkClass}
              data-testid="nav-link-admin-settings"
            >
              {t('nav.adminSettings')}
            </NavLink>
          )}
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
              // X icon
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
              // Hamburger icon
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

      {/* Mobile nav drawer — visible below lg when open */}
      {mobileMenuOpen && (
        <div
          id="mobile-nav-drawer"
          ref={drawerRef}
          role="dialog"
          aria-label={t('nav.menu')}
          className="lg:hidden border-t border-gray-200 bg-white px-4 py-3 space-y-1"
        >
          <NavLink
            to="/"
            end
            className={mobileNavLinkClass}
            data-testid="nav-link-dashboard-mobile"
            onClick={closeMobileMenu}
          >
            {t('nav.dashboard')}
          </NavLink>
          <NavLink
            to="/contacts"
            className={mobileNavLinkClass}
            data-testid="nav-link-contacts-mobile"
            onClick={closeMobileMenu}
          >
            {t('nav.contacts')}
          </NavLink>
          <NavLink
            to="/accounts"
            className={mobileNavLinkClass}
            data-testid="nav-link-accounts-mobile"
            onClick={closeMobileMenu}
          >
            {t('nav.accounts')}
          </NavLink>
          <NavLink
            to="/deals"
            className={mobileNavLinkClass}
            data-testid="nav-link-deals-mobile"
            onClick={closeMobileMenu}
          >
            {t('nav.deals')}
          </NavLink>
          <NavLink
            to="/tasks"
            className={mobileNavLinkClass}
            data-testid="nav-link-my-tasks-mobile"
            onClick={closeMobileMenu}
          >
            {t('nav.myTasks')}
          </NavLink>
          {isAdmin && (
            <NavLink
              to="/users"
              className={mobileNavLinkClass}
              data-testid="nav-link-users-mobile"
              onClick={closeMobileMenu}
            >
              {t('nav.users')}
            </NavLink>
          )}
          {isAdmin && (
            <NavLink
              to="/reports/win-loss"
              className={mobileNavLinkClass}
              data-testid="nav-link-win-loss-report-mobile"
              onClick={closeMobileMenu}
            >
              {t('nav.winLossReport')}
            </NavLink>
          )}
          {isAdmin && (
            <NavLink
              to="/admin/automation"
              className={mobileNavLinkClass}
              data-testid="nav-link-automation-mobile"
              onClick={closeMobileMenu}
            >
              {t('nav.automation')}
            </NavLink>
          )}
          {isAdmin && (
            <NavLink
              to="/admin/settings"
              className={mobileNavLinkClass}
              data-testid="nav-link-admin-settings-mobile"
              onClick={closeMobileMenu}
            >
              {t('nav.adminSettings')}
            </NavLink>
          )}
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
