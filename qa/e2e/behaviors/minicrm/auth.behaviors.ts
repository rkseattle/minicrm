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
 * MINCRM-130, MINCRM-110, MINCRM-137
 */

import type { Page } from '@playwright/test';
import type { HealPage } from '@framework/fixtures/heal-page.fixture.js';
import { LoginPage } from '@pages/minicrm/LoginPage.js';
import { ChangePasswordPage } from '@pages/minicrm/ChangePasswordPage.js';
import { t } from '@framework/i18n/locale.js';

// ---------------------------------------------------------------------------
// Fixture context
// ---------------------------------------------------------------------------

/** Fixtures required by auth behaviors. */
export interface AuthBehaviorContext {
  page: Page;
  healPage: HealPage;
  /** Current test name forwarded to Page Object constructors for heal audit records. */
  testName: string;
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
 * const result = await login({ email: 'admin@example.com', password: 'secret' }, { page, healPage, testName: 'my test' });
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

  // Wait for either navigation away from the login route or the error alert
  // to become visible. Using Promise.race here avoids the networkidle race
  // condition where the alert can still be pending a React state update when
  // networkidle fires (the 401 response completes before the DOM updates).
  const LOGIN_TIMEOUT_MS = 10_000;
  await Promise.race([
    context.page
      .waitForURL((url) => new URL(url).pathname !== '/login', { timeout: LOGIN_TIMEOUT_MS })
      .catch(() => null),
    context.page
      .getByRole('alert')
      .waitFor({ state: 'visible', timeout: LOGIN_TIMEOUT_MS })
      .catch(() => null),
  ]);

  const finalUrl = context.page.url();
  const errorMessage = await loginPage.errorMessage();

  // Determine success by checking whether the page has navigated away from
  // the login route. The login page is served at /login.
  const loginPathname = new URL(finalUrl).pathname;
  const success = loginPathname !== '/login';

  return { success, finalUrl, errorMessage };
}

// ---------------------------------------------------------------------------
// logout()
// ---------------------------------------------------------------------------

/** Result returned by the logout behavior. */
export interface LogoutResult {
  /**
   * True when logout succeeded (browser landed back on the login route).
   */
  success: boolean;
  /**
   * The URL the browser settled on after the logout attempt.
   */
  finalUrl: string;
}

/**
 * Clicks the logout control and waits for the browser to return to the login
 * route (application root `/`).
 *
 * The logout trigger is located by testId first, with a role-based fallback.
 * Returns a result object — the caller (test spec) is responsible for assertions.
 *
 * @param context - Playwright fixture context.
 * @returns LogoutResult describing the outcome.
 *
 * @example
 * ```ts
 * const result = await logout({ page, healPage, testName: 'my test' });
 * expect(result.success).toBe(true);
 * ```
 */
export async function logout(context: AuthBehaviorContext): Promise<LogoutResult> {
  const LOGOUT_TIMEOUT_MS = 10_000;

  // On mobile viewports the desktop nav-logout button is hidden (hidden lg:inline-flex).
  // Open the hamburger drawer first, then click the mobile logout button.
  const desktopLogout = context.page.getByTestId('nav-logout');
  const isDesktopVisible = await desktopLogout.isVisible().catch(() => false);

  if (!isDesktopVisible) {
    // Mobile: open drawer → click mobile logout button.
    await context.page.getByTestId('nav-menu-toggle').click();
    await context.page.getByTestId('nav-logout-mobile').click();
  } else {
    await context.healPage.click([
      { type: 'testId', value: 'nav-logout' },
      { type: 'role', value: 'button', options: { name: t('nav.logout'), exact: false } },
    ]);
  }

  await context.page
    .waitForURL((url) => new URL(url).pathname === '/login', { timeout: LOGOUT_TIMEOUT_MS })
    .catch(() => null);

  const finalUrl = context.page.url();
  const success = new URL(finalUrl).pathname === '/login';
  return { success, finalUrl };
}

// ---------------------------------------------------------------------------
// changePassword()
// ---------------------------------------------------------------------------

/** Credentials accepted by the changePassword behavior. */
export interface ChangePasswordCredentials {
  /** The user's current (old) password. */
  currentPassword: string;
  /** The desired new password. */
  newPassword: string;
  /** Must match newPassword — the form has a confirmation field. */
  confirmPassword: string;
}

