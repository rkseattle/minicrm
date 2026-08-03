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
 * MINCRM-130, MINCRM-110, MINCRM-137, MINCRM-357
 */

import type { PageFacade } from '@framework/fixtures/index.js';
import { gotoAndSettle } from '@apps/minicrm/helpers.js';
import type { RestClient } from '@framework/clients/rest-client.js';
import { LoginPage } from '@pages/minicrm/LoginPage.js';
import { ChangePasswordPage } from '@pages/minicrm/ChangePasswordPage.js';
import { ForgotPasswordPage } from '@pages/minicrm/ForgotPasswordPage.js';
import { ResetPasswordPage } from '@pages/minicrm/ResetPasswordPage.js';
import { SetPasswordPage } from '@pages/minicrm/SetPasswordPage.js';
import { NavPage } from '@pages/minicrm/NavPage.js';
import { ProfilePage } from '@pages/minicrm/ProfilePage.js';

// ---------------------------------------------------------------------------
// Fixture context
// ---------------------------------------------------------------------------

/** Fixtures required by auth behaviors. */
export interface AuthBehaviorContext {
  page: PageFacade;
}

// ---------------------------------------------------------------------------
// loginAsAdmin()
// ---------------------------------------------------------------------------

/**
 * Authenticates the given RestClient as the E2E admin user.
 *
 * Reads credentials from the E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD environment
 * variables. Throws when E2E_ADMIN_PASSWORD is not set so misconfigured
 * environments fail fast rather than producing confusing 401 errors downstream.
 *
 * @param restClient - The RestClient instance to authenticate.
 *
 * @example
 * ```ts
 * test.beforeAll(async ({ restClient }) => {
 *   await loginAsAdmin(restClient);
 * });
 * ```
 */
/**
 * Resolves the shared admin credentials from the environment.
 *
 * @param caller - Function name, used to prefix the error when the password is unset.
 * @returns The admin email and password.
 */
export function resolveAdminCredentials(caller: string): { email: string; password: string } {
  const email = process.env['E2E_ADMIN_EMAIL'] ?? 'admin@example.com';
  const password = process.env['E2E_ADMIN_PASSWORD'];
  if (!password) throw new Error(`[${caller}] E2E_ADMIN_PASSWORD is not set`);
  return { email, password };
}

export async function loginAsAdmin(restClient: RestClient): Promise<void> {
  const { email, password } = resolveAdminCredentials('loginAsAdmin');
  // Retry once on ECONNRESET: in CI a preceding bcrypt hash on the same event
  // loop can stall the server long enough for the keep-alive connection to be
  // reset before the login POST completes. Login is idempotent so a single
  // retry is safe.
  const ECONNRESET_RETRY_DELAY_MS = 500;
  try {
    await restClient.post('/api/v1/auth/login', { email, password });
  } catch (err) {
    if (err instanceof Error && /ECONNRESET/.test(err.message)) {
      await new Promise((r) => setTimeout(r, ECONNRESET_RETRY_DELAY_MS));
      await restClient.post('/api/v1/auth/login', { email, password });
    } else {
      throw err;
    }
  }
}

// ---------------------------------------------------------------------------
// loginAs()
// ---------------------------------------------------------------------------

/**
 * Authenticates the given RestClient with the supplied credentials.
 *
 * Use this when a test needs to authenticate as a specific non-admin user.
 * Returns the HTTP status so callers can assert on expected failures (e.g.
 * deactivated-user login returning 401/403).
 *
 * @param restClient - The RestClient instance to authenticate.
 * @param email - User email address.
 * @param password - User password.
 * @returns The HTTP status code from the login response.
 *
 * @example
 * ```ts
 * const status = await loginAs(repClient, rep.email, repPassword);
 * expect(status).toBe(200);
 * ```
 */
export async function loginAs(
  restClient: RestClient,
  email: string,
  password: string,
): Promise<number> {
  const res = await restClient.post('/api/v1/auth/login', { email, password });
  return res.status;
}

// ---------------------------------------------------------------------------
// getCurrentUser()
// ---------------------------------------------------------------------------

