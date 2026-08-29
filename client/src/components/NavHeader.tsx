/**
 * NavHeader — shared top-bar header used by all three nav layouts.
 *
 * Renders: brand, search, the notification bell, the user menu, and an optional
 * hamburger toggle button. The language and logout mutations live in UserMenu,
 * alongside the controls that fire them.
 */

import { useTranslation } from 'react-i18next';
import { useAuth } from '@/hooks/useAuth.js';
import { UserMenu } from '@/components/ui/UserMenu.js';
import GlobalSearch from './GlobalSearch.js';
import { useBranding } from '@/context/BrandingContext.js';
import PoweredByBadge from './PoweredByBadge.js';
import NotificationBell from './NotificationBell.js';

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
 * Shared navigation header bar. Callers supply hamburger toggle state where needed.
 */
export default function NavHeader({ hamburger }: NavHeaderProps) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { branding } = useBranding();

  // Destructure hamburger props so the linter doesn't flag plain value accesses
  // as "ref access during render" due to the co-located toggleEl RefObject.
  const hamburgerIsOpen = hamburger?.isOpen ?? false;
  const hamburgerOnToggle = hamburger?.onToggle;
  const hamburgerControls = hamburger?.controls;
  const hamburgerToggleEl = hamburger?.toggleEl;
  const hamburgerButtonClass = [
    'flex items-center justify-center w-11 h-11 rounded-md text-gray-600',
    'hover:text-gray-900 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-primary-500',
    hamburger?.mobileOnly ? 'lg:hidden' : '',
  ]
    .join(' ')
    .trim();

  return (
    <div className="px-6 flex items-center min-h-12 gap-3 py-2">
      {/* Brand — custom logo when configured, otherwise MiniCRM wordmark */}
      {branding?.logoUrl ? (
        <img
          src={branding.logoUrl}
          alt={branding.logoAltText ?? branding.companyName ?? 'Logo'}
          className="h-8 w-auto flex-shrink-0 object-contain"
          data-testid="nav-brand-logo"
        />
      ) : (
        <span
          className="text-primary-600 font-bold text-lg tracking-tight select-none flex-shrink-0"
          data-testid="nav-brand-wordmark"
        >
          {branding?.companyName ?? t('nav.appName')}
        </span>
      )}

      {/* Search */}
      <div className="flex-1">
        <GlobalSearch />
      </div>

      {/* Right controls */}
      <div className="flex items-center gap-3 ms-auto">
        {user && <NotificationBell />}
        {user && <UserMenu userName={user.name} />}

        {/* Powered by badge — only when custom branding is active */}
        {branding?.poweredByEnabled && <PoweredByBadge />}

        {hamburger && (
          <button
            ref={hamburgerToggleEl}
            type="button"
            aria-label={hamburgerIsOpen ? t('nav.close') : t('nav.menu')}
            aria-expanded={hamburgerIsOpen}
            aria-controls={hamburgerControls}
            data-testid="nav-menu-toggle"
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
