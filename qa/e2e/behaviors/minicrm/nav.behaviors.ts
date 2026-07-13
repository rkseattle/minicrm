/**
 * Navigation behaviors for MiniCRM.
 *
 * Behaviors encapsulate multi-step user journeys involving the navigation
 * layout system introduced in MINCRM-133. Callers never touch raw locators
 * or Page Objects directly.
 *
 * Behaviors do NOT contain assertions (no expect() calls). They return typed
 * result objects that test specs assert against.
 *
 * MINCRM-144
 */

import type { PageFacade, SafeLocator } from '@framework/fixtures/index.js';
import type { RestClient } from '@framework/clients/rest-client.js';
import { NavPage } from '@pages/minicrm/NavPage.js';
import { AdminSettingsPage } from '@pages/minicrm/AdminSettingsPage.js';

/** Navigation layout modes supported by MiniCRM (MINCRM-133). */
export type NavLayout = 'top' | 'left' | 'hamburger';

// ---------------------------------------------------------------------------
// Fixture context
// ---------------------------------------------------------------------------

/** Fixtures required by navigation behaviors. */
export interface NavBehaviorContext {
  page: PageFacade;
}

// ---------------------------------------------------------------------------
// setNavLayoutViaAPI()
// ---------------------------------------------------------------------------

/** Result returned by setNavLayoutViaAPI. */
export interface SetNavLayoutResult {
  /** True if the API call returned 200 and the layout was accepted. */
  success: boolean;
  /** HTTP status returned by the server. */
  status: number;
}

/**
 * Sets the nav layout via the REST API (admin-only endpoint).
 * Faster than navigating through the Settings UI and avoids coupling tests
 * to the Settings page under test in separate spec groups.
 *
 * Callers must ensure the RestClient is authenticated as an admin before
 * calling this function.
 *
 * @param layout - The target layout: 'top', 'left', or 'hamburger'.
 * @param restClient - Admin-authenticated RestClient instance.
 * @returns Result indicating success and the HTTP status code.
 */
export async function setNavLayoutViaAPI(
  layout: NavLayout,
  restClient: RestClient,
): Promise<SetNavLayoutResult> {
  try {
    const res = await restClient.patch<{ layout: NavLayout }>('/api/v1/settings/nav-layout', {
      layout,
    });
    return { success: res.status === 200, status: res.status };
  } catch {
    return { success: false, status: 0 };
  }
}

// ---------------------------------------------------------------------------
// setNavLayoutViaUI()
// ---------------------------------------------------------------------------

/** Result returned by setNavLayoutViaUI. */
export interface SetNavLayoutViaUIResult {
  /** True if the layout option button was found and clicked. */
  clicked: boolean;
  /** True if the aria-checked attribute confirmed the selection after saving. */
  successFeedbackVisible: boolean;
}

/**
 * Selects a navigation layout using the radio buttons on the Admin Settings page.
 * Assumes the caller has already navigated to /admin/settings and the page is loaded.
 * Waits for the button's aria-checked attribute to become "true" before returning,
 * ensuring the PATCH has round-tripped before the caller proceeds.
 *
 * @param layout - The target layout to activate.
 * @param context - Behavior context with page.
 * @returns Result describing whether the click and aria-checked confirmation were observed.
 */
export async function setNavLayoutViaUI(
  layout: NavLayout,
  context: NavBehaviorContext,
): Promise<SetNavLayoutViaUIResult> {
  const adminSettings = new AdminSettingsPage(context);
  try {
    await adminSettings.selectNavLayoutOption(layout);
  } catch {
    return { clicked: false, successFeedbackVisible: false };
  }

  const successFeedbackVisible = await adminSettings.navLayoutOptionIsChecked(layout);
  return { clicked: true, successFeedbackVisible };
}

// ---------------------------------------------------------------------------
// openHamburgerMenu()
// ---------------------------------------------------------------------------

/** Result returned by openHamburgerMenu. */
export interface OpenHamburgerMenuResult {
  /** True if the drawer became visible after the toggle click. */
  drawerVisible: boolean;
}

/**
 * Opens the hamburger menu overlay by clicking the toggle button.
 * Waits for the drawer to reach the visible state before returning.
 *
 * @param context - Behavior context with page.
 * @returns Result indicating whether the drawer appeared.
 */
