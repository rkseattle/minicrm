/**
 * NavBar component.
 * Sticky top navigation displayed on all authenticated pages.
 * Shows the app brand, navigation links with active state, and user controls.
 */

import { NavLink, useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
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
 * Returns Tailwind classes for a navigation link based on its active state.
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
 * Top-level navigation bar.
 */
export default function NavBar() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

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
    },
  });

  /**
   * Handles language selection from the NavBar dropdown.
   * Applies the change immediately to the UI and persists it to the server.
   *
   * @param locale - The selected locale code.
   */
  function handleLanguageChange(locale: SupportedLocale): void {
    void i18n.changeLanguage(locale);
    languageMutation.mutate(locale);
  }

  return (
    <nav className="bg-white border-b border-gray-200 sticky top-0 z-10">
      <div className="max-w-7xl mx-auto px-6 flex items-center justify-between h-14">
        <div className="flex items-center gap-6">
          <span className="text-indigo-600 font-bold text-lg tracking-tight select-none">
            MiniCRM
          </span>
          <div className="flex items-center gap-1">
            <NavLink to="/" end className={navLinkClass} data-testid="nav-dashboard">
              {t('nav.dashboard')}
            </NavLink>
            <NavLink to="/contacts" className={navLinkClass} data-testid="nav-contacts">
              {t('nav.contacts')}
            </NavLink>
            <NavLink to="/accounts" className={navLinkClass} data-testid="nav-accounts">
              {t('nav.accounts')}
            </NavLink>
            <NavLink to="/deals" className={navLinkClass} data-testid="nav-deals">
              {t('nav.deals')}
            </NavLink>
            <NavLink to="/pipeline" className={navLinkClass} data-testid="nav-pipeline">
              {t('nav.pipeline')}
            </NavLink>
            <NavLink to="/tasks" className={navLinkClass} data-testid="nav-my-tasks">
              {t('nav.myTasks')}
            </NavLink>
            {user?.role === 'admin' && (
              <NavLink to="/users" className={navLinkClass} data-testid="nav-users">
                {t('nav.users')}
              </NavLink>
            )}
            {user?.role === 'admin' && (
              <NavLink
                to="/admin/settings"
                className={navLinkClass}
                data-testid="nav-admin-settings"
              >
                {t('nav.adminSettings')}
              </NavLink>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3">
          {user && (
            <NavLink
              to="/settings/profile"
              className={navLinkClass}
              data-testid="nav-profile-settings"
            >
              {t('nav.profileSettings')}
            </NavLink>
          )}
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
          >
            {t('nav.logout')}
          </Button>
        </div>
      </div>
    </nav>
  );
}
