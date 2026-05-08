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

import type { PageFacade } from '@framework/fixtures/index.js';
import { LoginPage } from '@pages/minicrm/LoginPage.js';
import { ChangePasswordPage } from '@pages/minicrm/ChangePasswordPage.js';
import { ForgotPasswordPage } from '@pages/minicrm/ForgotPasswordPage.js';
import { ResetPasswordPage } from '@pages/minicrm/ResetPasswordPage.js';
import { SetPasswordPage } from '@pages/minicrm/SetPasswordPage.js';
import { t } from '@framework/i18n/locale.js';

// ---------------------------------------------------------------------------
// Fixture context
// ---------------------------------------------------------------------------

/** Fixtures required by auth behaviors. */
export interface AuthBehaviorContext {
  page: PageFacade;
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
 * const result = await login({ email: 'admin@example.com', password: 'secret' }, { page });
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
  const loginAlert = await context.page
    .locate([
      { type: 'role', value: 'alert' },
      { type: 'css', value: '[role="alert"]' },
    ])
    .resolve()
    .catch(() => null);
  await Promise.race([
    context.page
      .waitForURL((url) => new URL(url).pathname !== '/login', { timeout: LOGIN_TIMEOUT_MS })
      .catch(() => null),
    loginAlert
      ? loginAlert.waitFor({ state: 'visible', timeout: LOGIN_TIMEOUT_MS }).catch(() => null)
      : Promise.resolve(),
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
 * const result = await logout({ page });
 * expect(result.success).toBe(true);
 * ```
 */
export async function logout(context: AuthBehaviorContext): Promise<LogoutResult> {
  const LOGOUT_TIMEOUT_MS = 10_000;

  // nav-logout is always present in the DOM for all nav layouts.
  // For NavTop on mobile (hidden lg:inline-flex) it is not visible — in that
  // case open the hamburger drawer and click nav-logout-mobile instead.
  // For NavLeft and NavHamburger, nav-logout is always visible.
  const desktopLogout = await context.page
    .locate([
      { type: 'testId', value: 'nav-logout' },
      { type: 'role', value: 'button', options: { name: t('nav.logout'), exact: false } },
    ])
    .resolve();
  const isDesktopVisible = await desktopLogout.isVisible().catch(() => false);

  if (!isDesktopVisible) {
    // NavTop mobile: click the menu toggle to mount the drawer, wait for the
    // drawer to be visible, then click the mobile logout button inside it.
    await context.page.click([
      { type: 'testId', value: 'nav-menu-toggle' },
      { type: 'role', value: 'button', options: { name: 'Menu', exact: false } },
    ]);
    const drawer = await context.page
      .locate([
        { type: 'testId', value: 'mobile-nav-drawer' },
        { type: 'css', value: '[data-testid="mobile-nav-drawer"]' },
      ])
      .resolve();
    await drawer.waitFor({ state: 'visible', timeout: 5_000 });
    const mobileLogout = await context.page
      .locate([
        { type: 'testId', value: 'nav-logout-mobile' },
        { type: 'css', value: '[data-testid="nav-logout-mobile"]' },
      ])
      .resolve();
    await mobileLogout.click();
  } else {
    await context.page.click([
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
 *   { page },
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
  const changeAlert = await context.page
    .locate([
      { type: 'role', value: 'alert' },
      { type: 'css', value: '[role="alert"]' },
    ])
    .resolve()
    .catch(() => null);
  await Promise.race([
    context.page
      .waitForURL((url) => new URL(url).pathname !== '/change-password', {
        timeout: CHANGE_PASSWORD_TIMEOUT_MS,
      })
      .catch(() => null),
    changeAlert
      ? changeAlert
          .waitFor({ state: 'visible', timeout: CHANGE_PASSWORD_TIMEOUT_MS })
          .catch(() => null)
      : Promise.resolve(),
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
 * const result = await navigateToProtectedPage('/contacts', { page });
 * expect(result.redirectedToLogin).toBe(true);
 * ```
 */
export async function navigateToProtectedPage(
  path: string,
  context: AuthBehaviorContext,
): Promise<NavigateToProtectedPageResult> {
  const NAVIGATE_TIMEOUT_MS = 15_000;

  // Wait for the network to go idle after navigation so the SPA's initial
  // render and the auth API call (/api/auth/me) have both completed before
  // we inspect the URL. Without this, waitForURL below can resolve while the
  // browser is still on `path` (the SPA mounted but hasn't yet received the
  // 401 from the auth check and re-rendered with <Navigate to="/login" />).
  await context.page.goto(path, { waitUntil: 'networkidle' });

  // After networkidle the auth check has returned. If the user is
  // unauthenticated, ProtectedRoute will have already dispatched the React
  // Router redirect. Give it a moment to propagate through the render cycle.
  await context.page
    .waitForURL((url) => new URL(url).pathname === '/login', { timeout: NAVIGATE_TIMEOUT_MS })
    .catch(() => null);

  const finalUrl = context.page.url();
  const redirectedToLogin = new URL(finalUrl).pathname === '/login';
  return { finalUrl, redirectedToLogin };
}

// ---------------------------------------------------------------------------
// requestPasswordReset()
// ---------------------------------------------------------------------------

/** Result returned by the requestPasswordReset behavior. */
export interface RequestPasswordResetResult {
  /** True when the success message became visible after submission. */
  success: boolean;
  /** The URL the browser settled on after the attempt. */
  finalUrl: string;
}

/**
 * Navigates to the forgot-password page, enters an email address, submits,
 * and waits for the success message to appear.
 *
 * Returns a result object — the caller is responsible for assertions.
 *
 * @param email - Email address to submit.
 * @param context - Playwright fixture context.
 * @returns RequestPasswordResetResult.
 */
export async function requestPasswordReset(
  email: string,
  context: AuthBehaviorContext,
): Promise<RequestPasswordResetResult> {
  const forgotPasswordPage = new ForgotPasswordPage(context);

  await forgotPasswordPage.navigate();
  await forgotPasswordPage.fillEmail(email);
  await forgotPasswordPage.submit();

  const TIMEOUT_MS = 10_000;
  const successEl = await context.page
    .locate([
      { type: 'testId', value: 'forgot-password-success' },
      { type: 'css', value: '[data-testid="forgot-password-success"]' },
    ])
    .resolve()
    .catch(() => null);
  if (successEl) {
    await successEl.waitFor({ state: 'visible', timeout: TIMEOUT_MS }).catch(() => null);
  }

  const finalUrl = context.page.url();
  const success = await forgotPasswordPage.successMessageVisible();
  return { success, finalUrl };
}

// ---------------------------------------------------------------------------
// resetPassword()
// ---------------------------------------------------------------------------

/** Result returned by the resetPassword behavior. */
export interface ResetPasswordResult {
  /** True when the reset succeeded (the page navigated away from /reset-password). */
  success: boolean;
  /** The URL the browser settled on after the attempt. */
  finalUrl: string;
  /** The error message text shown by the form, or null when reset succeeded. */
  errorMessage: string | null;
}

/**
 * Navigates to /reset-password with the given token, fills new + confirm
 * password fields, submits, and waits for the page to settle.
 *
 * Returns a result object — the caller is responsible for assertions.
 *
 * @param token - The plaintext reset token from the email link.
 * @param newPassword - The desired new password.
 * @param confirmPassword - Must match newPassword.
 * @param context - Playwright fixture context.
 * @returns ResetPasswordResult.
 */
export async function resetPassword(
  token: string,
  newPassword: string,
  confirmPassword: string,
  context: AuthBehaviorContext,
): Promise<ResetPasswordResult> {
  const resetPage = new ResetPasswordPage(context);

  await resetPage.navigate(token);
  await resetPage.fillNewPassword(newPassword);
  await resetPage.fillConfirmPassword(confirmPassword);
  await resetPage.submit();

  const TIMEOUT_MS = 10_000;
  const resetError = await context.page
    .locate([
      { type: 'testId', value: 'reset-password-error' },
      { type: 'css', value: '[data-testid="reset-password-error"]' },
    ])
    .resolve()
    .catch(() => null);
  await Promise.race([
    context.page
      .waitForURL((url) => new URL(url).pathname !== '/reset-password', { timeout: TIMEOUT_MS })
      .catch(() => null),
    resetError
      ? resetError.waitFor({ state: 'visible', timeout: TIMEOUT_MS }).catch(() => null)
      : Promise.resolve(),
  ]);

  const finalUrl = context.page.url();
  const errorMessage = await resetPage.errorMessage();
  const success = new URL(finalUrl).pathname !== '/reset-password';
  return { success, finalUrl, errorMessage };
}

// ---------------------------------------------------------------------------
// setPassword()
// ---------------------------------------------------------------------------

/** Result returned by the setPassword behavior. */
export interface SetPasswordResult {
  /** True when the set-password succeeded (the page navigated away from /set-password). */
  success: boolean;
  /** The URL the browser settled on after the attempt. */
  finalUrl: string;
  /** The error message text shown by the form, or null when succeeded. */
  errorMessage: string | null;
}

/**
 * Navigates to /set-password with the given invite token, fills the password
 * and confirm fields, submits, and waits for the page to settle.
 *
 * Returns a result object — the caller is responsible for assertions.
 *
 * @param token - The plaintext invite token from the email link.
 * @param newPassword - The desired password.
 * @param confirmPassword - Must match newPassword.
 * @param context - Playwright fixture context.
 * @returns SetPasswordResult.
 */
export async function setPassword(
  token: string,
  newPassword: string,
  confirmPassword: string,
  context: AuthBehaviorContext,
): Promise<SetPasswordResult> {
  const setPasswordPage = new SetPasswordPage(context);

  await setPasswordPage.navigate(token);
  await setPasswordPage.fillNewPassword(newPassword);
  await setPasswordPage.fillConfirmPassword(confirmPassword);
  await setPasswordPage.submit();

  const TIMEOUT_MS = 10_000;
  const setPasswordError = await context.page
    .locate([
      { type: 'testId', value: 'set-password-error' },
      { type: 'css', value: '[data-testid="set-password-error"]' },
    ])
    .resolve()
    .catch(() => null);
  await Promise.race([
    context.page
      .waitForURL((url) => new URL(url).pathname !== '/set-password', { timeout: TIMEOUT_MS })
      .catch(() => null),
    setPasswordError
      ? setPasswordError.waitFor({ state: 'visible', timeout: TIMEOUT_MS }).catch(() => null)
      : Promise.resolve(),
  ]);

  const finalUrl = context.page.url();
  const errorMessage = await setPasswordPage.errorMessage();
  const success = new URL(finalUrl).pathname !== '/set-password';
  return { success, finalUrl, errorMessage };
}