export async function openHamburgerMenu(
  context: NavBehaviorContext,
): Promise<OpenHamburgerMenuResult> {
  // Wait for the toggle to be both in the DOM and CSS-visible before clicking.
  // NavTop also renders a nav-menu-toggle button with lg:hidden on desktop, so
  // a testId wait alone can resolve against that hidden button before NavHamburger
  // has mounted. waitForFunction polls until offsetParent !== null, which is only
  // true when the element is CSS-visible (lg:hidden sets display:none → null).
  //
  // Also wait for the drawer to be absent from the DOM before clicking the toggle.
  // If the previous NavHamburger instance still has menuOpen=true (e.g. after a
  // navigation that re-mounted the component), clicking the toggle would close the
  // drawer instead of opening it, causing a StrategyExhaustedError on the
  // subsequent visibility wait. Polling for drawer absence confirms the component
  // has settled into its closed state before we issue the open click. (MINCRM-404)
  await context.page.waitForFunction(
    `document.querySelector('[data-testid="nav-menu-toggle"]')?.offsetParent !== null &&
     !document.querySelector('[data-testid="nav-hamburger-drawer"]')`,
    null,
    { timeout: 10_000 },
  );
  const navPage = new NavPage(context);
  await navPage.clickMenuToggle();
  // page.waitFor() re-resolves the element on every internal retry cycle, so it
  // never holds a stale DOM snapshot from before the React commit. This is
  // different from resolve()-then-waitFor(), which captures the locator once at
  // DOM-attached time and then calls waitFor() on that frozen reference — on a
  // slow runner the element can be in the DOM but not yet CSS-visible when the
  // snapshot is taken, and the subsequent waitFor() then races the paint cycle
  // with whatever test-budget remains. Passing an explicit timeout keeps this
  // wait from consuming the entire remaining test budget on a loaded CI runner.
  await context.page.waitFor(
    [
      { type: 'testId', value: 'nav-hamburger-drawer' },
      { type: 'role', value: 'dialog', options: { name: /menu|navigation/i } },
    ],
    'visible',
    {},
    10_000,
  );
  return { drawerVisible: true };
}

// ---------------------------------------------------------------------------
// closeHamburgerMenuViaBackdrop()
// ---------------------------------------------------------------------------

/** Result returned by closeHamburgerMenuViaBackdrop. */
export interface CloseHamburgerMenuViaBackdropResult {
  /** True if the drawer is no longer visible after clicking the backdrop. */
  drawerClosed: boolean;
}

/**
 * Closes the hamburger menu by clicking the backdrop overlay outside the drawer.
 * Assumes the menu is already open.
 *
 * @param context - Behavior context with page.
 * @returns Result indicating whether the drawer closed.
 */
export async function closeHamburgerMenuViaBackdrop(
  context: NavBehaviorContext,
): Promise<CloseHamburgerMenuViaBackdropResult> {
  // Click a point outside the drawer — top-right corner of the viewport is safe.
  // Use optional chaining to guard against null viewport (Greptile P2 finding).
  const viewportWidth = context.page.viewportSize()?.width ?? 1024;
  await context.page.mouse.click(viewportWidth - 10, 10);

  // Drawer is conditionally rendered — resolve after the click that closed it.
  // If it's already gone, hamburgerDrawerLocator() returns null and we treat it as closed.
  const navPage = new NavPage(context);
  const drawer = await navPage.hamburgerDrawerLocator();
  // Wait for the drawer to disappear rather than using a fixed timeout.
  await drawer?.waitFor({ state: 'hidden' }).catch(() => null);
  const drawerVisible = (await drawer?.isVisible().catch(() => false)) ?? false;
  return { drawerClosed: !drawerVisible };
}

// ---------------------------------------------------------------------------
// closeHamburgerMenuViaCloseButton()
// ---------------------------------------------------------------------------

/** Result returned by closeHamburgerMenuViaCloseButton. */
export interface CloseHamburgerMenuViaCloseButtonResult {
  /** True if the drawer is no longer visible after clicking the close button. */
  drawerClosed: boolean;
}

/**
 * Closes the hamburger menu using the close button inside the drawer.
 * Assumes the menu is already open.
 *
 * @param context - Behavior context with page.
 * @returns Result indicating whether the drawer closed.
 */
