/**
 * Shared navigation link definitions used by all three nav layout components.
 * Each entry declares the route path, i18n key, and whether it requires admin role.
 * (MINCRM-133)
 */

export interface NavLinkDef {
  /** Route path */
  to: string;
  /** i18n translation key (relative to the 'nav' namespace) */
  labelKey: string;
  /** Whether the link is only visible to admin users */
  adminOnly: boolean;
  /** Whether NavLink should use exact matching (`end` prop) */
  end?: boolean;
}

/** Ordered list of navigation destinations for all layout components. */
export const NAV_LINKS: NavLinkDef[] = [
  { to: '/', labelKey: 'nav.dashboard', adminOnly: false, end: true },
  { to: '/contacts', labelKey: 'nav.contacts', adminOnly: false },
  { to: '/accounts', labelKey: 'nav.accounts', adminOnly: false },
  { to: '/deals', labelKey: 'nav.deals', adminOnly: false },
  { to: '/tasks', labelKey: 'nav.myTasks', adminOnly: false },
  { to: '/users', labelKey: 'nav.users', adminOnly: true },
  { to: '/reports/win-loss', labelKey: 'nav.winLossReport', adminOnly: true },
  { to: '/admin/automation', labelKey: 'nav.automation', adminOnly: true },
  { to: '/admin/settings', labelKey: 'nav.adminSettings', adminOnly: true },
];

/**
 * Maps a route `to` path to its destination name for data-testid generation.
 * e.g. '/' → 'dashboard', '/contacts' → 'contacts'
 */
export const DESTINATION_NAME: Record<string, string> = {
  '/': 'dashboard',
  '/contacts': 'contacts',
  '/accounts': 'accounts',
  '/deals': 'deals',
  '/tasks': 'tasks',
  '/users': 'users',
  '/reports/win-loss': 'win-loss',
  '/admin/automation': 'automation',
  '/admin/settings': 'settings',
};
