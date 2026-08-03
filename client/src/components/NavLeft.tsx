/**
 * NavLeft — collapsible left sidebar navigation layout.
 * Fully functional at viewport widths of 1024px and above.
 * (MINCRM-133)
 */

import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import { useAuth } from '@/hooks/useAuth.js';
import { useFeatureFlags } from '@/hooks/useFeatureFlag.js';
import { NAV_LINKS, DESTINATION_NAME } from './navLinks.js';
import NavHeader from './NavHeader.js';

/**
 * Returns Tailwind classes for a sidebar nav link based on its active state.
 *
 * @param isActive - Whether the link matches the current route.
 */
function sidebarLinkClass({ isActive }: { isActive: boolean }): string {
  return [
    'flex items-center w-full px-3 py-2 rounded-md text-sm font-medium transition-colors min-h-[36px]',
    isActive
      ? 'bg-primary-50 text-primary-700'
      : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50',
  ].join(' ');
}

/**
 * Left sidebar navigation layout component. (MINCRM-133)
 */
export default function NavLeft({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [collapsed, setCollapsed] = useState(false);

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
      // paint. (MINCRM-695, MINCRM-696)
      if (link.featureFlag && !flagsLoading && flags?.[link.featureFlag] !== true) return false;
      return true;
    }
    return false;
  });

  return (
    <div className="flex flex-col min-h-screen">
      {/* Top header — spans full width above sidebar and content */}
      <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <NavHeader />
      </header>

      {/* Body row — sidebar + content */}
      <div className="flex flex-1 min-h-0">
        {/* Sidebar */}
        <aside
          className={`flex flex-col bg-white border-e border-gray-200 transition-all duration-200 ${
            collapsed ? 'w-14' : 'w-56'
          }`}
          aria-label="Sidebar navigation"
        >
          {/* Collapse toggle */}
          <div className="flex items-center justify-end px-3 py-3 border-b border-gray-100 min-h-12">
            <button
              type="button"
              aria-label={collapsed ? t('nav.expandSidebar') : t('nav.collapseSidebar')}
              data-testid="nav-left-collapse-toggle"
              onClick={() => setCollapsed((c) => !c)}
              className="flex items-center justify-center w-8 h-8 rounded-md text-gray-500 hover:text-gray-900 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500 flex-shrink-0"
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

          {/* Nav links */}
          <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-0.5">
            {visibleLinks.map((link) => (
              <div key={link.to}>
                {link.sectionLabelKey && (
                  <div
                    className="px-1 pt-3 pb-1"
                    data-testid="nav-left-admin-section-divider"
                    aria-hidden="true"
                  >
                    <hr className="border-gray-200 mb-2" />
                    {!collapsed && (
                      <span className="px-2 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                        {t(link.sectionLabelKey)}
                      </span>
                    )}
                  </div>
                )}
                {flagsLoading && link.featureFlag ? (
                  <div
                    key={link.to}
                    className="h-8 bg-gray-200 rounded animate-pulse mx-2 my-1"
                    aria-hidden="true"
                  />
                ) : (
                  <NavLink
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
                )}
              </div>
            ))}
          </nav>
        </aside>

        {/* Main content area */}
        <div className="flex-1 min-w-0">{children}</div>
      </div>
    </div>
  );
}
