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

export { ForgotPasswordPage } from './ForgotPasswordPage.js';
export type { ForgotPasswordPageContext } from './ForgotPasswordPage.js';

export { ResetPasswordPage } from './ResetPasswordPage.js';
export type { ResetPasswordPageContext } from './ResetPasswordPage.js';

export { LeadsPage } from './LeadsPage.js';
export type { LeadsPageContext } from './LeadsPage.js';

export { LeadDetailPage } from './LeadDetailPage.js';
export type { LeadDetailPageContext } from './LeadDetailPage.js';

export { GlobalSearchPage } from './GlobalSearchPage.js';
export type { GlobalSearchPageContext } from './GlobalSearchPage.js';

export { ProfilePage } from './ProfilePage.js';
export type { ProfilePageContext } from './ProfilePage.js';
export type { NotificationPreferenceKey } from './ProfilePage.js';

export { AdminSettingsPage } from './AdminSettingsPage.js';
export type { AdminSettingsPageContext } from './AdminSettingsPage.js';

export { AdminTagsPage } from './AdminTagsPage.js';
export type { AdminTagsPageContext } from './AdminTagsPage.js';

export { TagInputWidget } from './TagInputWidget.js';
export type { TagInputWidgetContext } from './TagInputWidget.js';
