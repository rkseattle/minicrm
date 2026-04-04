/**
 * Barrel export for MiniCRM Page Objects.
 *
 * Import from here rather than individual files so that reorganizing
 * Page Objects internally does not break callers.
 *
 * MINCRM-130
 */

export { LoginPage } from './LoginPage.js';
export type { LoginPageContext } from './LoginPage.js';

export { ContactsPage } from './ContactsPage.js';
export type { ContactsPageContext } from './ContactsPage.js';
