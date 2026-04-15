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
 * MINCRM-110
 */

import type { SafePage } from '@framework/fixtures/index.js';
import type { HealPage } from '@framework/fixtures/heal-page.fixture.js';
import { UsersPage } from '@pages/minicrm/UsersPage.js';

// ---------------------------------------------------------------------------
// Fixture context
// ---------------------------------------------------------------------------

/** Fixtures required by user management behaviors. */
export interface UsersBehaviorContext {
  page: SafePage;
  healPage: HealPage;
  testName: string;
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
 * const result = await inviteUserViaUI('Jane', 'jane@example.com', 'rep', { page, healPage, testName });
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
 * const result = await userIsVisibleInList(user.id, { page, healPage, testName });
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