export async function closeHamburgerMenuViaCloseButton(
  context: NavBehaviorContext,
): Promise<CloseHamburgerMenuViaCloseButtonResult> {
  const navPage = new NavPage(context);
  await navPage.clickHamburgerClose();

  // Drawer is conditionally rendered — after clicking close it may already be
  // unmounted. hamburgerDrawerLocator() returns null if gone (counts as closed).
  const drawer = await navPage.hamburgerDrawerLocator();
  // Wait for the drawer to disappear rather than using a fixed timeout.
  await drawer?.waitFor({ state: 'hidden' }).catch(() => null);
  const drawerVisible = (await drawer?.isVisible().catch(() => false)) ?? false;
  return { drawerClosed: !drawerVisible };
}

// ---------------------------------------------------------------------------
// navigateViaNavLink()
// ---------------------------------------------------------------------------

/** Result returned by navigateViaNavLink. */
export interface NavigateViaNavLinkResult {
  /** True if the nav link was found and clicked. */
  linkClicked: boolean;
  /** The URL the browser settled on after the click. */
  finalUrl: string;
}

/**
 * Clicks a navigation link identified by its data-testid and waits for navigation.
 *
 * The testid follows the convention `nav-{layout}-{destination}` per MINCRM-133.
 * For the hamburger layout, this function automatically opens the menu first.
 *
 * @param layout - The active nav layout ('top', 'left', or 'hamburger').
 * @param destination - The destination slug (e.g. 'contacts', 'deals').
 * @param context - Behavior context with page.
 * @returns Result with link-clicked flag and final URL.
 */
export async function navigateViaNavLink(
  layout: NavLayout,
  destination: string,
  context: NavBehaviorContext,
): Promise<NavigateViaNavLinkResult> {
  const navPage = new NavPage(context);

  if (layout === 'hamburger') {
    // Check whether the drawer is already open — hamburgerDrawerLocator() returns
    // null if absent, which we treat as closed and open before navigating.
    const drawerLocator = await navPage.hamburgerDrawerLocator();
    const drawerVisible = (await drawerLocator?.isVisible().catch(() => false)) ?? false;
    if (!drawerVisible) {
      await openHamburgerMenu(context);
    }
  }

  let link;
  try {
    link = await navPage.navLinkLocator(layout, destination);
  } catch {
    return { linkClicked: false, finalUrl: context.page.url() };
  }
  if (!link) {
    return { linkClicked: false, finalUrl: context.page.url() };
  }

  const isVisible = await link.isVisible().catch(() => false);
  if (!isVisible) {
    return { linkClicked: false, finalUrl: context.page.url() };
  }

  // Capture the URL before clicking so we can wait for it to change. This is
  // necessary because React Router uses history.pushState() for client-side
  // navigation — there are zero network requests, so waitForLoadState('networkidle')
  // can fire before pushState has committed the new URL to the browser's location
  // bar. waitForURL waits for the actual URL string to match, which is the correct
  // signal for SPA navigation.
  const urlBefore = context.page.url();
  // Compare by pathname only: pages like ReportsPage update search params via
  // useEffect after mounting (e.g. /reports → /reports?view=pipeline-stage).
  // A full href comparison would treat that search-param update as a navigation
  // and resolve before the actual nav-link click propagates, causing the caller
  // to receive the wrong finalUrl. Pathname comparison correctly ignores these
  // same-page param writes while still detecting cross-page navigation.
  const pathnameBefore = new URL(urlBefore).pathname;

  // On hamburger layout, the drawer's focus-on-open effect causes a layout
  // shift that triggers Playwright's stability check. Use force:true to bypass
  // the stability wait — visibility has already been confirmed above.
  await link.click({ force: layout === 'hamburger' });

  // Wait for the URL pathname to change from its pre-click value. If the first
  // click was swallowed by a React re-render mid-paint (the link DOM node is
  // briefly replaced during a state update), retry the click once before giving
  // up. Falls back to domcontentloaded if the link navigates to the
  // already-active route (pathname won't change, e.g. clicking Dashboard when
  // already on '/').
  const urlChanged = await context.page
    .waitForURL((url) => url.pathname !== pathnameBefore, { timeout: 6_000 })
    .then(() => true)
    .catch(() => false);

  if (!urlChanged && new URL(context.page.url()).pathname === pathnameBefore) {
    await link.click({ force: layout === 'hamburger' });
    await context.page
      .waitForURL((url) => url.pathname !== pathnameBefore, { timeout: 8_000 })
      .catch(() => context.page.waitForLoadState('domcontentloaded').catch(() => null));
  }

  return { linkClicked: true, finalUrl: context.page.url() };
}

