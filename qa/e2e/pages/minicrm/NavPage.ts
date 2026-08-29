/**
 * NavPage — Page Object for MiniCRM navigation controls.
 *
 * Covers interactions with the navigation chrome that is present on every
 * authenticated page: the hamburger toggle, mobile drawer, and logout button.
 * This is a cross-cutting page object — it has no route of its own.
 *
 * Page Objects interact with UI only — no business logic, no API calls,
 * no assertions.
 *
 *
 */

import type { PageFacade } from '@framework/fixtures/index.js';
import { t } from '@framework/i18n/locale.js';

/** Subset of Playwright fixtures required by NavPage. */
export interface NavPageContext {
  page: PageFacade;
}

/**
 * Page Object for MiniCRM navigation controls.
 */
export class NavPage {
  private readonly page: PageFacade;

  constructor(context: NavPageContext) {
    this.page = context.page;
  }

  /**
   * Clicks the hamburger / mobile menu toggle button.
   */
  async clickMenuToggle(): Promise<void> {
    await this.page.click(
      [
        { type: 'testId', value: 'nav-menu-toggle' },
        { type: 'role', value: 'button', options: { name: 'Menu', exact: false } },
      ],
      { intent: 'hamburger or mobile menu toggle button in navigation' },
    );
  }

  /**
   * Clicks the mobile menu toggle with force:true, bypassing Playwright's
   * pointer-intercept check. Use on mobile viewports where the global-search-input
   * overlaps the toggle button.
   */
  async clickMenuToggleForce(): Promise<void> {
    const toggle = await this.page
      .locate(
        [
          { type: 'testId', value: 'nav-menu-toggle' },
          { type: 'role', value: 'button', options: { name: 'Menu', exact: false } },
        ],
        { intent: 'mobile menu toggle button — force click to bypass overlap' },
      )
      .resolve();
    await toggle.click({ force: true });
  }

  /**
   * Clicks the mobile menu close button (shows X when drawer is open) with
   * force:true, bypassing Playwright's pointer-intercept check.
   */
  async clickMenuCloseForce(): Promise<void> {
    const toggle = await this.page
      .locate(
        [
          { type: 'testId', value: 'nav-menu-toggle' },
          { type: 'role', value: 'button', options: { name: 'Close', exact: false } },
        ],
        { intent: 'mobile menu close button — force click to bypass overlap' },
      )
      .resolve();
    await toggle.click({ force: true });
  }

  /**
   * Opens the header's user menu, which holds Profile Settings, the language
   * preference, and logout at every viewport width. A no-op when already open —
   * the trigger toggles, so a second click would close it under a caller that
   * expects an open menu.
   *
   * Force-clicked for the same reason as clickMenuToggleForce: the global search
   * input overlaps this corner of the header on mobile viewports.
   */
  async openUserMenu(): Promise<void> {
    const trigger = await this.page
      .locate(
        [
          { type: 'testId', value: 'nav-user-menu-button' },
          // The trigger's accessible name is its aria-label, which interpolates the
          // signed-in user's name, so match on the fixed prefix before the placeholder.
          {
            type: 'role',
            value: 'button',
            options: { name: t('nav.userMenuTrigger').split('{{')[0].trim(), exact: false },
          },
        ],
        { intent: 'user menu trigger — force click to bypass search overlap' },
      )
      .resolve();
    if ((await trigger.getAttribute('aria-expanded')) === 'true') return;
    await trigger.click({ force: true });
  }

  /**
   * Clicks the close button inside the hamburger nav drawer.
   * Assumes the hamburger drawer is already open.
   */
  async clickHamburgerClose(): Promise<void> {
    await this.page.click(
      [
        { type: 'testId', value: 'nav-hamburger-close' },
        { type: 'css', value: '[data-testid="nav-hamburger-close"]' },
      ],
      { intent: 'close button inside the hamburger nav drawer' },
    );
  }

  /**
   * Clicks the Profile Settings item. Assumes the user menu is already open.
   */
  async clickUserMenuProfile(): Promise<void> {
    await this.page.click(
      [
        { type: 'testId', value: 'nav-user-menu-profile' },
        {
          type: 'role',
          value: 'menuitem',
          options: { name: t('nav.profileSettings'), exact: false },
        },
      ],
      { intent: 'Profile Settings item inside the user menu' },
    );
  }