/** The authenticated user returned by GET /api/auth/me. */
export interface CurrentUser {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'rep';
  status: string;
}

/**
 * Fetches the currently authenticated user from GET /api/auth/me.
 *
 * @param restClient - An authenticated RestClient.
 * @returns The current user record.
 */
export async function getCurrentUser(restClient: RestClient): Promise<CurrentUser> {
  const res = await restClient.get<{ user: CurrentUser }>('/api/v1/auth/me');
  return res.body.user;
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
  return loginFromCurrentPage(credentials, context, loginPage);
}

/**
 * Submits login credentials on the currently-displayed login page WITHOUT
 * navigating to /login first. Use this when the test has already navigated to
 * a specific login URL (e.g. /login?reason=session_expired&next=/contacts) and
 * must not lose the query params. (MINCRM-365)
 *
 * @param credentials - Email and password to submit.
 * @param context - Playwright fixture context.
 * @param loginPageInstance - Optional pre-constructed LoginPage (avoids double construction).
 * @returns LoginResult describing the outcome of the login attempt.
 */
export async function loginFromCurrentPage(
  credentials: LoginCredentials,
  context: AuthBehaviorContext,
  loginPageInstance?: LoginPage,
): Promise<LoginResult> {
  const loginPage = loginPageInstance ?? new LoginPage(context);

  await loginPage.fillEmail(credentials.email);
  await loginPage.fillPassword(credentials.password);
  await loginPage.submit();

  // Wait for either navigation away from the login route or the error alert
  // to become visible. Using Promise.race here avoids the networkidle race
  // condition where the alert can still be pending a React state update when
  // networkidle fires (the 401 response completes before the DOM updates).
  const LOGIN_TIMEOUT_MS = 10_000;
  const loginAlert = await loginPage.alertLocator();
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
  const navPage = new NavPage(context);
  const desktopLogout = await navPage.desktopLogoutLocator();
  const isDesktopVisible = (await desktopLogout?.isVisible().catch(() => false)) ?? false;

  if (!isDesktopVisible) {
    // NavTop mobile: click the menu toggle to mount the drawer, wait for the
    // drawer to be visible, then click the mobile logout button inside it.
    await navPage.clickMenuToggle();
    const drawer = await navPage.mobileNavDrawerLocator();
    await drawer?.waitFor({ state: 'visible', timeout: 5_000 });
    await navPage.clickMobileLogout();
  } else {
    await navPage.clickDesktopLogout();
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
  const changeAlert = await changePasswordPage.alertLocator();
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
  await gotoAndSettle(context.page, path);

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
// navigateToPathAndGetFinalPathname()
// ---------------------------------------------------------------------------

/**
 * Navigates directly to an arbitrary application path and returns the
 * pathname the browser settles on — for asserting a route no longer exists
 * (e.g. the client's own catch-all redirects an unknown path elsewhere),
 * distinct from navigateToProtectedPage's narrower "did it redirect to
 * /login" check.
 *
 * Waits for the URL to stop changing rather than for the network to go
 * idle (a networkidle-style wait is banned in spec files by
 * check-networkidle.sh and, per this repo's own project memory, is just as
 * flake-prone when used in a behavior file, since the static check only
 * scans qa/e2e/tests/ specs) — the SPA's client-side redirect is a
 * synchronous React Router navigation with no network round-trip of its
 * own, so waiting on the URL itself is both the more targeted condition
 * and the one actually being asserted on by the caller.
 *
 * @param path - Path to navigate to directly.
 * @param context - Playwright fixture context.
 * @returns The pathname the browser settled on.
 */
export async function navigateToPathAndGetFinalPathname(
  path: string,
  context: AuthBehaviorContext,
): Promise<string> {
  const NAVIGATE_TIMEOUT_MS = 15_000;
  await context.page.goto(path);
  await context.page
    .waitForURL((url) => new URL(url).pathname !== path, { timeout: NAVIGATE_TIMEOUT_MS })
    .catch(() => null);
  return new URL(context.page.url()).pathname;
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
  await forgotPasswordPage.waitForSuccessVisible(TIMEOUT_MS);

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
  await Promise.race([
    context.page
      .waitForURL((url) => new URL(url).pathname !== '/reset-password', { timeout: TIMEOUT_MS })
      .catch(() => null),
    resetPage.waitForErrorVisible(TIMEOUT_MS),
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
  await Promise.race([
    context.page
      .waitForURL((url) => new URL(url).pathname !== '/set-password', { timeout: TIMEOUT_MS })
      .catch(() => null),
    setPasswordPage.waitForErrorVisible(TIMEOUT_MS),
  ]);

  const finalUrl = context.page.url();
  const errorMessage = await setPasswordPage.errorMessage();
  const success = new URL(finalUrl).pathname !== '/set-password';
  return { success, finalUrl, errorMessage };
}

// ---------------------------------------------------------------------------
// sessionExpiredBannerVisible() (MINCRM-365)
// ---------------------------------------------------------------------------

/**
 * Returns true when the session-expired notice is visible on the login page.
 * Used by tests that simulate a mid-session expiry and expect the login page
 * to show a contextual message rather than the blank form.
 *
 * @param context - Playwright fixture context.
 */
export async function sessionExpiredBannerVisible(context: AuthBehaviorContext): Promise<boolean> {
  const loginPage = new LoginPage(context);
  return loginPage.sessionExpiredBannerVisible();
}

// ---------------------------------------------------------------------------
// navigateToLoginWithSessionExpired() (MINCRM-365)
// ---------------------------------------------------------------------------

/**
 * Navigates directly to /login?reason=session_expired&next=<path>, simulating
 * what the Axios 401 interceptor does when it detects an expired session.
 *
 * @param next - The path the user was on when the session expired.
 * @param context - Playwright fixture context.
 */
export async function navigateToLoginWithSessionExpired(
  next: string,
  context: AuthBehaviorContext,
): Promise<void> {
  // Deliberately NOT routed through gotoAndSettle: this is the unauthenticated
  // login route, which never issues GET /api/v1/feature-flags/me, so waiting on
  // that response would simply burn the full timeout on every call. The page has
  // no flag-gated subtrees, so networkidle is an adequate signal here.
  // (MINCRM-700)
  const encoded = encodeURIComponent(next);
  await context.page.goto(`/login?reason=session_expired&next=${encoded}`, {
    waitUntil: 'networkidle',
  });
}

// ---------------------------------------------------------------------------
// Additional API helpers (MINCRM-357)
// ---------------------------------------------------------------------------

/**
 * Logs the current RestClient session out via POST /api/v1/auth/logout.
 *
 * @param restClient - An authenticated RestClient.
 */
export async function logoutViaApi(restClient: RestClient): Promise<void> {
  await restClient.post('/api/v1/auth/logout', {});
}

/**
 * Submits a forgot-password request for the given email address.
 *
 * @param restClient - RestClient (no auth required).
 * @param email - Email address to request a reset link for.
 * @returns The HTTP status code.
 */
export async function forgotPassword(restClient: RestClient, email: string): Promise<number> {
  const res = await restClient.post('/api/v1/auth/forgot-password', { email });
  return res.status;
}

/**
 * Fetches a plaintext password reset token via the dev-only endpoint.
 * Only works in non-production environments.
 *
 * @param restClient - RestClient (no auth required).
 * @param email - Email address of the user.
 * @returns The plaintext reset token.
 */
export async function getDevResetToken(restClient: RestClient, email: string): Promise<string> {
  const res = await restClient.post<{ token: string }>('/api/v1/auth/dev/reset-token', { email });
  return res.body.token;
}

// ---------------------------------------------------------------------------
// Locator-accessor behaviors — wrap SetPasswordPage / LoginPage / ForgotPasswordPage
// so spec files never import @pages/* directly. (MINCRM-367)
// ---------------------------------------------------------------------------

/**
 * Navigates to the set-password page with the given invite token.
 */
export async function navigateToSetPasswordPage(
  token: string,
  context: AuthBehaviorContext,
): Promise<void> {
  const po = new SetPasswordPage(context);
  await po.navigate(token);
}

/**
 * Returns true when the invalid-token error element is visible on the set-password page.
 */
export async function isSetPasswordTokenInvalid(context: AuthBehaviorContext): Promise<boolean> {
  const po = new SetPasswordPage(context);
  return po.invalidTokenVisible();
}

/**
 * Navigates to the login page.
 */
export async function navigateToLoginPage(context: AuthBehaviorContext): Promise<void> {
  const po = new LoginPage(context);
  await po.navigate();
}

/**
 * Clicks the login form submit button.
 */
export async function submitLoginForm(context: AuthBehaviorContext): Promise<void> {
  const po = new LoginPage(context);
  await po.submit();
}

/**
 * Waits for the login error alert to become visible.
 *
 * Use this after submitLoginForm() in test scenarios that need the alert to
 * be present before acting (e.g. accessibility audits). submitLoginForm()
 * only clicks Submit and does not wait for the async error response.
 */
export async function waitForLoginAlert(
  context: AuthBehaviorContext,
  timeout = 8_000,
): Promise<void> {
  // Use fallbackTimeout so the healing locator waits up to `timeout` ms for the
  // element to appear in the DOM before resolving. alertLocator() uses the default
  // 2 s probe window and returns null if the element isn't present yet — which
  // would cause a silent no-op before the async error response arrives.
  const alert = await context.page
    .locate(
      [
        { type: 'role', value: 'alert' },
        { type: 'css', value: '[role="alert"]' },
      ],
      { intent: 'error alert message on login form', fallbackTimeout: timeout },
    )
    .resolve();
  await alert.waitFor({ state: 'visible', timeout });
}

/**
 * Navigates to the forgot-password page.
 */
export async function navigateToForgotPasswordPage(context: AuthBehaviorContext): Promise<void> {
  const po = new ForgotPasswordPage(context);
  await po.navigate();
}

// ---------------------------------------------------------------------------
// getDevJwt() (MINCRM-376)
// ---------------------------------------------------------------------------

/**
 * Retrieves the raw JWT from the dev-only endpoint GET /api/v1/auth/dev/jwt.
 *
 * The endpoint reads the httpOnly session cookie and returns the token as JSON,
 * so the E2E suite can pass it as gRPC metadata without reading cookies directly.
 * Only available in non-production environments.
 *
 * @param restClient - An authenticated RestClient (must have a valid session cookie).
 * @returns The raw JWT string.
 */
export async function getDevJwt(restClient: RestClient): Promise<string> {
  const res = await restClient.get<{ token: string }>('/api/v1/auth/dev/jwt');
  return res.body.token;
}

// ---------------------------------------------------------------------------
// MFA behaviors (MINCRM-392)
// ---------------------------------------------------------------------------

/**
 * Fetches the current TOTP code for the authenticated user via the dev-only
 * endpoint GET /api/v1/auth/mfa/dev/totp-code.
 *
 * Only available in non-production environments. The authenticated user must
 * have MFA enabled (active secret). Used by E2E tests to complete the TOTP
 * verification step without a real authenticator app.
 *
 * @param restClient - An authenticated RestClient with an active MFA secret.
 * @returns The current 6-digit TOTP code string.
 */
export async function getDevTotpCode(restClient: RestClient): Promise<string> {
  const res = await restClient.get<{ code: string }>('/api/v1/auth/mfa/dev/totp-code');
  return res.body.code;
}

/** Result returned by the enableMfa behavior. */
export interface EnableMfaResult {
  /** True when the MFA enabled badge is visible after completing setup. */
  enabled: boolean;
  /** True when the recovery codes modal was shown after setup. */
  recoveryCodesShown: boolean;
}

/**
 * Navigates to the profile page and completes the full MFA setup flow:
 * 1. Clicks Enable MFA → MFA setup modal opens.
 * 2. Waits for the QR code to load, then clicks Next.
 * 3. Fetches the current TOTP code via the dev endpoint (requires restClient
 *    to be authenticated as the same user).
 * 4. Enters the code and clicks Verify.
 * 5. Waits for the recovery codes modal to appear, then closes it.
 * 6. Returns whether the enabled badge is now visible.
 *
 * @param restClient - Authenticated RestClient for the user enabling MFA.
 * @param context - Playwright fixture context.
 * @returns EnableMfaResult.
 */
export async function enableMfa(
  restClient: RestClient,
  context: AuthBehaviorContext,
): Promise<EnableMfaResult> {
  const profilePage = new ProfilePage(context);
  await profilePage.navigate();

  await profilePage.clickEnableMfa();
  await profilePage.waitForMfaSetupQrLoaded();
  await profilePage.clickMfaSetupNext();

  // The verify step is now visible. Fetch the current TOTP code from the
  // dev endpoint — the pending secret was stored when setup was initiated.
  const code = await getDevTotpCode(restClient);
  await profilePage.fillMfaSetupCode(code);
  await profilePage.clickMfaSetupVerify();

  // Setup success: recovery codes modal should appear.
  await profilePage.waitForRecoveryCodesModal();
  const recoveryCodesShown = await profilePage.recoveryCodesModalIsVisible();

  await profilePage.closeMfaRecoveryCodesModal();

  // Wait for the React state to propagate and the MFA section to reflect the
  // new enabled status. Navigation is not needed — the modal close triggers
  // an MFA status refetch via the React Query invalidation.
  await context.page.waitForLoadState('networkidle').catch(() => null);
  const enabled = await profilePage.mfaEnabledBadgeIsVisible();

  return { enabled, recoveryCodesShown };
}

/** Result returned by the disableMfa behavior. */
export interface DisableMfaResult {
  /** True when the MFA disabled badge is visible after completing disable. */
  disabled: boolean;
}

/**
 * Navigates to the profile page and completes the MFA disable flow:
 * 1. Clicks Disable MFA → the disable confirmation modal opens.
 * 2. Enters the user's current password and clicks Confirm.
 * 3. Returns whether the disabled badge is now visible.
 *
 * @param password - The user's current password.
 * @param context - Playwright fixture context.
 * @returns DisableMfaResult.
 */
export async function disableMfa(
  password: string,
  context: AuthBehaviorContext,
): Promise<DisableMfaResult> {
  const profilePage = new ProfilePage(context);
  await profilePage.navigate();

  await profilePage.clickDisableMfa();
  await profilePage.fillMfaDisablePassword(password);
  await profilePage.confirmMfaDisable();

  // Wait for the modal to close and the profile page to re-render.
  await context.page.waitForLoadState('networkidle').catch(() => null);

  const disabled = await profilePage.mfaDisabledBadgeIsVisible();
  return { disabled };
}

/**
 * Enables MFA for a user via the REST API directly (no UI).
 * Calls POST /api/v1/auth/mfa/setup then POST /api/v1/auth/mfa/verify-setup
 * using the dev TOTP code endpoint to get a valid code.
 *
 * Used by tests that need MFA pre-enabled without going through the UI flow.
 *
 * @param restClient - Authenticated RestClient for the user.
 * @returns The plaintext recovery codes.
 */
export async function enableMfaViaApi(
  restClient: RestClient,
): Promise<{ recoveryCodes: string[] }> {
  await restClient.post('/api/v1/auth/mfa/setup', {});
  const totpRes = await restClient.get<{ code: string }>('/api/v1/auth/mfa/dev/totp-code');
  const code = totpRes.body.code;
  const verifyRes = await restClient.post<{ recoveryCodes: string[] }>(
    '/api/v1/auth/mfa/verify-setup',
    { code },
  );
  return { recoveryCodes: verifyRes.body.recoveryCodes };
}

/**
 * Disables MFA for a user via the REST API directly (no UI).
 *
 * @param restClient - Authenticated RestClient for the user.
 * @param password - The user's current password.
 */
export async function disableMfaViaApi(restClient: RestClient, password: string): Promise<void> {
  await restClient.post('/api/v1/auth/mfa/disable', { currentPassword: password });
}

// ---------------------------------------------------------------------------
// Browser login helpers (MINCRM-392)
// ---------------------------------------------------------------------------

/**
 * Submits the login form in the browser for a user whose MFA is NOT enabled.
 * Navigates to /login, fills credentials, submits, and waits for navigation away.
 *
 * @param email - User email.
 * @param password - User password.
 * @param context - Playwright fixture context.
 */
export async function loginViaBrowser(
  email: string,
  password: string,
  context: AuthBehaviorContext,
): Promise<void> {
  const loginPage = new LoginPage(context);
  await loginPage.navigate();
  await loginPage.fillEmail(email);
  await loginPage.fillPassword(password);
  await loginPage.submit();
  // Do not swallow the timeout — a failure here means the server rejected the
  // credentials or is unreachable. Propagating gives a clear error rather than
  // a confusing downstream timeout 30 s later. (MINCRM-415)
  await context.page.waitForURL((url) => new URL(url).pathname !== '/login', {
    timeout: 15_000,
  });
}

/**
 * Refreshes the BROWSER's admin session cookie in place, without navigating.
 *
 * Use this in a spec's `beforeEach` when the test drives the UI as an admin and
 * the run may be long. The project-level `storageState` (`.auth/admin.json`) is
 * written once at suite start, and its JWT carries a 30-minute sliding idle
 * expiry (`JWT_IDLE_EXPIRY_SECONDS`,
 * server/src/controllers/authController.ts) — the documented "8 hours" is the
 * absolute cap enforced via `login_at`, not the token's lifetime. Idle refresh
 * only happens on a context that is actually making requests, so a spec that
 * first navigates an hour into the run loads a dead cookie and lands on /login.
 * Every locator for app content then fails as "all strategies exhausted", which
 * reads as a drifted selector rather than an expired session.
 *
 * That is the MINCRM-697 root cause: in `tia-record-mode.yml` (~1300 tests,
 * unsharded, two projects) the mobile-web AI specs ran ~1 hour after login and
 * rendered the login page. `ci.yml`'s `e2e-serial` job never saw it — it is
 * `--project=desktop` only and finishes inside the 30-minute window.
 *
 * **Deliberately mints the token over REST and injects it with `addCookies`
 * rather than driving the login UI.** Under record mode the per-test coverage
 * session is already open when `beforeEach` runs (the `page` fixture starts it
 * during construction — apps/minicrm/fixtures.ts), so a UI login here would
 * attribute LoginPage, `/api/v1/auth/login` and the whole post-login dashboard
 * bootstrap to whichever AI test happened to be running. That would poison the
 * coverage map this ticket exists to produce and make an edit to authController
 * select all seven AI specs. Injecting the cookie touches no instrumented
 * client code. (MINCRM-697)
 *
 * @param context - Playwright fixture context.
 */
export async function refreshAdminBrowserSession(context: AuthBehaviorContext): Promise<void> {
  const { email, password } = resolveAdminCredentials('refreshAdminBrowserSession');

  // No default outside CI: a silent :3001 fallback points at the DEV server and
  // its database, the leak class MINCRM-684 closed.
  const apiUrl = process.env['E2E_API_URL'] ?? (process.env['CI'] ? 'http://localhost:3001' : '');
  if (!apiUrl) {
    throw new Error('[refreshAdminBrowserSession] E2E_API_URL is not set — source qa/e2e/.env');
  }

  const browserContext = context.page.context();
  const res = await browserContext.request.post(`${apiUrl}/api/v1/auth/login`, {
    data: { email, password },
  });
  if (!res.ok()) {
    throw new Error(`[refreshAdminBrowserSession] login failed with status ${res.status()}`);
  }

  const cookieName = process.env['AUTH_COOKIE_NAME'] ?? 'minicrm_token';
  const setCookie = res.headers()['set-cookie'] ?? '';
  const value = new RegExp(`${cookieName}=([^;]+)`).exec(setCookie)?.[1];
  if (!value) {
    throw new Error(
      `[refreshAdminBrowserSession] no ${cookieName} cookie in the login response headers`,
    );
  }

  await browserContext.addCookies([
    {
      name: cookieName,
      value,
      domain: new URL(apiUrl).hostname,
      path: '/',
      expires: -1,
      httpOnly: true,
      secure: false,
      sameSite: 'Lax',
    },
  ]);
}

/** Result returned by loginWithMfaChallenge. */
export interface LoginWithMfaResult {
  /** True when the browser navigated away from /login after TOTP submission. */
  success: boolean;
  /** The URL the browser settled on. */
  finalUrl: string;
}

/**
 * Performs a full MFA-gated browser login:
 * 1. Navigates to /login and submits credentials.
 * 2. Waits for the MFA challenge modal.
 * 3. Fetches the current TOTP code via the dev endpoint.
 * 4. Enters the code and submits.
 * 5. Waits for navigation away from /login.
 *
 * Requires restClient to be authenticated as the same user (for the dev TOTP endpoint).
 *
 * @param email - User email.
 * @param password - User password.
 * @param restClient - Authenticated RestClient for the user.
 * @param context - Playwright fixture context.
 * @returns LoginWithMfaResult.
 */
export async function loginWithMfaChallenge(
  email: string,
  password: string,
  restClient: RestClient,
  context: AuthBehaviorContext,
): Promise<LoginWithMfaResult> {
  const loginPage = new LoginPage(context);
  await loginPage.navigate();
  await loginPage.fillEmail(email);
  await loginPage.fillPassword(password);
  await loginPage.submit();

  // Wait for MFA modal.
  const mfaModal = await context.page
    .locate(
      [
        { type: 'testId', value: 'mfa-login-modal' },
        { type: 'css', value: '[data-testid="mfa-login-modal"]' },
      ],
      { intent: 'MFA login challenge modal after password is accepted' },
    )
    .resolve();
  await mfaModal.waitFor({ state: 'visible', timeout: 10_000 });

  const code = await getDevTotpCode(restClient);

  await context.page.fill(
    code,
    [
      { type: 'testId', value: 'mfa-login-code-input' },
      { type: 'role', value: 'textbox' },
    ],
    { intent: 'TOTP code input in the MFA login modal' },
  );

  await context.page.click(
    [
      { type: 'testId', value: 'mfa-login-submit' },
      { type: 'role', value: 'button', options: { name: /verify|submit/i } },
    ],
    { intent: 'submit button in the MFA login modal' },
  );

  await context.page
    .waitForURL((url) => new URL(url).pathname !== '/login', { timeout: 10_000 })
    .catch(() => null);

  const finalUrl = context.page.url();
  const success = new URL(finalUrl).pathname !== '/login';
  return { success, finalUrl };
}

/** Result returned by loginWithRecoveryCode. */
export interface LoginWithRecoveryCodeResult {
  /** True when the browser navigated away from /login. */
  success: boolean;
  /** The URL the browser settled on. */
  finalUrl: string;
}

/**
 * Performs an MFA-gated browser login using a single-use recovery code.
 * 1. Navigates to /login and submits credentials.
 * 2. Waits for the MFA challenge modal.
 * 3. Switches to recovery code mode.
 * 4. Enters the recovery code and submits.
 * 5. Waits for navigation away from /login.
 *
 * @param email - User email.
 * @param password - User password.
 * @param recoveryCode - Single-use plaintext recovery code.
 * @param context - Playwright fixture context.
 * @returns LoginWithRecoveryCodeResult.
 */
export async function loginWithRecoveryCode(
  email: string,
  password: string,
  recoveryCode: string,
  context: AuthBehaviorContext,
): Promise<LoginWithRecoveryCodeResult> {
  const loginPage = new LoginPage(context);
  await loginPage.navigate();
  await loginPage.fillEmail(email);
  await loginPage.fillPassword(password);
  await loginPage.submit();

  const mfaModal = await context.page
    .locate(
      [
        { type: 'testId', value: 'mfa-login-modal' },
        { type: 'css', value: '[data-testid="mfa-login-modal"]' },
      ],
      { intent: 'MFA login challenge modal after password is accepted' },
    )
    .resolve();
  await mfaModal.waitFor({ state: 'visible', timeout: 10_000 });

  // Switch to recovery code mode.
  await context.page.click(
    [
      { type: 'testId', value: 'mfa-login-switch-mode' },
      { type: 'role', value: 'button', options: { name: /recovery/i } },
    ],
    { intent: 'button to switch from TOTP to recovery code mode in the MFA modal' },
  );

  await context.page.fill(
    recoveryCode,
    [
      { type: 'testId', value: 'mfa-login-code-input' },
      { type: 'role', value: 'textbox' },
    ],
    { intent: 'recovery code input in the MFA login modal' },
  );

  await context.page.click(
    [
      { type: 'testId', value: 'mfa-login-submit' },
      { type: 'role', value: 'button', options: { name: /verify|submit/i } },
    ],
    { intent: 'submit button in the MFA login modal (recovery mode)' },
  );

  await context.page
    .waitForURL((url) => new URL(url).pathname !== '/login', { timeout: 10_000 })
    .catch(() => null);

  const finalUrl = context.page.url();
  const success = new URL(finalUrl).pathname !== '/login';
  return { success, finalUrl };
}

// ---------------------------------------------------------------------------
// MFA settings helpers — keep page.goto/locate out of spec files. (MINCRM-418)
// ---------------------------------------------------------------------------

/**
 * Navigates to the admin settings Security & Identity tab and waits for network
 * idle. MFA enforcement was moved from the General tab to Security (MINCRM-563).
 */
export async function navigateToAdminSettingsGeneralPage(
  context: AuthBehaviorContext,
): Promise<void> {
  await gotoAndSettle(context.page, '/admin/settings?tab=security');
}

/** Waits for the MFA enforcement checkbox to become visible, with an optional timeout (ms). */
export async function waitForMfaRequiredCheckbox(
  context: AuthBehaviorContext,
  timeout?: number,
): Promise<void> {
  const locator = await context.page
    .locate(
      [
        { type: 'testId', value: 'mfa-required-checkbox' },
        { type: 'css', value: '[data-testid="mfa-required-checkbox"]' },
      ],
      { intent: 'MFA enforcement checkbox in admin general settings' },
    )
    .resolve();
  await locator.waitFor({ state: 'visible', ...(timeout !== undefined ? { timeout } : {}) });
}

/** Returns true when the MFA enforcement checkbox is currently checked. */
export async function isMfaRequiredChecked(context: AuthBehaviorContext): Promise<boolean> {
  const locator = await context.page
    .locate(
      [
        { type: 'testId', value: 'mfa-required-checkbox' },
        { type: 'css', value: '[data-testid="mfa-required-checkbox"]' },
      ],
      { intent: 'MFA enforcement checkbox in admin general settings' },
    )
    .resolve();
  return locator.isChecked();
}

/** Clicks the MFA enforcement checkbox in admin settings. */
export async function clickMfaRequiredCheckbox(context: AuthBehaviorContext): Promise<void> {
  const locator = await context.page
    .locate(
      [
        { type: 'testId', value: 'mfa-required-checkbox' },
        { type: 'css', value: '[data-testid="mfa-required-checkbox"]' },
      ],
      { intent: 'MFA enforcement checkbox in admin general settings' },
    )
    .resolve();
  await locator.click();
}

/** Waits for the MFA enforcement success message to become visible, with an optional timeout (ms). */
export async function waitForMfaRequiredSuccess(
  context: AuthBehaviorContext,
  timeout?: number,
): Promise<void> {
  const locator = await context.page
    .locate(
      [
        { type: 'testId', value: 'mfa-required-success' },
        { type: 'role', value: 'status' },
      ],
      { intent: 'success confirmation after toggling MFA enforcement setting' },
    )
    .resolve();
  await locator.waitFor({ state: 'visible', ...(timeout !== undefined ? { timeout } : {}) });
}

/** Asserts the MFA enforcement success message is visible, with an optional timeout (ms). */
export async function expectMfaRequiredSuccessVisible(
  context: AuthBehaviorContext,
  timeout?: number,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const locator = await context.page
    .locate(
      [
        { type: 'testId', value: 'mfa-required-success' },
        { type: 'role', value: 'status' },
      ],
      { intent: 'success confirmation after toggling MFA enforcement setting' },
    )
    .resolve();
  await expect(locator).toBeVisible(timeout !== undefined ? { timeout } : undefined);
}