// ---------------------------------------------------------------------------
// Mobile nav behaviors (NavTop mobile drawer)
//
// These behaviors operate on the mobile nav drawer rendered by NavTop at
// viewports below the lg breakpoint. The drawer is identified by
// data-testid="mobile-nav-drawer" and nav links by "nav-top-{dest}-mobile".
// NavTop has no separate close button — the drawer closes via the toggle or
// an outside tap.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// openMobileNav()
// ---------------------------------------------------------------------------

/** Result returned by openMobileNav. */
export interface OpenMobileNavResult {
  /** True if the mobile nav drawer became visible after the toggle click. */
  drawerVisible: boolean;
}

/**
 * Opens the mobile nav drawer by clicking the toggle button and waits for
 * the drawer to become visible.
 *
 * @param context - Behavior context with page.
 * @returns Result indicating whether the drawer appeared.
 */
export async function openMobileNav(context: NavBehaviorContext): Promise<OpenMobileNavResult> {
  // On mobile the global-search-input can overlap the toggle button.
  // clickMenuToggleForce() bypasses the pointer-intercept check.
  const navPage = new NavPage(context);
  await navPage.clickMenuToggleForce();
  // The drawer is conditionally rendered — resolve after the click that mounts it.
  const drawer = await navPage.mobileNavDrawerLocator();
  await drawer?.waitFor({ state: 'visible' }).catch(() => null);
  const drawerVisible = (await drawer?.isVisible().catch(() => false)) ?? false;
  return { drawerVisible };
}

// ---------------------------------------------------------------------------
// closeMobileNavViaToggle()
// ---------------------------------------------------------------------------

/** Result returned by closeMobileNavViaToggle. */
export interface CloseMobileNavViaToggleResult {
  /** True if the drawer is no longer visible after clicking the toggle. */
  drawerClosed: boolean;
}

/**
 * Closes the mobile nav drawer by clicking the toggle button (which shows an X
 * when open). Assumes the drawer is already open.
 *
 * @param context - Behavior context with page.
 * @returns Result indicating whether the drawer closed.
 */
export async function closeMobileNavViaToggle(
  context: NavBehaviorContext,
): Promise<CloseMobileNavViaToggleResult> {
  // Same intercept issue as openMobileNav — global-search-input overlaps the
  // toggle on mobile viewports. clickMenuCloseForce() bypasses the intercept check.
  const navPage = new NavPage(context);
  await navPage.clickMenuCloseForce();
  const drawer = await navPage.mobileNavDrawerLocator();
  await drawer?.waitFor({ state: 'hidden' }).catch(() => null);
  const drawerVisible = (await drawer?.isVisible().catch(() => false)) ?? false;
  return { drawerClosed: !drawerVisible };
}

// ---------------------------------------------------------------------------
// navigateViaMobileNavLink()
// ---------------------------------------------------------------------------

/** Result returned by navigateViaMobileNavLink. */
export interface NavigateViaMobileNavLinkResult {
  /** True if the nav link was found and clicked. */
  linkClicked: boolean;
  /** The URL the browser settled on after the click. */
  finalUrl: string;
}

/**
 * Opens the mobile nav drawer (if not already open) and clicks a nav link
 * identified by its mobile data-testid (`nav-top-{destination}-mobile`).
 *
 * @param destination - The destination slug (e.g. 'contacts', 'deals').
 * @param context - Behavior context with page.
 * @returns Result with link-clicked flag and final URL.
 */
export async function navigateViaMobileNavLink(
  destination: string,
  context: NavBehaviorContext,
): Promise<NavigateViaMobileNavLinkResult> {
  const navPage = new NavPage(context);

  // Open the drawer if it is not already visible.
  const drawerLocator = await navPage.mobileNavDrawerLocator();
  const drawerVisible = (await drawerLocator?.isVisible().catch(() => false)) ?? false;
  if (!drawerVisible) {
    await navPage.clickMenuToggleForce();
    const drawer = await navPage.mobileNavDrawerLocator();
    await drawer?.waitFor({ state: 'visible' });
  }

  let link;
  try {
    link = await navPage.mobileNavLinkLocator(destination);
  } catch {
    return { linkClicked: false, finalUrl: context.page.url() };
  }
  if (!link) {
    return { linkClicked: false, finalUrl: context.page.url() };
  }

  const urlBefore = context.page.url();
  await link.click();
  await context.page
    .waitForURL((url) => url.href !== urlBefore, { timeout: 10_000 })
    .catch(() => context.page.waitForLoadState('domcontentloaded').catch(() => null));
  return { linkClicked: true, finalUrl: context.page.url() };
}

