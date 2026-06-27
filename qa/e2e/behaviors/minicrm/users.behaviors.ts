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
import { loginAs, loginAsAdmin } from './auth.behaviors.js';
import { setOnboardingCompleted } from './setup.behaviors.js';

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
 * @param role - Role to assign.
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
  role: 'admin' | 'rep' | 'viewer' | 'manager' | 'service_account',
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
  role: 'admin' | 'rep' | 'viewer' | 'manager' | 'service_account';
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
  params: {
    name: string;
    email: string;
    role: 'admin' | 'rep' | 'viewer' | 'manager' | 'service_account';
  },
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
 * Retries once on ECONNRESET: in CI, a CPU-heavy bcrypt hash on the same event
 * loop (e.g. from a preceding setPassword call) can stall the server long enough
 * for the keep-alive connection to be reset mid-flight. Deactivation is idempotent
 * (setting status=inactive twice is safe), so a single retry is safe here.
 *
 * @param restClient - Admin-authenticated RestClient.
 * @param userId - User UUID.
 * @returns The updated user row.
 */
export async function deactivateUser(restClient: RestClient, userId: string): Promise<UserRow> {
  const ECONNRESET_RETRY_DELAY_MS = 500;
  try {
    const res = await restClient.patch<{ user: UserRow }>(`/api/v1/users/${userId}/deactivate`);
    return res.body.user;
  } catch (err) {
    if (err instanceof Error && /ECONNRESET/.test(err.message)) {
      await new Promise((resolve) => setTimeout(resolve, ECONNRESET_RETRY_DELAY_MS));
      const res = await restClient.patch<{ user: UserRow }>(`/api/v1/users/${userId}/deactivate`);
      return res.body.user;
    }
    throw err;
  }
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

// ---------------------------------------------------------------------------
// suppressUserOnboarding() (MINCRM-410)
// ---------------------------------------------------------------------------

/**
 * Marks a user's onboarding checklist as completed so the widget does not
 * appear when tests log in as that user.
 *
 * New users start with onboarding_completed=false (migration 058 default) — the
 * widget is the whole point of MINCRM-410. Tests that create ephemeral users and
 * navigate the UI as them must call this after activation to prevent the fixed
 * z-50 overlay from intercepting pointer events on other elements.
 *
 * Logs in as the target user to set the flag, then always re-authenticates as
 * admin — even if the flag write throws — so the caller's restClient is never
 * left in the target user's session.
 *
 * @param restClient - RestClient (will be mutated; is always back in admin context on return).
 * @param email - Email of the activated user.
 * @param password - Password of the activated user.
 */
export async function suppressUserOnboarding(
  restClient: RestClient,
  email: string,
  password: string,
): Promise<void> {
  await loginAs(restClient, email, password);
  try {
    await setOnboardingCompleted(restClient, true);
  } finally {
    await loginAsAdmin(restClient);
  }
}

// ---------------------------------------------------------------------------
// resetOnboardingViaUI() (MINCRM-410)
// ---------------------------------------------------------------------------

/** Result returned by resetOnboardingViaUI. */
export interface ResetOnboardingViaUIResult {
  /** True when the success toast appeared after confirming the reset. */
  successToastVisible: boolean;
}

/**
 * Resets a user's onboarding checklist via the Users page actions menu.
 *
 * Opens the meatball menu for the given user, clicks Reset onboarding,
 * and confirms the dialog. Navigates to the users page if not already there.
 *
 * Note: task completion is based on live record counts, so already-completed
 * tasks will still show as checked after reset. The reset only causes the
 * checklist widget to reappear on the user's next login.
 *
 * @param userId - UUID of the user whose onboarding should be reset.
 * @param context - Playwright fixture context.
 * @returns ResetOnboardingViaUIResult.
 */
export async function resetOnboardingViaUI(
  userId: string,
  context: UsersBehaviorContext,
): Promise<ResetOnboardingViaUIResult> {
  const usersPage = new UsersPage(context);

  if (!context.page.url().includes(UsersPage.PATH)) {
    await usersPage.navigate();
    await usersPage.isLoaded();
  }

  // Paginate through the user list until the target user's card is on screen.
  // isLoaded() only waits for the invite form; the user list is sorted oldest-first
  // so a newly-created ephemeral user may be on a later page of a shared E2E DB.
  await usersPage.navigateToUserCard(userId);

  await usersPage.openActionsMenu(userId);
  await usersPage.clickResetOnboarding(userId);
  await usersPage.resetOnboardingDialogLocator();
  await usersPage.confirmResetOnboarding();

  try {
    await usersPage.resetOnboardingSuccessLocator();
    return { successToastVisible: true };
  } catch {
    return { successToastVisible: false };
  }
}