/** Result returned by the changePassword behavior. */
export interface ChangePasswordResult {
  /**
   * True when the password change succeeded (the page navigated away from
   * /change-password). False when the form returned an error.
   */
  success: boolean;
  /**
   * The URL the browser settled on after the attempt.
   * On success this is the post-change destination (e.g. `/`).
   * On failure this is still /change-password.
   */
  finalUrl: string;
  /**
   * The error message text shown by the form, or null when the change succeeded.
   */
  errorMessage: string | null;
}

/**
 * Navigates to /change-password, fills all three fields, submits, and waits
 * for the page to settle (navigation away or an alert becoming visible).
 *
 * Returns a ChangePasswordResult. The caller (test spec) is responsible for
 * all assertions on the result.
 *
 * @param credentials - Current password, new password, and confirmation.
 * @param context - Playwright fixture context.
 * @returns ChangePasswordResult describing the outcome.
 *
 * @example
 * ```ts
 * const result = await changePassword(
 *   { currentPassword: 'OldPass1!', newPassword: 'NewPass2!', confirmPassword: 'NewPass2!' },
 *   { page, healPage, testName },
 * );
 * expect(result.success).toBe(true);
 * ```
 */
export async function changePassword(
  credentials: ChangePasswordCredentials,
  context: AuthBehaviorContext,
): Promise<ChangePasswordResult> {
  const changePasswordPage = new ChangePasswordPage(context);

  await changePasswordPage.navigate();
  await changePasswordPage.fillCurrentPassword(credentials.currentPassword);
  await changePasswordPage.fillNewPassword(credentials.newPassword);
  await changePasswordPage.fillConfirmPassword(credentials.confirmPassword);
  await changePasswordPage.submit();

  const CHANGE_PASSWORD_TIMEOUT_MS = 10_000;
  await Promise.race([
    context.page
      .waitForURL((url) => new URL(url).pathname !== '/change-password', {
        timeout: CHANGE_PASSWORD_TIMEOUT_MS,
      })
      .catch(() => null),
    context.page
      .getByRole('alert')
      .waitFor({ state: 'visible', timeout: CHANGE_PASSWORD_TIMEOUT_MS })
      .catch(() => null),
  ]);

  const finalUrl = context.page.url();
  const errorMessage = await changePasswordPage.errorMessage();
  const success = new URL(finalUrl).pathname !== '/change-password';

  return { success, finalUrl, errorMessage };
}

// ---------------------------------------------------------------------------
// navigateToProtectedPage()
// ---------------------------------------------------------------------------

/** Result returned by navigateToProtectedPage. */
export interface NavigateToProtectedPageResult {
  /**
   * The URL the browser settled on after navigating directly to the protected path.
   * Will be the login URL if the user was not authenticated.
   */
  finalUrl: string;
  /**
   * True when the browser was redirected to /login (i.e. unauthenticated redirect occurred).
   */
  redirectedToLogin: boolean;
}

/**
 * Navigates directly to a protected application path and waits for the page
 * to settle. Returns where the browser ended up.
 *
 * Used to verify that an unauthenticated (or session-cleared) browser is
 * redirected to the login page rather than rendering the protected content.
 *
 * @param path - Absolute path to navigate to (e.g. '/contacts').
 * @param context - Playwright fixture context.
 * @returns NavigateToProtectedPageResult.
 *
 * @example
 * ```ts
 * await page.context().clearCookies();
 * const result = await navigateToProtectedPage('/contacts', { page, healPage, testName });
 * expect(result.redirectedToLogin).toBe(true);
 * ```
 */
export async function navigateToProtectedPage(
  path: string,
  context: AuthBehaviorContext,
): Promise<NavigateToProtectedPageResult> {
  const NAVIGATE_TIMEOUT_MS = 10_000;

  await context.page.goto(path);

  // Wait for the URL to stabilise — the React Router redirect is synchronous
  // but the page navigation event is async.
  await context.page
    .waitForURL(
      (url) => {
        const pathname = new URL(url).pathname;
        // Settle when we land on /login or when the path itself is reached
        // (authenticated case).
        return pathname === '/login' || pathname === path;
      },
      { timeout: NAVIGATE_TIMEOUT_MS },
    )
    .catch(() => null);

  const finalUrl = context.page.url();
  const redirectedToLogin = new URL(finalUrl).pathname === '/login';
  return { finalUrl, redirectedToLogin };
}
