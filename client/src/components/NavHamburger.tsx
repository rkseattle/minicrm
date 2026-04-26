/**
 * NavHamburger — icon-triggered overlay navigation layout.
 * A persistent top bar shows only the brand + hamburger icon.
 * Clicking the icon opens a full-height overlay drawer with all nav links.
 * Functional at all viewport widths. (MINCRM-133)
 */

import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useRef, useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/hooks/useAuth.js';
import { NAV_LINKS, DESTINATION_NAME } from './navLinks.js';
import NavHeader from './NavHeader.js';

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
  const { t } = useTranslation();
  const { user } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const hamburgerRef = useRef<HTMLButtonElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);

  /** Close the overlay. */
  const closeMenu = useCallback((): void => {
    setMenuOpen(false);
  }, []);

  // Close on outside tap/click, excluding the toggle button
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
  }, [menuOpen, closeMenu]);

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
      {/* Top bar — brand, search, user controls, hamburger */}
      <nav className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <NavHeader
          hamburger={{
            isOpen: menuOpen,
            onToggle: () => setMenuOpen((open) => !open),
            controls: 'hamburger-nav-drawer',
            toggleEl: hamburgerRef,
          }}
        />
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
          {/* Drawer header — close button only */}
          <div className="flex items-center justify-end px-4 py-3 border-b border-gray-100 min-h-12">
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
              <div key={link.to}>
                {link.sectionLabelKey && (
                  <div
                    className="px-1 pt-3 pb-1"
                    data-testid="nav-hamburger-admin-section-divider"
                    aria-hidden="true"
                  >
                    <hr className="border-gray-200 mb-2" />
                    <span className="px-1 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                      {t(link.sectionLabelKey)}
                    </span>
                  </div>
                )}
                <NavLink
                  to={link.to}
                  end={link.end}
                  className={overlayLinkClass}
                  data-testid={`nav-hamburger-${DESTINATION_NAME[link.to]}`}
                  onClick={closeMenu}
                >
                  {t(link.labelKey)}
                </NavLink>
              </div>
            ))}
          </nav>
        </div>
      )}
    </>
  );
}
