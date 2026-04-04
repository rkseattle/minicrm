/**
 * Barrel export for MiniCRM behaviors.
 *
 * Import from here rather than individual files so that reorganizing
 * behavior files internally does not break callers.
 *
 * MINCRM-130
 */

export { login } from './auth.behaviors.js';
export type { AuthBehaviorContext, LoginCredentials, LoginResult } from './auth.behaviors.js';

export { navigateToContacts } from './contacts.behaviors.js';
export type { ContactsBehaviorContext, NavigateToContactsResult } from './contacts.behaviors.js';
