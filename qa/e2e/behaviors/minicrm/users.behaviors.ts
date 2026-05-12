/**
 * Users behaviors for MiniCRM.
 *
 * Behaviors are named, reusable async functions that encapsulate multi-step
 * user journeys. They compose Page Objects internally — callers never touch
 * raw locators or Page Object methods directly.
 *
 * Behaviors do NOT contain assertions (no expect() calls). They return typed
 * result objects that test specs assert against.
 *
 * MINCRM-110, MINCRM-357
 */

import type { RestClient } from '@framework/clients/rest-client.js';
import type { PageFacade } from '@framework/fixtures/index.js';
import { UsersPage } from '@pages/minicrm/UsersPage.js';

// ---------------------------------------------------------------------------
// Fixture context
// ---------------------------------------------------------------------------

/** Fixtures required by user management behaviors. */
export interface UsersBehaviorContext {
  page: PageFacade;
}

// ---------------------------------------------------------------------------
// navigateToUsers()
// ---------------------------------------------------------------------------

/** Result returned by navigateToUsers. */
export interface NavigateToUsersResult {
  /** True when the users management page loaded successfully. */
  loaded: boolean;
  /** The URL the browser settled on. */
  finalUrl: string;
}

/**
 * Navigates to the user management page and waits for it to be ready.
 *
 * @param context - Playwright fixture context.
 * @returns NavigateToUsersResult.
 */
export async function navigateToUsers(
  context: UsersBehaviorContext,
): Promise<NavigateToUsersResult> {
  const usersPage = new UsersPage(context);
  await usersPage.navigate();
  const loaded = await usersPage.isLoaded();
  const finalUrl = usersPage.url();
  return { loaded, finalUrl };
}

// ---------------------------------------------------------------------------
// inviteUserViaUI()
// ---------------------------------------------------------------------------

/** Result returned by inviteUserViaUI. */
export interface InviteUserViaUIResult {
  /**
   * True when the users page reloaded after form submission and is still loaded.
   * The caller verifies the invited user appears in the list separately via API.
   */
  submitted: boolean;
}

/**
 * Fills the invite user form on the users management page and submits it.
 *
 * Navigates to the users page if not already there.
 *
 * @param name - Display name for the invited user.
 * @param email - Email address for the invited user.
 * @param role - Role to assign ('admin' | 'rep').
 * @param context - Playwright fixture context.
 * @returns InviteUserViaUIResult.
 *
 * @example
 * ```ts
 * const result = await inviteUserViaUI('Jane', 'jane@example.com', 'rep', { page });
 * expect(result.submitted).toBe(true);
 * ```
 */
export async function inviteUserViaUI(
  name: string,
  email: string,
  role: 'admin' | 'rep',
  context: UsersBehaviorContext,
): Promise<InviteUserViaUIResult> {
  const usersPage = new UsersPage(context);

  if (!context.page.url().includes(UsersPage.PATH)) {
    await usersPage.navigate();
    await usersPage.isLoaded();
  }

  await usersPage.fillInviteForm(name, email, role);
  await usersPage.submitInvite();

  const submitted = await usersPage.isLoaded();
  return { submitted };
}

// ---------------------------------------------------------------------------
// userIsVisibleInList()
// ---------------------------------------------------------------------------

/** Result returned by userIsVisibleInList. */
export interface UserIsVisibleInListResult {
  /** True when the user card/row is visible on the users page. */
  visible: boolean;
}

/**
 * Checks whether a user (by ID) is visible in the user management list.
 *
 * Navigates to the users page if not already there.
 *
 * @param userId - User UUID.
 * @param context - Playwright fixture context.
 * @returns UserIsVisibleInListResult.
 *
 * @example
 * ```ts
 * const result = await userIsVisibleInList(user.id, { page });
 * expect(result.visible).toBe(true);
 * ```
 */
export async function userIsVisibleInList(
  userId: string,
  context: UsersBehaviorContext,
): Promise<UserIsVisibleInListResult> {
  const usersPage = new UsersPage(context);

  if (!context.page.url().includes(UsersPage.PATH)) {
    await usersPage.navigate();
    await usersPage.isLoaded();
  }

  const visible = await usersPage.userCardIsVisible(userId);
  return { visible };
}

