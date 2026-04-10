/**
 * NavLeft — collapsible left sidebar navigation layout.
 * Fully functional at viewport widths of 1024px and above.
 * (MINCRM-133)
 */

import { NavLink, useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useRef, useState } from 'react';
import { useAuth, AUTH_QUERY_KEY } from '@/hooks/useAuth.js';
import { logout } from '@/api/auth.js';
import { setMyLanguage, MY_LANGUAGE_QUERY_KEY } from '@/api/users.js';
import { Button } from '@/components/ui/Button.js';
import { SUPPORTED_LOCALES, type SupportedLocale } from '@shared/schemas/settingsSchema.js';
import { NAV_LINKS, DESTINATION_NAME, LOCALE_NATIVE_NAME } from './navLinks.js';
import GlobalSearch from './GlobalSearch.js';

/**
 * Returns Tailwind classes for a sidebar nav link based on its active state.
 *
 * @param isActive - Whether the link matches the current route.
 */
function sidebarLinkClass({ isActive }: { isActive: boolean }): string {
  return [
    'flex items-center w-full px-3 py-2 rounded-md text-sm font-medium transition-colors min-h-[36px]',
    isActive
      ? 'bg-indigo-50 text-indigo-700'
      : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50',
  ].join(' ');
}

/**
 * Left sidebar navigation layout component. (MINCRM-133)
 */
export default function NavLeft({ children }: { children: React.ReactNode }) {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [collapsed, setCollapsed] = useState(false);
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

  const isAdmin = user?.role === 'admin';
  const visibleLinks = NAV_LINKS.filter((link) => !link.adminOnly || isAdmin);

  return (
    <div className="flex min-h-screen">
      {/* Sidebar */}
      <aside
        className={`flex flex-col bg-white border-e border-gray-200 transition-all duration-200 ${
          collapsed ? 'w-14' : 'w-56'
        }`}
        aria-label="Sidebar navigation"
      >
        {/* Brand + collapse toggle */}
        <div className="flex items-center justify-between px-3 py-3 border-b border-gray-100 min-h-14">
          {!collapsed && (
            <span className="text-indigo-600 font-bold text-base tracking-tight select-none truncate">
              MiniCRM
            </span>
          )}
          <button
            type="button"
            aria-label={collapsed ? t('nav.expandSidebar') : t('nav.collapseSidebar')}
            data-testid="nav-left-collapse-toggle"
            onClick={() => setCollapsed((c) => !c)}
            className="flex items-center justify-center w-8 h-8 rounded-md text-gray-500 hover:text-gray-900 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 flex-shrink-0"
          >
            {collapsed ? (
              // Expand icon (chevron right)
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-4 w-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
                aria-hidden="true"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            ) : (
              // Collapse icon (chevron left)
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-4 w-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
                aria-hidden="true"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            )}
          </button>
        </div>

        {/* Search — hidden when sidebar is collapsed */}
        {!collapsed && (
          <div className="px-2 py-2 border-b border-gray-100">
            <GlobalSearch />
          </div>
        )}

        {/* Nav links */}
        <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-0.5">
          {visibleLinks.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.end}
              className={sidebarLinkClass}
              data-testid={`nav-left-${DESTINATION_NAME[link.to]}`}
              title={collapsed ? t(link.labelKey) : undefined}
            >
              {!collapsed && t(link.labelKey)}
              {collapsed && (
                // Show first letter as icon placeholder when collapsed
                <span className="font-semibold text-xs uppercase" aria-hidden="true">
                  {t(link.labelKey).charAt(0)}
                </span>
              )}
            </NavLink>
          ))}
        </nav>

        {/* Footer controls */}
        <div className="border-t border-gray-100 px-2 py-3 space-y-2">
          {!collapsed && user && <p className="px-3 text-xs text-gray-500 truncate">{user.name}</p>}
          {!collapsed && (
            <select
              aria-label={t('nav.languageSelector')}
              data-testid="nav-language-select"
              value={i18n.language}
              onChange={(e) => handleLanguageChange(e.target.value as SupportedLocale)}
              className="w-full text-sm text-gray-600 bg-transparent border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-2 focus:ring-indigo-500 cursor-pointer"
            >
              {SUPPORTED_LOCALES.map((locale) => (
                <option key={locale} value={locale}>
                  {LOCALE_NATIVE_NAME[locale]}
                </option>
              ))}
            </select>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-testid="nav-logout"
            onClick={() => logoutMutation.mutate()}
            disabled={logoutMutation.isPending}
            className={`w-full justify-start min-h-[36px] ${collapsed ? 'px-1' : ''}`}
            title={collapsed ? t('nav.logout') : undefined}
          >
            {collapsed ? (
              // Logout icon when collapsed
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-4 w-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
                />
              </svg>
            ) : (
              t('nav.logout')
            )}
          </Button>
        </div>
      </aside>

      {/* Main content area */}
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}
