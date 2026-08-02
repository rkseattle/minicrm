/**
 * NavHamburger — icon-triggered popover navigation layout. (MINCRM-133, MINCRM-265)
 * A persistent top bar shows only the brand + hamburger icon.
 * Clicking the icon opens a fixed-position popover anchored below the hamburger
 * button in the top-right corner — not a left-edge drawer.
 */

import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useRef, useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/hooks/useAuth.js';
import { useFeatureFlags } from '@/hooks/useFeatureFlag.js';
import { NAV_LINKS, DESTINATION_NAME } from './navLinks.js';
import NavHeader from './NavHeader.js';

/**
 * Returns Tailwind classes for a popover nav link based on its active state.
 *
 * @param isActive - Whether the link matches the current route.
 */
function popoverLinkClass({ isActive }: { isActive: boolean }): string {
  return [
    'flex items-center w-full px-4 py-3 text-base font-medium rounded-md transition-colors min-h-[44px]',
    isActive
      ? 'bg-primary-50 text-primary-700'
      : 'text-gray-700 hover:text-gray-900 hover:bg-gray-50',
  ].join(' ');
}

/** Pixel gap between the bottom of the toggle button and the top of the popover. */
const POPOVER_GAP = 4;

/**
 * Hamburger popover navigation layout component. (MINCRM-133)
 */
export default function NavHamburger() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const hamburgerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  /** Close the popover. */
  const closeMenu = useCallback((): void => {
    setMenuOpen(false);
  }, []);

  // Close on outside pointer-down, excluding the toggle button itself
  useEffect(() => {
    if (!menuOpen) return;
    function handlePointerDown(e: PointerEvent): void {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node) &&
        !hamburgerRef.current?.contains(e.target as Node)
      ) {
        closeMenu();
      }
    }
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [menuOpen, closeMenu]);

  // Close on Escape key
  useEffect(() => {
    if (!menuOpen) return;
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        closeMenu();
        hamburgerRef.current?.focus();
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [menuOpen, closeMenu]);

  // Move focus into popover when it opens
  useEffect(() => {
    if (menuOpen && popoverRef.current) {
      const firstFocusable = popoverRef.current.querySelector<HTMLElement>('a, button');
      firstFocusable?.focus();
    }
  }, [menuOpen]);

  // Popover position captured from the button rect at the moment of the click —
  // reading ref.current in an event handler is safe; it is not read during render.
  const [popoverPos, setPopoverPos] = useState({ top: 0, right: 0 });

  const handleToggle = useCallback((): void => {
    const rect = hamburgerRef.current?.getBoundingClientRect();
    if (rect) {
      setPopoverPos({
        top: rect.bottom + POPOVER_GAP,
        right: window.innerWidth - rect.right,
      });
    }
    setMenuOpen((open) => !open);
  }, []);

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
    <>
      {/* Top bar — brand, search, user controls, hamburger */}
      <nav className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <NavHeader
          hamburger={{
            isOpen: menuOpen,
            onToggle: handleToggle,
            controls: 'hamburger-nav-drawer',
            toggleEl: hamburgerRef,
          }}
        />
      </nav>

      {/* Popover anchored to the hamburger button — MINCRM-265 */}
      {menuOpen && (
        <div
          id="hamburger-nav-drawer"
          ref={popoverRef}
          role="dialog"
          aria-label={t('nav.menu')}
          style={{ top: popoverPos.top, right: popoverPos.right }}
          className="fixed z-30 w-72 max-w-[calc(100vw-1rem)] bg-white rounded-lg shadow-xl border border-gray-200 flex flex-col"
          data-testid="nav-hamburger-drawer"
        >
          {/* Popover header — close button */}
          <div className="flex items-center justify-end px-4 py-2 border-b border-gray-100 min-h-10">
            <button
              type="button"
              aria-label={t('nav.close')}
              data-testid="nav-hamburger-close"
              onClick={closeMenu}
              className="flex items-center justify-center w-9 h-9 rounded-md text-gray-500 hover:text-gray-900 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
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
          <nav className="overflow-y-auto max-h-[calc(100vh-8rem)] px-3 py-3 space-y-0.5">
            {visibleLinks.map((link) => (
              <div key={link.to}>
                {link.sectionLabelKey && (
                  <div
                    className="px-1 pt-3 pb-1"
                    data-testid="nav-hamburger-admin-section-divider"
                    aria-hidden="true"
                  >
                    <hr className="border-gray-200 mb-2" />
                    <span className="px-1 text-xs font-semibold text-gray-500 uppercase tracking-wider">
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
                    className={popoverLinkClass}
                    data-testid={`nav-hamburger-${DESTINATION_NAME[link.to]}`}
                    onClick={closeMenu}
                  >
                    {t(link.labelKey)}
                  </NavLink>
                )}
              </div>
            ))}
          </nav>
        </div>
      )}
    </>
  );
}