  /**
   * Returns a resolved locator for the logout item. Assumes the user menu is open.
   */
  async logoutItemLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'nav-logout' },
          { type: 'role', value: 'menuitem', options: { name: t('nav.logout'), exact: false } },
        ],
        { intent: 'logout item inside the user menu' },
      )
      .resolve(timeout);
  }

  /**
   * Clicks the logout item. Assumes the user menu is already open.
   */
  async clickLogout(): Promise<void> {
    await this.page.click(
      [
        { type: 'testId', value: 'nav-logout' },
        { type: 'role', value: 'menuitem', options: { name: t('nav.logout'), exact: false } },
      ],
      { intent: 'logout item inside the user menu' },
    );
  }

  /**
   * Returns a resolved locator for the hamburger drawer element, or null if absent.
   *
   * Returns null when the drawer is not mounted (e.g. closed or not yet opened).
   * Use in behavior-layer code for conditional presence checks.
   * In spec files where the drawer must be present, use `requireHamburgerDrawerLocator`.
   */
  async hamburgerDrawerLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'nav-hamburger-drawer' },
          { type: 'role', value: 'dialog', options: { name: /menu|navigation/i } },
        ],
        { intent: 'hamburger nav drawer overlay' },
      )
      .resolve(timeout)
      .catch(() => null);
  }

  /**
   * Returns a resolved locator for the hamburger drawer element.
   * Throws if the drawer is not found — call only after opening the drawer.
   */
  async requireHamburgerDrawerLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'nav-hamburger-drawer' },
          { type: 'role', value: 'dialog', options: { name: /menu|navigation/i } },
        ],
        { intent: 'hamburger nav drawer overlay' },
      )
      .resolve(timeout);
  }

  /**
   * Returns a resolved locator for the mobile nav drawer element, or null if absent.
   *
   * Returns null when the drawer is not mounted (e.g. closed or not yet opened).
   * Use in behavior-layer code for conditional presence checks.
   * In spec files where the drawer must be present, use `requireMobileNavDrawerLocator`.
   */
  async mobileNavDrawerLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'mobile-nav-drawer' },
          { type: 'role', value: 'dialog', options: { name: /menu|navigation/i } },
        ],
        { intent: 'mobile nav drawer overlay' },
      )
      .resolve(timeout)
      .catch(() => null);
  }

  /**
   * Returns a resolved locator for the mobile nav drawer element.
   * Throws if the drawer is not found — call only after opening the drawer.
   */
  async requireMobileNavDrawerLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'mobile-nav-drawer' },
          { type: 'role', value: 'dialog', options: { name: /menu|navigation/i } },
        ],
        { intent: 'mobile nav drawer overlay' },
      )
      .resolve(timeout);
  }

  /**
   * Returns a resolved locator for the language select. Assumes the user menu is
   * already open.
   *
   * The role fallback resolves its name through t(), like the logout strategies: a
   * hardcoded English pattern matches nothing in the other four locales.
   */
  async languageSelectLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'nav-language-select' },
          {
            type: 'role',
            value: 'combobox',
            options: { name: t('nav.languageSelector'), exact: false },
          },
        ],
        { intent: 'language selector inside the user menu' },
      )
      .resolve(timeout);
  }

  /**
   * Returns a resolved locator for a nav link by layout and destination.
   * Throws StrategyExhaustedError if the link is not found.
   */
  async navLinkLocator(layout: string, destination: string) {
    const testId = `nav-${layout}-${destination}`;
    // Both strategies target the same testId. The css fallback avoids the old
    // role("link", {name: /destination/i}) fallback which could match unrelated
    // page-content links and cause navigateViaNavLink to click the wrong element
    // (returning linkClicked:true but landing on the wrong URL).
    // fallbackTimeout of 8s allows admin-only links (users, automation, settings)
    // time to render after the auth query confirms role on slow CI machines.
    return this.page
      .locate(
        [
          { type: 'testId', value: testId },
          { type: 'css', value: `[data-testid="${testId}"]` },
        ],
        { intent: `${layout} nav link for ${destination}`, fallbackTimeout: 8_000 },
      )
      .resolve();
  }

  /**
   * Returns a resolved locator for the hamburger menu toggle button.
   * Throws StrategyExhaustedError if the toggle is not in the DOM.
   */
  async menuToggleLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'nav-menu-toggle' },
          { type: 'role', value: 'button', options: { name: 'Menu', exact: false } },
        ],
        { intent: 'hamburger or mobile menu toggle button in navigation' },
      )
      .resolve(timeout);
  }

  /**
   * Returns a resolved locator for the admin section divider in a given layout.
   * Throws StrategyExhaustedError if the divider is not in the DOM.
   *
   * @param layout - 'left', 'top', 'hamburger', or 'top-mobile'.
   */
  async adminSectionDividerLocator(layout: 'left' | 'top' | 'hamburger' | 'top-mobile') {
    const testId =
      layout === 'top-mobile'
        ? 'nav-top-admin-section-divider-mobile'
        : `nav-${layout}-admin-section-divider`;

    // The divider is only rendered once the auth query resolves and the user's
    // role is confirmed as 'admin' — visibleLinks filters out adminOnly links
    // while user is null (loading). networkidle on page.goto does not guarantee
    // React has committed the auth state. Wait for the Users nav link (the first
    // admin-only link, which triggers the divider render) to appear in the DOM
    // before resolving the divider locator.
    const usersTestId = layout === 'top-mobile' ? 'nav-top-users-mobile' : `nav-${layout}-users`;
    await this.page
      .locate(
        [
          { type: 'testId', value: usersTestId },
          { type: 'css', value: `[data-testid="${usersTestId}"]` },
        ],
        {
          intent: `Users admin nav link confirming auth state has resolved and admin links are rendered`,
          fallbackTimeout: 15_000,
        },
      )
      .resolve();

    return this.page
      .locate(
        [
          { type: 'testId', value: testId },
          { type: 'css', value: `[data-testid="${testId}"]` },
        ],
        {
          intent: `administration section divider in the ${layout} nav layout`,
          fallbackTimeout: 5_000,
        },
      )
      .resolve();
  }

  /**
   * Returns a resolved locator for a mobile nav link (nav-top-{destination}-mobile).
   * Throws StrategyExhaustedError if the link is not found.
   */
  async mobileNavLinkLocator(destination: string) {
    const testId = `nav-top-${destination}-mobile`;
    return this.page
      .locate(
        [
          { type: 'testId', value: testId },
          { type: 'role', value: 'link', options: { name: new RegExp(destination, 'i') } },
        ],
        { intent: `mobile nav link for ${destination}` },
      )
      .resolve();
  }

  /**
   * Returns the current page URL.
   */
  url(): string {
    return this.page.url();
  }
}
