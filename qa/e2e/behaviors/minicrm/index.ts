/**
 * Barrel export for MiniCRM behaviors.
 *
 * Import from here rather than individual files so that reorganizing
 * behavior files internally does not break callers.
 *
 * MINCRM-130, MINCRM-110
 */

export { login, logout, changePassword, navigateToProtectedPage } from './auth.behaviors.js';
export type {
  AuthBehaviorContext,
  LoginCredentials,
  LoginResult,
  LogoutResult,
  ChangePasswordCredentials,
  ChangePasswordResult,
  NavigateToProtectedPageResult,
} from './auth.behaviors.js';

export {
  navigateToContacts,
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