// ---------------------------------------------------------------------------
// API data-fetch helpers (MINCRM-357)
// ---------------------------------------------------------------------------

/** Shape of a user row returned by GET /api/v1/users. */
export interface UserRow {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'rep';
  status: 'active' | 'invited' | 'inactive';
  must_change_password: boolean;
}

/** Shape of the invite endpoint response. */
export interface InviteUserResponse {
  user: UserRow;
  inviteToken: string;
}

/**
 * Finds a user by ID in the admin user list, paginating as needed.
 *
 * GET /api/v1/users does not support filtering by ID, so this function
 * iterates through pages (max 100/page) until the user is found.
 *
 * @param restClient - Admin-authenticated RestClient.
 * @param userId - User UUID to look up.
 * @returns The user row, or undefined if not found.
 */
export async function findUserById(
  restClient: RestClient,
  userId: string,
): Promise<UserRow | undefined> {
  let page = 1;
  while (true) {
    const res = await restClient.get<{ data: UserRow[]; total: number; limit: number }>(
      `/api/v1/users?limit=100&page=${page}`,
    );
    const found = res.body.data.find((u) => u.id === userId);
    if (found) return found;
    const { total, limit } = res.body;
    if (page * limit >= total) return undefined;
    page++;
  }
}

/**
 * Invites a new user via the API.
 *
 * @param restClient - Admin-authenticated RestClient.
 * @param params - Invite parameters.
 * @returns The invite response containing the user row and invite token.
 */
export async function inviteUserViaApi(
  restClient: RestClient,
  params: { name: string; email: string; role: 'admin' | 'rep' },
): Promise<InviteUserResponse> {
  const res = await restClient.post<InviteUserResponse>('/api/v1/users/invite', params);
  return res.body;
}

/**
 * Activates an invited account by setting the initial password using the invite token.
 *
 * @param restClient - RestClient (does not need to be authenticated).
 * @param token - Invite token from the invite response.
 * @param password - Password to set.
 */
export async function setUserPassword(
  restClient: RestClient,
  token: string,
  password: string,
): Promise<void> {
  await restClient.post('/api/v1/users/set-password', { token, password });
}

/**
 * Sets a user's password as admin, which forces must_change_password=true.
 *
 * @param restClient - Admin-authenticated RestClient.
 * @param userId - User UUID.
 * @param password - Password to set.
 */
export async function adminSetUserPassword(
  restClient: RestClient,
  userId: string,
  password: string,
): Promise<void> {
  await restClient.post(`/api/v1/users/${userId}/admin-set-password`, { password });
}

/**
 * Deactivates a user via the API.
 *
 * @param restClient - Admin-authenticated RestClient.
 * @param userId - User UUID.
 * @returns The updated user row.
 */
export async function deactivateUser(restClient: RestClient, userId: string): Promise<UserRow> {
  const res = await restClient.patch<{ user: UserRow }>(`/api/v1/users/${userId}/deactivate`);
  return res.body.user;
}

/**
 * Reactivates a user via the API.
 *
 * @param restClient - Admin-authenticated RestClient.
 * @param userId - User UUID.
 * @returns The updated user row.
 */
export async function reactivateUser(restClient: RestClient, userId: string): Promise<UserRow> {
  const res = await restClient.patch<{ user: UserRow }>(`/api/v1/users/${userId}/reactivate`);
  return res.body.user;
}

/**
 * Changes a user's role via the API.
 *
 * @param restClient - Admin-authenticated RestClient.
 * @param userId - User UUID.
 * @param role - New role.
 * @returns The updated user row.
 */
export async function changeUserRole(
  restClient: RestClient,
  userId: string,
  role: 'admin' | 'rep',
): Promise<UserRow> {
  const res = await restClient.patch<{ user: UserRow }>(`/api/v1/users/${userId}/role`, { role });
  return res.body.user;
}
