/**
 * NavTop — top navigation bar layout.
 * Desktop: sticky header + tab bar across the top with all nav links visible.
 * Mobile (below lg): hamburger button in the header triggers a full-width
 * slide-down drawer with nav links and search.
 * (MINCRM-133)
 */

import { NavLink } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useRef, useState, useEffect, useCallback } from 'react';
import { useAuth, AUTH_QUERY_KEY } from '@/hooks/useAuth.js';
import { logout } from '@/api/auth.js';
import { Button } from '@/components/ui/Button.js';
import { NAV_LINKS, DESTINATION_NAME } from './navLinks.js';
import GlobalSearch from './GlobalSearch.js';
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
  const { t } = useTranslation();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const hamburgerRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);

  const logoutMutation = useMutation({
    mutationFn: logout,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: AUTH_QUERY_KEY });
    },
  });

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

  const isAdmin = user?.role === 'admin';
  const visibleLinks = NAV_LINKS.filter((link) => !link.adminOnly || isAdmin);

  return (
    <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
      <NavHeader
        mobileHidden
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
      </nav>

      {/* Mobile nav drawer */}
      {mobileMenuOpen && (
        <div
          id="mobile-nav-drawer"
          ref={drawerRef}
          role="dialog"
          aria-label={t('nav.menu')}
          className="lg:hidden border-t border-gray-200 bg-white px-4 py-3 space-y-1"
        >
          {/* Search — mobile only (hidden in header on mobile) */}
          <div className="pb-2">
            <GlobalSearch />
          </div>
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
    </div>
  );
}
