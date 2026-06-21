/**
 * Shared navigation link definitions and constants used by all three nav layout components.
 * (MINCRM-133)
 */

import type { SupportedLocale } from '@shared/schemas/settingsSchema.js';
import type { FeatureFlagKey } from '@shared/schemas/featureFlagSchema.js';

/**
 * Native name for each supported locale, displayed in the language selector.
 * Using the language's own script avoids depending on the active translation
 * and ensures users can always identify their language regardless of the current UI language.
 */
export const LOCALE_NATIVE_NAME: Record<SupportedLocale, string> = {
  en: 'English',
  'zh-Hans': '中文（简体）',
  es: 'Español',
  fr: 'Français',
  de: 'Deutsch',
};

export interface NavLinkDef {
  /** Route path */
  to: string;
  /** i18n translation key (relative to the 'nav' namespace) */
  labelKey: string;
  /** Whether the link is only visible to admin users */
  adminOnly: boolean;
  /** Whether NavLink should use exact matching (`end` prop) */
  end?: boolean;
  /**
   * i18n key for a section group label rendered immediately before this item.
   * The divider + label are only shown when the item is visible (admin check already applied).
   */
  sectionLabelKey?: string;
  /** When set, this link is hidden if the feature flag is disabled for the current user. */
  featureFlag?: FeatureFlagKey;
}

/** Ordered list of navigation destinations for all layout components. */
export const NAV_LINKS: NavLinkDef[] = [
  { to: '/', labelKey: 'nav.dashboard', adminOnly: false, end: true },
  { to: '/contacts', labelKey: 'nav.contacts', adminOnly: false },
  { to: '/leads', labelKey: 'nav.leads', adminOnly: false },
  { to: '/accounts', labelKey: 'nav.accounts', adminOnly: false },
  { to: '/deals', labelKey: 'nav.deals', adminOnly: false },
  { to: '/tasks', labelKey: 'nav.myTasks', adminOnly: false },
  { to: '/reports', labelKey: 'nav.reports', adminOnly: false, featureFlag: 'reporting' },
  {
    to: '/users',
    labelKey: 'nav.users',
    adminOnly: true,
    sectionLabelKey: 'nav.administrationSection',
  },
  {
    to: '/admin/automation',
    labelKey: 'nav.automation',
    adminOnly: true,
    featureFlag: 'automation_rules',
  },
  { to: '/admin/sequences', labelKey: 'nav.sequences', adminOnly: true, featureFlag: 'sequencing' },
  { to: '/admin/settings', labelKey: 'nav.adminSettings', adminOnly: true },
];

/**
 * Maps a route `to` path to its destination name for data-testid generation.
 * e.g. '/' → 'dashboard', '/contacts' → 'contacts'
 */
export const DESTINATION_NAME: Record<string, string> = {
  '/': 'dashboard',
  '/contacts': 'contacts',
  '/leads': 'leads',
  '/accounts': 'accounts',
  '/deals': 'deals',
  '/tasks': 'tasks',
  '/activities': 'activities',
  '/users': 'users',
  '/reports': 'reports',
  '/admin/automation': 'automation',
  '/admin/sequences': 'sequences',
  '/admin/settings': 'settings',
};