// ---------------------------------------------------------------------------
// Intent-bearing nav behaviors — replace get*Locator exports so spec files
// express user-intent rather than holding raw DOM handle references. (MINCRM-564)
// ---------------------------------------------------------------------------

/** Fixture context accepted by nav behaviors. */
export interface NavBehaviorContext {
  page: PageFacade;
}

/** Asserts a nav link by layout and destination carries the given CSS class. */
export async function expectNavLinkHasClass(
  layout: string,
  destination: string,
  classPattern: string | RegExp,
  context: NavBehaviorContext,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const locator = await new NavPage(context).navLinkLocator(layout, destination);
  await expect(locator).toHaveClass(classPattern);
}

/** Asserts a nav link by layout and destination does NOT carry the given CSS class. */
export async function expectNavLinkNotHasClass(
  layout: string,
  destination: string,
  classPattern: string | RegExp,
  context: NavBehaviorContext,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const locator = await new NavPage(context).navLinkLocator(layout, destination);
  await expect(locator).not.toHaveClass(classPattern);
}

/** Asserts a nav link by layout and destination is visible. */
export async function expectNavLinkVisible(
  layout: string,
  destination: string,
  context: NavBehaviorContext,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const locator = await new NavPage(context).navLinkLocator(layout, destination);
  await expect(locator).toBeVisible();
}

/** Asserts the admin section divider is visible in the given nav layout. */
export async function expectAdminSectionDividerVisible(
  layout: 'left' | 'top' | 'hamburger' | 'top-mobile',
  context: NavBehaviorContext,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const locator = await new NavPage(context).adminSectionDividerLocator(layout);
  await expect(locator).toBeVisible();
}

/** Asserts the hamburger nav drawer is visible. */
export async function expectHamburgerDrawerVisible(context: NavBehaviorContext): Promise<void> {
  const { expect } = await import('@playwright/test');
  const locator = await new NavPage(context).requireHamburgerDrawerLocator();
  await expect(locator).toBeVisible();
}

/** Asserts the hamburger nav drawer is not visible. */
export async function expectHamburgerDrawerNotVisible(
  context: NavBehaviorContext,
  timeout = 5_000,
): Promise<void> {
  // The hamburger drawer is fully unmounted from the DOM when closed — resolve()
  // would throw StrategyExhaustedError. Use waitForAbsent to poll until gone.
  await context.page.waitForAbsent('[data-testid="nav-hamburger-drawer"]', timeout);
}

/** Asserts the mobile nav drawer is visible. */
export async function expectMobileNavDrawerVisible(context: NavBehaviorContext): Promise<void> {
  const { expect } = await import('@playwright/test');
  const locator = await new NavPage(context).requireMobileNavDrawerLocator();
  await expect(locator).toBeVisible();
}

/** Asserts the mobile nav drawer is not visible. */
export async function expectMobileNavDrawerNotVisible(
  context: NavBehaviorContext,
  timeout = 5_000,
): Promise<void> {
  // The mobile nav drawer is fully unmounted from the DOM when closed — resolve()
  // would throw StrategyExhaustedError. Use waitForAbsent to poll until gone.
  await context.page.waitForAbsent('[data-testid="mobile-nav-drawer"]', timeout);
}

/** Asserts the hamburger/mobile menu toggle button is visible. */
export async function expectMenuToggleVisible(context: NavBehaviorContext): Promise<void> {
  const { expect } = await import('@playwright/test');
  const locator = await new NavPage(context).menuToggleLocator();
  await expect(locator).toBeVisible();
}

/** Moves keyboard focus to the hamburger/mobile menu toggle button. */
export async function focusMenuToggle(context: NavBehaviorContext): Promise<void> {
  const locator = await new NavPage(context).menuToggleLocator();
  await locator.focus();
}

