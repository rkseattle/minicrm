/**
 * NavTop — top navigation bar layout.
 * Desktop: sticky header + tab bar across the top with all nav links visible.
 * Mobile (below lg): hamburger button in the header triggers a full-width
 * slide-down drawer with nav links and search.
 * (MINCRM-133)
 */

import { NavLink, useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useRef, useState, useEffect, useCallback } from 'react';
import { useAuth, AUTH_QUERY_KEY } from '@/hooks/useAuth.js';
import { useFeatureFlags } from '@/hooks/useFeatureFlag.js';
import { logout } from '@/api/auth.js';
import { setMyLanguage, MY_LANGUAGE_QUERY_KEY } from '@/api/users.js';
import { Button } from '@/components/ui/Button.js';
import { SUPPORTED_LOCALES, type SupportedLocale } from '@shared/schemas/settingsSchema.js';
import { NAV_LINKS, DESTINATION_NAME, LOCALE_NATIVE_NAME } from './navLinks.js';
import NavHeader from './NavHeader.js';

/**
 * Returns Tailwind classes for a desktop nav link based on its active state.
 *
 * @param isActive - Whether the link matches the current route.
 */
function navLinkClass({ isActive }: { isActive: boolean }): string {
  return [
    'px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
    isActive
      ? 'bg-primary-50 text-primary-700'
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
      ? 'bg-primary-50 text-primary-700'
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

  function handleLanguageChange(locale: SupportedLocale): void {
    previousLocaleRef.current = i18n.language;
    void i18n.changeLanguage(locale);
    languageMutation.mutate(locale);
  }

  /** Close mobile drawer. */
  const closeMobileMenu = useCallback((): void => {
    setMobileMenuOpen(false);
  }, []);

  // Close drawer on outside tap/click, excluding the toggle button
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
  }, [mobileMenuOpen, closeMobileMenu]);

  // Move focus into drawer when it opens
  useEffect(() => {
    if (mobileMenuOpen && drawerRef.current) {
      const firstLink = drawerRef.current.querySelector<HTMLElement>('a, button');
      firstLink?.focus();
    }
  }, [mobileMenuOpen]);

  const { flags, isLoading: flagsLoading } = useFeatureFlags();

  const visibleLinks = NAV_LINKS.filter((link) => {
    if (!link.adminOnly || user?.role === 'admin') {
      // role check passes — now check feature flag
      // Affirmative confirmation required once the flags have RESOLVED: an
      // errored or absent map previously kept every gated link visible, showing
      // users features they may not have.
      //
      // While still loading the link is kept in the list on purpose, so the
      // skeleton branch below can render in its place — filtering it out here
      // would make that skeleton unreachable and collapse the nav on first
      // paint. (MINCRM-701)
      if (link.featureFlag && !flagsLoading && flags?.[link.featureFlag] !== true) return false;
      return true;
    }
    return false;
  });

  return (
    <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
      <NavHeader
        hamburger={{
          isOpen: mobileMenuOpen,
          onToggle: () => setMobileMenuOpen((open) => !open),
          controls: 'mobile-nav-drawer',
          mobileOnly: true,
          toggleEl: hamburgerRef,
        }}
      />

      {/* Nav tabs row — desktop only */}
      <nav className="hidden lg:block border-t border-gray-100">
        <div className="px-6 flex items-center gap-1 py-1.5">
          {visibleLinks.map((link) => (
            <div key={link.to} className="flex items-center gap-1">
              {link.sectionLabelKey && (
                <div
                  className="flex items-center gap-2 ps-1"
                  data-testid="nav-top-admin-section-divider"
                  aria-hidden="true"
                >
                  <div className="h-4 w-px bg-gray-300" />
                  <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider pe-1">
                    {t(link.sectionLabelKey)}
                  </span>
                </div>
              )}
              {flagsLoading && link.featureFlag ? (
                <div
                  className="h-8 bg-gray-200 rounded animate-pulse mx-2 my-1"
                  aria-hidden="true"
                />
              ) : (
                <NavLink
                  to={link.to}
                  end={link.end}
                  className={navLinkClass}
                  data-testid={`nav-top-${DESTINATION_NAME[link.to]}`}
                >
                  {t(link.labelKey)}
                </NavLink>
              )}
            </div>
          ))}
        </div>
      </nav>

      {/* Mobile nav drawer */}
      {mobileMenuOpen && (
        <div
          id="mobile-nav-drawer"
          data-testid="mobile-nav-drawer"
          ref={drawerRef}
          role="dialog"
          aria-label={t('nav.menu')}
          className="lg:hidden border-t border-gray-200 bg-white px-4 py-3 space-y-1"
        >
          {visibleLinks.map((link) => (
            <div key={link.to}>
              {link.sectionLabelKey && (
                <div
                  className="px-1 pt-2 pb-1"
                  data-testid="nav-top-admin-section-divider-mobile"
                  aria-hidden="true"
                >
                  <hr className="border-gray-200 mb-2" />
                  <span className="px-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    {t(link.sectionLabelKey)}
                  </span>
                </div>
              )}
              {flagsLoading && link.featureFlag ? (
                <div
                  className="h-8 bg-gray-200 rounded animate-pulse mx-2 my-1"
                  aria-hidden="true"
                />
              ) : (
                <NavLink
                  to={link.to}
                  end={link.end}
                  className={mobileNavLinkClass}
                  data-testid={`nav-top-${DESTINATION_NAME[link.to]}-mobile`}
                  onClick={closeMobileMenu}
                >
                  {t(link.labelKey)}
                </NavLink>
              )}
            </div>
          ))}
          <div className="pt-2 border-t border-gray-100 space-y-1">
            <select
              aria-label={t('nav.languageSelector')}
              data-testid="nav-language-select-mobile"
              value={i18n.language}
              onChange={(e) => handleLanguageChange(e.target.value as SupportedLocale)}
              className="w-full px-4 py-3 text-base text-gray-700 bg-transparent border-none focus:outline-none focus:ring-2 focus:ring-primary-500 rounded cursor-pointer min-h-[44px]"
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
    </div>
  );
}
