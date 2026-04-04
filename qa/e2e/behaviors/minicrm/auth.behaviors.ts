/**
 * Auth behaviors for MiniCRM.
 *
 * Behaviors are named, reusable async functions that encapsulate multi-step
 * user journeys. They compose Page Objects internally — callers never touch
 * raw locators or Page Object methods directly.
 *
 * Behaviors do NOT contain assertions (no expect() calls). They return typed
 * result objects that test specs assert against.
 *
 * MINCRM-130
 */

import type { Page } from '@playwright/test';
import type { HealPage } from '@framework/fixtures/heal-page.fixture.js';
import { LoginPage } from '@pages/minicrm/LoginPage.js';

// ---------------------------------------------------------------------------
// Fixture context
// ---------------------------------------------------------------------------

/** Fixtures required by auth behaviors. */
export interface AuthBehaviorContext {
  page: Page;
  healPage: HealPage;
}

// ---------------------------------------------------------------------------
// login()
// ---------------------------------------------------------------------------

/** Credentials accepted by the login behavior. */
export interface LoginCredentials {
  /** User email address. */
  email: string;
  /** User password. */
  password: string;
}

/** Result returned by the login behavior. */
export interface LoginResult {
  /**
   * True when login succeeded (the page navigated away from the login route).
   * False when the login form returned an error.
   */
  success: boolean;
  /**
   * The URL the browser settled on after the login attempt.
   * On success this is the post-login destination (e.g. `/`).
   * On failure this is still the login URL.
   */
  finalUrl: string;
  /**
   * The error message text shown by the form, or null when login succeeded.
   */
  errorMessage: string | null;
}

/**
 * Navigates to the login page, submits the given credentials, and waits for
 * the page to settle.
 *
 * Returns a LoginResult describing the outcome. The caller (test spec) is
 * responsible for all assertions on the result.
 *
 * @param credentials - Email and password to submit.
 * @param context - Playwright fixture context.
 * @returns LoginResult describing the outcome of the login attempt.
 *
 * @example
 * ```ts
 * const result = await login({ email: 'admin@example.com', password: 'secret' }, { page, healPage });
 * expect(result.success).toBe(true);
 * ```
 */
export async function login(
  credentials: LoginCredentials,
  context: AuthBehaviorContext,
): Promise<LoginResult> {
  const loginPage = new LoginPage(context);

  await loginPage.navigate();
  await loginPage.fillEmail(credentials.email);
  await loginPage.fillPassword(credentials.password);
  await loginPage.submit();

  // Wait for either navigation away from login or an error alert to appear.
  await context.page.waitForLoadState('networkidle');

  const finalUrl = context.page.url();
  const errorMessage = await loginPage.errorMessage();

  // Determine success by checking whether the page has navigated away from
  // the login route. The login page is served at the root path.
  const loginUrl = new URL(finalUrl);
  const isStillOnLogin = loginUrl.pathname === '/' && errorMessage !== null;
  const success = !isStillOnLogin;

  return { success, finalUrl, errorMessage };
}