/** Asserts a mobile nav link by destination is visible. */
export async function expectMobileNavLinkVisible(
  destination: string,
  context: NavBehaviorContext,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const locator = await new NavPage(context).mobileNavLinkLocator(destination);
  await expect(locator).toBeVisible();
}

/** Asserts the mobile logout button is visible in the nav drawer. */
export async function expectMobileLogoutButtonVisible(context: NavBehaviorContext): Promise<void> {
  const { expect } = await import('@playwright/test');
  const locator = await new NavPage(context).mobileLogoutButtonLocator();
  await expect(locator).toBeVisible();
}

/** Asserts the mobile language select is visible in the nav drawer. */
export async function expectMobileLanguageSelectVisible(
  context: NavBehaviorContext,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const locator = await new NavPage(context).mobileLanguageSelectLocator();
  await expect(locator).toBeVisible();
}

/**
 * Returns a resolved locator for the desktop language select in the nav header.
 *
 * Intentionally kept as a raw-locator accessor (MINCRM-564 exception): this locator
 * is passed as an argument to selectLanguageAndWaitForPatch, which requires a
 * SafeLocator handle to drive both the select interaction and the waitForResponse
 * racing. Splitting it into separate behaviors would lose the ability to race the
 * click with the response wait in the same Promise.all call.
 */
export async function getDesktopLanguageSelectLocator(context: NavBehaviorContext) {
  const navPage = new NavPage(context);
  return navPage.desktopLanguageSelectLocator();
}

// ---------------------------------------------------------------------------
// Page reload helper — keep page.reload() out of spec files. (MINCRM-418)
// ---------------------------------------------------------------------------

/**
 * Reloads the current page and waits for network idle.
 */
export async function reloadCurrentPage(context: NavBehaviorContext): Promise<void> {
  await context.page.reload({ waitUntil: 'networkidle' });
}

// ---------------------------------------------------------------------------
// Browser history helpers — keep page.goBack/goForward out of spec files. (MINCRM-418)
// ---------------------------------------------------------------------------

/** Result returned by navigateBack / navigateForward. */
export interface BrowserHistoryNavigationResult {
  /** The URL pathname after navigation completes. */
  pathname: string;
}

/**
 * Navigates back in browser history and waits for network idle.
 */
export async function navigateBack(
  context: NavBehaviorContext,
): Promise<BrowserHistoryNavigationResult> {
  await context.page.goBack({ waitUntil: 'networkidle' });
  return { pathname: new URL(context.page.url()).pathname };
}

/**
 * Navigates forward in browser history and waits for network idle.
 */
export async function navigateForward(
  context: NavBehaviorContext,
): Promise<BrowserHistoryNavigationResult> {
  await context.page.goForward({ waitUntil: 'networkidle' });
  return { pathname: new URL(context.page.url()).pathname };
}

// ---------------------------------------------------------------------------
// URL wait helpers — keep page.waitForURL() out of spec files. (MINCRM-418)
// ---------------------------------------------------------------------------

/** Result returned by waitForRedirectToDashboard. */
export interface WaitForRedirectResult {
  /** The final pathname after the redirect. */
  pathname: string;
}

/**
 * Waits for the browser to redirect to '/' (dashboard).
 * Used to assert that an admin-only route redirected a non-admin user.
 */
export async function waitForRedirectToDashboard(
  context: NavBehaviorContext,
  timeout = 10_000,
): Promise<WaitForRedirectResult> {
  return waitForRedirectToPath('/', context, timeout);
}

/**
 * Waits for the browser to redirect to the given pathname.
 * Used to assert that a client-side route (e.g. a <Navigate> redirect) has
 * committed, rather than reading page.url() immediately after goto() —
 * networkidle can settle before a JS-driven redirect finishes.
 */
export async function waitForRedirectToPath(
  pathname: string,
  context: NavBehaviorContext,
  timeout = 10_000,
): Promise<WaitForRedirectResult> {
  await context.page
    .waitForURL((url) => new URL(url).pathname === pathname, { timeout })
    .catch(() => null);
  return { pathname: new URL(context.page.url()).pathname };
}

/**
 * Navigates to a URL and waits for network idle.
 */
export async function navigateToUrlAndWait(
  url: string,
  context: NavBehaviorContext,
): Promise<void> {
  await context.page.goto(url, { waitUntil: 'networkidle' });
}

