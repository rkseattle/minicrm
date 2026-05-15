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

import type { PageFacade } from '@framework/fixtures/index.js';
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
  // Wait for the toggle to be stable before clicking — after a route navigation
  // NavHamburger remounts and resets menuOpen to false. Clicking before the new
  // instance has fully mounted either fires on the old instance (ignored) or
  // before setMenuOpen is wired up, so the drawer never appears.
  await context.page.waitFor(
    [
      { type: 'testId', value: 'nav-menu-toggle' },
      { type: 'role', value: 'button', options: { name: 'Menu', exact: false } },
    ],
    'visible',
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

  // On hamburger layout, the drawer's focus-on-open effect causes a layout
  // shift that triggers Playwright's stability check. Use force:true to bypass
  // the stability wait — visibility has already been confirmed above.
  await link.click({ force: layout === 'hamburger' });

  // Wait for the URL to change from its pre-click value. Falls back to a short
  // domcontentloaded wait if waitForURL times out (e.g. clicking the already-active
  // link on dashboard, where the URL stays '/').
  await context.page
    .waitForURL((url) => url.href !== urlBefore, { timeout: 10_000 })
    .catch(() => context.page.waitForLoadState('domcontentloaded').catch(() => null));

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
// Locator-accessor behaviors — wrap NavPage locators
// so spec files never import @pages/* directly. (MINCRM-367)
// ---------------------------------------------------------------------------

/** Fixture context accepted by nav locator behaviors. */
export interface NavBehaviorContext {
  page: PageFacade;
}

/**
 * Returns a resolved locator for a nav link by layout and destination.
 */
export async function getNavLinkLocator(
  layout: string,
  destination: string,
  context: NavBehaviorContext,
) {
  const navPage = new NavPage(context);
  return navPage.navLinkLocator(layout, destination);
}

/**
 * Returns a resolved locator for the admin section divider in a given nav layout.
 */
export async function getAdminSectionDividerLocator(
  layout: 'left' | 'top' | 'hamburger' | 'top-mobile',
  context: NavBehaviorContext,
) {
  const navPage = new NavPage(context);
  return navPage.adminSectionDividerLocator(layout);
}

/**
 * Returns a resolved locator for the hamburger nav drawer.
 * Throws if the drawer is not in the DOM.
 */
export async function getHamburgerDrawerLocator(context: NavBehaviorContext) {
  const navPage = new NavPage(context);
  return navPage.requireHamburgerDrawerLocator();
}

/**
 * Returns a resolved locator for the mobile nav drawer.
 * Throws if the drawer is not in the DOM.
 */
export async function getMobileNavDrawerLocator(context: NavBehaviorContext) {
  const navPage = new NavPage(context);
  return navPage.requireMobileNavDrawerLocator();
}

/**
 * Returns a resolved locator for the hamburger/mobile menu toggle button.
 */
export async function getMenuToggleLocator(context: NavBehaviorContext) {
  const navPage = new NavPage(context);
  return navPage.menuToggleLocator();
}

/**
 * Returns a resolved locator for a mobile nav link by destination key.
 */
export async function getMobileNavLinkLocator(destination: string, context: NavBehaviorContext) {
  const navPage = new NavPage(context);
  return navPage.mobileNavLinkLocator(destination);
}

/**
 * Returns a resolved locator for the mobile logout button in the nav drawer.
 */
export async function getMobileLogoutButtonLocator(context: NavBehaviorContext) {
  const navPage = new NavPage(context);
  return navPage.mobileLogoutButtonLocator();
}

/**
 * Returns a resolved locator for the mobile language select in the nav drawer.
 */
export async function getMobileLanguageSelectLocator(context: NavBehaviorContext) {
  const navPage = new NavPage(context);
  return navPage.mobileLanguageSelectLocator();
}

/**
 * Returns a resolved locator for the desktop language select in the nav header.
 */
export async function getDesktopLanguageSelectLocator(context: NavBehaviorContext) {
  const navPage = new NavPage(context);
  return navPage.desktopLanguageSelectLocator();
}
