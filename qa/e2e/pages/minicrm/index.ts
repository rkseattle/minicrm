/**
 * Barrel export for MiniCRM Page Objects.
 *
 * Import from here rather than individual files so that reorganizing
 * Page Objects internally does not break callers.
 *
 * MINCRM-130, MINCRM-110
 */

export { LoginPage } from './LoginPage.js';
export type { LoginPageContext } from './LoginPage.js';

export { ChangePasswordPage } from './ChangePasswordPage.js';
export type { ChangePasswordPageContext } from './ChangePasswordPage.js';

export { ContactsPage } from './ContactsPage.js';
export type { ContactsPageContext } from './ContactsPage.js';

export { ContactDetailPage } from './ContactDetailPage.js';
export type { ContactDetailPageContext } from './ContactDetailPage.js';

export { PipelineBoardPage } from './PipelineBoardPage.js';
export type { PipelineBoardPageContext, PipelineStage } from './PipelineBoardPage.js';

export { MyTasksPage } from './MyTasksPage.js';
export type { MyTasksPageContext } from './MyTasksPage.js';

export { UsersPage } from './UsersPage.js';
export type { UsersPageContext } from './UsersPage.js';