// ---------------------------------------------------------------------------
// Nav-link visibility checks — keep page.isNotVisible() out of spec files.
// (MINCRM-418)
// ---------------------------------------------------------------------------

/**
 * Returns true when the specified nav link (by testid) is absent or hidden.
 */
export async function isNavLinkHidden(
  testId: string,
  context: NavBehaviorContext,
  timeout?: number,
): Promise<boolean> {
  return context.page.isNotVisible([{ type: 'testId', value: testId }], timeout);
}

// ---------------------------------------------------------------------------
// Nav link wait helper — keep page.waitFor() out of spec files. (MINCRM-418)
// ---------------------------------------------------------------------------

/**
 * Waits for the browser to receive a successful GET /api/v1/settings/nav-layout
 * response. Use after navigating to a new page to confirm the nav-layout React
 * Query fetch has completed before asserting nav link visibility (MINCRM-554).
 *
 * @param context - Behavior context with page.
 * @param timeout - Maximum ms to wait. Default 10 000.
 */
export async function waitForNavLayoutFetched(
  context: NavBehaviorContext,
  timeout = 10_000,
): Promise<void> {
  await context.page.waitForResponse(
    (res) => res.url().includes('/api/v1/settings/nav-layout') && res.status() === 200,
    { timeout },
  );
}

/**
 * Waits for a nav link with the given testId to become visible.
 */
export async function waitForNavLink(
  testId: string,
  context: NavBehaviorContext,
  timeout = 10_000,
): Promise<void> {
  await context.page.waitFor(
    [
      { type: 'testId', value: testId },
      { type: 'css', value: `[data-testid="${testId}"]` },
    ],
    'visible',
    { intent: `${testId} nav link becoming visible` },
    timeout,
  );
}

// ---------------------------------------------------------------------------
// assertNavLinkIsVisible() — viewport-aware nav link visibility assertion
// ---------------------------------------------------------------------------

const MOBILE_BREAKPOINT_PX = 1024;

/**
 * Asserts that a nav link for the given destination is visible on the current
 * viewport.
 *
 * - Desktop (≥ 1024 px): checks `nav-top-{destination}` directly.
 * - Mobile (< 1024 px): opens the mobile drawer, checks `nav-top-{destination}-mobile`,
 *   then closes the drawer so subsequent actions start from a clean state.
 *
 * @param destination - The route key used in testid construction (e.g. 'reports').
 * @param context - Behavior context with page.
 * @param timeout - Maximum ms to wait for the link. Default 10 000.
 */
export async function assertNavLinkIsVisible(
  destination: string,
  context: NavBehaviorContext,
  timeout = 10_000,
): Promise<void> {
  const viewportWidth = context.page.viewportSize()?.width ?? 1280;

  if (viewportWidth < MOBILE_BREAKPOINT_PX) {
    await openMobileNav(context);
    await context.page.waitFor(
      [
        { type: 'testId', value: `nav-top-${destination}-mobile` },
        { type: 'css', value: `[data-testid="nav-top-${destination}-mobile"]` },
      ],
      'visible',
      { intent: `mobile nav link for ${destination} visible in drawer` },
      timeout,
    );
    await closeMobileNavViaToggle(context);
  } else {
    await context.page.waitFor(
      [
        { type: 'testId', value: `nav-top-${destination}` },
        { type: 'css', value: `[data-testid="nav-top-${destination}"]` },
      ],
      'visible',
      { intent: `desktop nav link for ${destination} visible in top nav` },
      timeout,
    );
  }
}

// ---------------------------------------------------------------------------
// Additional nav-specific DOM check helpers. (MINCRM-418)
// ---------------------------------------------------------------------------

/**
 * Returns true when the hamburger drawer is absent from the DOM.
 * Used to assert the drawer has not been opened yet.
 */
export async function hamburgerDrawerDoesNotExist(context: NavBehaviorContext): Promise<boolean> {
  return context.page.doesNotExist([{ type: 'testId', value: 'nav-hamburger-drawer' }]);
}

/**
 * Waits for a CSS-attribute selector to match a visible element.
 * Used to wait for aria-checked="true" on a nav layout option.
 */
export async function waitForCssSelector(
  cssSelector: string,
  context: NavBehaviorContext,
  timeout = 10_000,
): Promise<void> {
  await context.page.waitFor([{ type: 'css', value: cssSelector }], 'visible', {}, timeout);
}

