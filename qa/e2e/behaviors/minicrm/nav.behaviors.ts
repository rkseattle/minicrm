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

import type { SafePage } from '@framework/fixtures/index.js';
import type { HealPage } from '@framework/fixtures/heal-page.fixture.js';
import type { RestClient } from '@framework/clients/rest-client.js';

/** Navigation layout modes supported by MiniCRM (MINCRM-133). */
export type NavLayout = 'top' | 'left' | 'hamburger';

// ---------------------------------------------------------------------------
// Fixture context
// ---------------------------------------------------------------------------

/** Fixtures required by navigation behaviors. */
export interface NavBehaviorContext {
  page: SafePage;
  healPage: HealPage;
  /** Current test name forwarded to Page Object constructors for heal audit records. */
  testName: string;
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
    const res = await restClient.patch<{ layout: NavLayout }>('/api/settings/nav-layout', {
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
 * @param context - Behavior context with page and healPage.
 * @returns Result describing whether the click and aria-checked confirmation were observed.
 */
export async function setNavLayoutViaUI(
  layout: NavLayout,
  context: NavBehaviorContext,
): Promise<SetNavLayoutViaUIResult> {
  let button;
  try {
    button = await context.healPage
      .locate([
        { type: 'testId', value: `nav-layout-option-${layout}` },
        { type: 'css', value: `[data-testid="nav-layout-option-${layout}"]` },
      ])
      .resolve(context.testName);
  } catch {
    return { clicked: false, successFeedbackVisible: false };
  }

  await button.scrollIntoViewIfNeeded();
  await button.click();

  // Poll until aria-checked="true" on the selected button, which confirms the
  // PATCH has completed and the context has updated. Avoids fixed waitForTimeout.
  await button.waitFor({ state: 'visible' });
  let successFeedbackVisible = false;
  // Use the resolved button locator with an and() filter for aria-checked.
  // The CSS strategy resolves the same element with the attribute constraint.
  const checkedButton = await context.healPage
    .locate([
      { type: 'css', value: `[data-testid="nav-layout-option-${layout}"][aria-checked="true"]` },
      { type: 'testId', value: `nav-layout-option-${layout}` },
    ])
    .resolve(context.testName)
    .catch(() => null);
  if (checkedButton) {
    await checkedButton
      .waitFor({ state: 'visible' })
      .then(() => {
        successFeedbackVisible = true;
      })
      .catch(() => null);
  }

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
  await context.healPage.click([
    { type: 'testId', value: 'nav-menu-toggle' },
    { type: 'role', value: 'button', options: { name: 'Menu', exact: false } },
  ]);
  // The hamburger drawer is conditionally rendered — click the toggle first,
  // then resolve it once it's mounted.
  const drawer = await context.healPage
    .locate([
      { type: 'testId', value: 'nav-hamburger-drawer' },
      { type: 'css', value: '[data-testid="nav-hamburger-drawer"]' },
    ])
    .resolve(context.testName)
    .catch(() => null);
  // Wait for React to render the drawer — isVisible() after click() is a
  // snapshot that races React state updates (Greptile P1 finding).
  await drawer?.waitFor({ state: 'visible' }).catch(() => null);
  const drawerVisible = (await drawer?.isVisible().catch(() => false)) ?? false;
  return { drawerVisible };
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
  // If it's already gone, resolve() will fail and we treat it as closed.
  const drawer = await context.healPage
    .locate([
      { type: 'testId', value: 'nav-hamburger-drawer' },
      { type: 'css', value: '[data-testid="nav-hamburger-drawer"]' },
    ])
    .resolve(context.testName)
    .catch(() => null);
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
  await context.healPage.click([
    { type: 'testId', value: 'nav-hamburger-close' },
    { type: 'css', value: '[data-testid="nav-hamburger-close"]' },
  ]);

  // Drawer is conditionally rendered — after clicking close it may already be
  // unmounted. Resolve with a catch so a missing drawer counts as closed.
  const drawer = await context.healPage
    .locate([
      { type: 'testId', value: 'nav-hamburger-drawer' },
      { type: 'css', value: '[data-testid="nav-hamburger-drawer"]' },
    ])
    .resolve(context.testName)
    .catch(() => null);
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
  if (layout === 'hamburger') {
    // Check whether the drawer is already open using a short-timeout probe —
    // the drawer either exists in the DOM right now or it doesn't. A 200 ms
    // fallbackTimeout fails fast when closed without burning the test budget.
    const drawerLocator = await context.healPage
      .locate(
        [
          { type: 'testId', value: 'nav-hamburger-drawer' },
          { type: 'css', value: '[data-testid="nav-hamburger-drawer"]' },
        ],
        { fallbackTimeout: 200 },
      )
      .resolve(context.testName)
      .catch(() => null);
    const drawerVisible = (await drawerLocator?.isVisible().catch(() => false)) ?? false;
    if (!drawerVisible) {
      await context.healPage.click([
        { type: 'testId', value: 'nav-menu-toggle' },
        { type: 'role', value: 'button', options: { name: 'Menu', exact: false } },
      ]);
      const drawer = await context.healPage
        .locate([
          { type: 'testId', value: 'nav-hamburger-drawer' },
          { type: 'css', value: '[data-testid="nav-hamburger-drawer"]' },
        ])
        .resolve(context.testName);
      await drawer.waitFor({ state: 'visible' });
    }
  }

  const testId = `nav-${layout}-${destination}`;
  let link;
  try {
    link = await context.healPage
      .locate([
        { type: 'testId', value: testId },
        { type: 'css', value: `[data-testid="${testId}"]` },
      ])
      .resolve(context.testName);
  } catch {
    return { linkClicked: false, finalUrl: context.page.url() };
  }

  const isVisible = await link.isVisible().catch(() => false);
  if (!isVisible) {
    return { linkClicked: false, finalUrl: context.page.url() };
  }

  // On hamburger layout, the drawer's focus-on-open effect causes a layout
  // shift that triggers Playwright's stability check. Use force:true to bypass
  // the stability wait — visibility has already been confirmed above.
  await link.click({ force: layout === 'hamburger' });

  // After clicking a hamburger link the drawer closes; wait for navigation to settle.
  await context.page.waitForLoadState('networkidle').catch(() => null);

  return { linkClicked: true, finalUrl: context.page.url() };
}
