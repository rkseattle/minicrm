/**
 * Barrel export for MiniCRM behaviors.
 *
 * Import from here rather than individual files so that reorganizing
 * behavior files internally does not break callers.
 *
 * MINCRM-130, MINCRM-110, MINCRM-357
 */

export {
  login,
  logout,
  changePassword,
  navigateToProtectedPage,
  setPassword,
  loginAsAdmin,
  loginAs,
  getCurrentUser,
  logoutViaApi,
  forgotPassword,
  getDevResetToken,
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
  CurrentUser,
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
  contactRowIsVisible,
  openContactCreateForm,
  fillContactCreateForm,
  submitContactCreateFormAndWaitForValidation,
  submitContactCreateForm,
  sortContactsByName,
  bulkReassignContacts,
  bulkDeleteContacts,
  getContactById,
  searchContactsViaApi,
  getContactDeals,
  patchContactAccount,
  deleteContact,
  patchContact,
  listContactsViaApi,
  createContactViaApi,
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
  ContactRowIsVisibleResult,
  PartialContactUIFields,
  SubmitContactFormValidationResult,
  SortContactsByNameResult,
  ContactRow,
  ContactListRow,
} from './contacts.behaviors.js';

export {
  navigateToAccounts,
  editAccount,
  createAccountViaUI,
  deleteAccountViaUI,
  cancelDeleteAccount,
  cancelAccountEdit,
  searchAccounts,
  getAccountById,
  searchAccountsViaApi,
  listAccountsViaApi,
  deleteAccount,
  createAccountViaApi,
  patchAccount,
} from './accounts.behaviors.js';
export type {
  AccountsBehaviorContext,
  NavigateToAccountsResult,
  AccountChanges,
  EditAccountResult,
  CreateAccountUIFields,
  CreateAccountViaUIResult,
  DeleteAccountViaUIResult,
  CancelDeleteAccountResult,
  CancelAccountEditResult,
  SearchAccountsResult,
  AccountRow,
  AccountListRow,
} from './accounts.behaviors.js';

export {
  openDeal,
  advanceDealStage,
  closeDealAsWon,
  dragDealToStage,
  getDealById,
  getDealsByAccount,
  linkContactToDeal,
  patchDealStage,
  patchDeal,
  deleteDeal,
  createDealViaApi,
  listDealsViaApi,
  exportDealsAsCsv,
} from './deals.behaviors.js';
export type {
  DealsBehaviorContext,
  OpenDealResult,
  AdvanceDealStageResult,
  CloseDealAsWonResult,
  DragDealToStageResult,
  DealRow,
  DealListRow,
} from './deals.behaviors.js';

export {
  navigateToMyTasks,
  taskIsVisible,
  completeTask,
  showCompletedTasks,
} from './tasks.behaviors.js';
export type {
  TasksBehaviorContext,
  NavigateToMyTasksResult,
  TaskIsVisibleResult,
  CompleteTaskResult,
} from './tasks.behaviors.js';

export {
  navigateToUsers,
  inviteUserViaUI,
  userIsVisibleInList,
  findUserById,
  inviteUserViaApi,
  setUserPassword,
  adminSetUserPassword,
  deactivateUser,
  reactivateUser,
  changeUserRole,
} from './users.behaviors.js';
export type {
  UsersBehaviorContext,
  NavigateToUsersResult,
  InviteUserViaUIResult,
  UserIsVisibleInListResult,
  UserRow,
  InviteUserResponse,
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
  getLeadById,
  createLeadViaApi,
  convertLeadViaApi,
  getLeads,
  disqualifyLead,
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
  LeadRow,
  LeadListRow,
  LeadConversionResult,
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
  globalSearchViaApi,
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
  GlobalSearchResult,
} from './search.behaviors.js';

export {
  navigateToAdminTags,
  renameTagViaUI,
  deleteTagViaUI,
  attachTagViaUI,
  detachTagViaUI,
  getTagById,
  getContactTags,
  attachTagToContact,
  getDealTags,
} from './tags.behaviors.js';
export type {
  TagsBehaviorContext,
  NavigateToAdminTagsResult,
  RenameTagViaUIResult,
  DeleteTagViaUIResult,
  AttachTagViaUIResult,
  DetachTagViaUIResult,
  TagRow,
  ContactTagRow,
  DealTagRow,
} from './tags.behaviors.js';

export { filterAuditLog, getAuditLog } from './audit-log.behaviors.js';
export type {
  AuditLogBehaviorContext,
  FilterAuditLogResult,
  AuditLogEntry,
} from './audit-log.behaviors.js';

export {
  createNoteViaUI,
  editNoteViaUI,
  deleteNoteViaUI,
  noteCardIsVisible,
  maskedNoteCardIsVisible,
  createNoteViaApi,
  getNoteById,
  listNotes,
  patchNote,
  deleteNote,
  getRecordAuditLog,
} from './notes.behaviors.js';
export type {
  NotesBehaviorContext,
  CreateNoteInput,
  CreateNoteResult,
  EditNoteInput,
  EditNoteResult,
  DeleteNoteResult,
  NoteRow,
  NoteListRow,
  CreateNoteParams,
} from './notes.behaviors.js';

export {
  navigateToProfile,
  getProfilePreferences,
  uncheckAndSavePreference,
  uncheckAllAndSave,
  reloadAndGetProfilePreferences,
  navigateToAdminSettings,
  toggleAdminEmailNotifications,
  patchNotificationPreferences,
  getEmailNotificationsEnabled,
  setEmailNotificationsEnabled,
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
  NotificationPreferences,
} from './notifications.behaviors.js';

export { simulateConcurrentEdit, assertConflictModal } from './concurrency.behaviors.js';
export type {
  ConcurrentEditEntityType,
  SimulateConcurrentEditResult,
  AssertConflictModalResult,
} from './concurrency.behaviors.js';

export {
  getActivityById,
  getActivities,
  getMyTasks,
  createActivityViaApi,
  patchActivity,
} from './activities.behaviors.js';
export type { ActivityRow, ActivityListRow, CreateActivityParams } from './activities.behaviors.js';

export {
  createWebhookSubscription,
  listWebhookSubscriptions,
  getWebhookDeliveryLogs,
  pollForWebhookDelivery,
  createAutomationRule,
  getCustomFieldDefinitions,
  createCustomFieldDefinition,
  setContactCustomFields,
  setCurrencySettings,
  setUserLanguage,
  setSystemDefaultLanguage,
  setNavLayout,
  setOnboardingCompleted,
  getOnboardingStatus,
} from './setup.behaviors.js';

export { ensureSystemDefaults } from './settings.behaviors.js';
export type {
  WebhookSubscription,
  WebhookCreateResult,
  WebhookDeliveryLog,
  AutomationRule,
  CreateAutomationRuleParams,
  CustomFieldDefinition,
  CreateCustomFieldDefinitionParams,
  CurrencySettings,
} from './setup.behaviors.js';

export {
  listAttachments,
  deleteAttachment,
  getAttachmentDownloadStatus,
} from './attachments.behaviors.js';
export type { AttachmentRow } from './attachments.behaviors.js';

export { getWinLossReport } from './reports.behaviors.js';
export type { WinLossReport } from './reports.behaviors.js';
