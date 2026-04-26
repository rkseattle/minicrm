/**
 * Barrel export for MiniCRM behaviors.
 *
 * Import from here rather than individual files so that reorganizing
 * behavior files internally does not break callers.
 *
 * MINCRM-130, MINCRM-110
 */

export {
  login,
  logout,
  changePassword,
  navigateToProtectedPage,
  setPassword,
} from './auth.behaviors.js';
export type {
  AuthBehaviorContext,
  LoginCredentials,
  LoginResult,
  LogoutResult,
  ChangePasswordCredentials,
  ChangePasswordResult,
  NavigateToProtectedPageResult,
  SetPasswordResult,
} from './auth.behaviors.js';

export {
  navigateToContacts,
  waitForContactInList,
  waitForBulkCheckbox,
  clickBulkCheckbox,
  filterContactsByTerm,
  editContact,
  createContactViaUI,
  deleteContactViaUI,
  cancelDeleteContact,
  cancelContactEdit,
  searchContacts,
} from './contacts.behaviors.js';
export type {
  ContactsBehaviorContext,
  NavigateToContactsResult,
  ContactChanges,
  EditContactResult,
  CreateContactUIFields,
  CreateContactViaUIResult,
  DeleteContactViaUIResult,
  CancelDeleteContactResult,
  CancelContactEditResult,
  SearchContactsResult,
} from './contacts.behaviors.js';

export { openDeal, advanceDealStage, closeDealAsWon } from './deals.behaviors.js';
export type {
  DealsBehaviorContext,
  OpenDealResult,
  AdvanceDealStageResult,
  CloseDealAsWonResult,
} from './deals.behaviors.js';

export { navigateToMyTasks, taskIsVisible, completeTask } from './tasks.behaviors.js';
export type {
  TasksBehaviorContext,
  NavigateToMyTasksResult,
  TaskIsVisibleResult,
  CompleteTaskResult,
} from './tasks.behaviors.js';

export { navigateToUsers, inviteUserViaUI, userIsVisibleInList } from './users.behaviors.js';
export type {
  UsersBehaviorContext,
  NavigateToUsersResult,
  InviteUserViaUIResult,
  UserIsVisibleInListResult,
} from './users.behaviors.js';

export {
  navigateToLeads,
  createLeadViaUI,
  createLeadViaUIThenCreateAnyway,
  updateLeadStatus,
  showDisqualifiedLeads,
  showConvertedLeads,
  convertLead,
  deleteLead,
  leadRowIsHidden,
} from './leads.behaviors.js';
export type {
  LeadsBehaviorContext,
  NavigateToLeadsResult,
  CreateLeadUIFields,
  CreateLeadViaUIResult,
  CreateLeadViaUIThenCreateAnywayResult,
  UpdateLeadStatusResult,
  ShowDisqualifiedLeadsResult,
  ShowConvertedLeadsResult,
  ConvertLeadResult,
  DeleteLeadResult,
  LeadRowIsHiddenResult,
} from './leads.behaviors.js';

export {
  typeSearchQuery,
  typeSearchQueryRaw,
  getSearchResult,
  clickSearchResult,
  getSearchEmptyState,
  getMinLengthHint,
  checkNoResultsForQuery,
  typeSearchQueryAndCheckPanel,
  clearSearchQuery,
} from './search.behaviors.js';
export type {
  SearchBehaviorContext,
  TypeSearchQueryResult,
  GetSearchResultResult,
  ClickSearchResultResult,
  GetSearchEmptyStateResult,
  GetMinLengthHintResult,
  CheckNoResultsForQueryResult,
  TypeSearchQueryAndCheckPanelResult,
} from './search.behaviors.js';

export {
  navigateToAdminTags,
  renameTagViaUI,
  deleteTagViaUI,
  attachTagViaUI,
  detachTagViaUI,
} from './tags.behaviors.js';
export type {
  TagsBehaviorContext,
  NavigateToAdminTagsResult,
  RenameTagViaUIResult,
  DeleteTagViaUIResult,
  AttachTagViaUIResult,
  DetachTagViaUIResult,
} from './tags.behaviors.js';

export {
  navigateToProfile,
  getProfilePreferences,
  uncheckAndSavePreference,
  uncheckAllAndSave,
  reloadAndGetProfilePreferences,
  navigateToAdminSettings,
  toggleAdminEmailNotifications,
} from './notifications.behaviors.js';
export type {
  NotificationsBehaviorContext,
  ProfilePreferences,
  NavigateToProfileResult,
  GetProfilePreferencesResult,
  ToggleAndSavePreferenceResult,
  UncheckAllAndSaveResult,
  NavigateToAdminSettingsResult,
  ToggleAdminEmailNotificationsResult,
} from './notifications.behaviors.js';