/**
 * Waits for the browser URL to match a pattern.
 */
export async function waitForUrl(
  urlPattern: string | RegExp | ((url: URL) => boolean),
  context: NavBehaviorContext,
  timeout = 10_000,
): Promise<void> {
  await context.page.waitForURL(urlPattern as Parameters<typeof context.page.waitForURL>[0], {
    timeout,
  });
}

/**
 * Returns true when the mobile-nav-drawer element is absent or hidden.
 */
export async function isMobileNavDrawerHidden(context: NavBehaviorContext): Promise<boolean> {
  return context.page.isNotVisible([{ type: 'testId', value: 'mobile-nav-drawer' }]);
}

// ---------------------------------------------------------------------------
// selectLanguageAndWaitForPatch() — language selector interaction. (MINCRM-418)
// ---------------------------------------------------------------------------

/**
 * Selects a language from an already-resolved language selector locator and
 * waits for the PATCH /api/v1/users/me/language response to confirm the
 * preference was persisted on the server.
 *
 * The response listener is registered BEFORE selectOption fires to guarantee
 * the response is captured even when the mutation fires synchronously in the
 * React onChange handler (avoids the race where waitForResponse is set up after
 * the PATCH has already completed). (MINCRM-418)
 *
 * @param locale  - Locale code to select (e.g. 'es', 'de').
 * @param locator - Already-resolved locator for the language <select> element.
 * @param context - Playwright fixture context.
 */
export async function selectLanguageAndWaitForPatch(
  locale: string,
  locator: SafeLocator,
  context: NavBehaviorContext,
): Promise<void> {
  const patchDone = context.page.waitForResponse(
    (response) =>
      response.url().includes('/api/v1/users/me/language') &&
      response.request().method() === 'PATCH',
  );
  await locator.selectOption(locale);
  await patchDone;
}

/**
 * Asserts that a desktop nav link for the given destination has a specific text value.
 */
export async function expectNavLinkHasText(
  layout: NavLayout,
  destination: string,
  text: string,
  context: NavBehaviorContext,
  message?: string,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const locator = await new NavPage(context).navLinkLocator(layout, destination);
  await expect(locator, message).toHaveText(text);
}

/**
 * Asserts that a desktop nav link for the given destination does NOT have the specified text.
 */
export async function expectNavLinkNotHasText(
  layout: NavLayout,
  destination: string,
  text: string,
  context: NavBehaviorContext,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const locator = await new NavPage(context).navLinkLocator(layout, destination);
  await expect(locator).not.toHaveText(text);
}

/**
 * Asserts that a mobile nav link for the given destination has a specific text value.
 */
export async function expectMobileNavLinkHasText(
  destination: string,
  text: string,
  context: NavBehaviorContext,
  message?: string,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const locator = await new NavPage(context).mobileNavLinkLocator(destination);
  await expect(locator, message).toHaveText(text);
}

/**
 * Asserts that a mobile nav link for the given destination does NOT have the specified text.
 */
export async function expectMobileNavLinkNotHasText(
  destination: string,
  text: string,
  context: NavBehaviorContext,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const locator = await new NavPage(context).mobileNavLinkLocator(destination);
  await expect(locator).not.toHaveText(text);
}

/**
 * Selects a language via the mobile nav drawer's language select and waits for
 * the PATCH /api/v1/users/me/language response to settle.
 */
export async function selectMobileLanguageAndWaitForPatch(
  locale: string,
  context: NavBehaviorContext,
): Promise<void> {
  const locator = await new NavPage(context).mobileLanguageSelectLocator();
  const patchDone = context.page.waitForResponse(
    (response) =>
      response.url().includes('/api/v1/users/me/language') &&
      response.request().method() === 'PATCH',
  );
  await locator.selectOption(locale);
  await patchDone;
}

/**
 * Asserts the mobile nav drawer is visible and the mobile language select is present.
 */
export async function expectMobileNavDrawerVisibleWithLanguageSelect(
  context: NavBehaviorContext,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const drawer = await new NavPage(context).mobileNavDrawerLocator();
  if (drawer === null) throw new Error('mobile nav drawer not found');
  await expect(drawer).toBeVisible();
  const langSelect = await new NavPage(context).mobileLanguageSelectLocator();
  await expect(langSelect, 'language selector must be present in mobile nav drawer').toBeVisible();
}
