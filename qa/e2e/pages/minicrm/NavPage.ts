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
 * MINCRM-344
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
   * Clicks the mobile (NavTop) menu toggle button.
   */
  async clickMenuToggle(): Promise<void> {
    await this.page.click(
      [
        { type: 'testId', value: 'nav-mobile-toggle' },
        { type: 'role', value: 'button', options: { name: 'Menu', exact: false } },
      ],
      { intent: 'mobile nav menu toggle button in navigation' },
    );
  }

  /**
   * Clicks the hamburger layout (NavHamburger) toggle button.
   */
  async clickHamburgerToggle(): Promise<void> {
    await this.page.click(
      [
        { type: 'testId', value: 'nav-hamburger-toggle' },
        { type: 'role', value: 'button', options: { name: 'Menu', exact: false } },
      ],
      { intent: 'hamburger layout menu toggle button in navigation' },
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
          { type: 'testId', value: 'nav-mobile-toggle' },
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
          { type: 'testId', value: 'nav-mobile-toggle' },
          { type: 'role', value: 'button', options: { name: 'Close', exact: false } },
        ],
        { intent: 'mobile menu close button — force click to bypass overlap' },
      )
      .resolve();
    await toggle.click({ force: true });
  }

  /**
   * Clicks the mobile logout button inside the mobile nav drawer.
   * Assumes the mobile drawer is already open.
   */
  async clickMobileLogout(): Promise<void> {
    await this.page.click(
      [
        { type: 'testId', value: 'nav-logout-mobile' },
        { type: 'role', value: 'button', options: { name: t('nav.logout'), exact: false } },
      ],
      { intent: 'logout button inside the mobile nav drawer' },
    );
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
   * Returns a resolved locator for the desktop logout button.
   * Returns null if the button is not in the DOM.
   */
  async desktopLogoutLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'nav-logout' },
          { type: 'role', value: 'button', options: { name: t('nav.logout'), exact: false } },
        ],
        { intent: 'desktop logout button in navigation chrome' },
      )
      .resolve()
      .catch(() => null);
  }

  /**
   * Clicks the desktop logout button.
   */
  async clickDesktopLogout(): Promise<void> {
    await this.page.click(
      [
        { type: 'testId', value: 'nav-logout' },
        { type: 'role', value: 'button', options: { name: t('nav.logout'), exact: false } },
      ],
      { intent: 'desktop logout button in navigation' },
    );
  }

  /**
   * Returns a resolved locator for the hamburger drawer element.
   * Returns null if the drawer is not in the DOM.
   */
  async hamburgerDrawerLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'nav-hamburger-drawer' },
          { type: 'role', value: 'dialog', options: { name: /menu|navigation/i } },
        ],
        { intent: 'hamburger nav drawer overlay' },
      )
      .resolve()
      .catch(() => null);
  }

  /**
   * Returns a resolved locator for the mobile nav drawer element.
   * Returns null if the drawer is not in the DOM.
   */
  async mobileNavDrawerLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'mobile-nav-drawer' },
          { type: 'role', value: 'dialog', options: { name: /menu|navigation/i } },
        ],
        { intent: 'mobile nav drawer overlay' },
      )
      .resolve()
      .catch(() => null);
  }

  /**
   * Returns a resolved locator for the desktop language select in the nav header.
   */
  async desktopLanguageSelectLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'nav-language-select' },
          { type: 'role', value: 'combobox', options: { name: /language/i } },
        ],
        { intent: 'language selector in the desktop nav header' },
      )
      .resolve();
  }

  /**
   * Returns a resolved locator for the mobile language select in the nav drawer.
   */
  async mobileLanguageSelectLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'nav-language-select-mobile' },
          { type: 'role', value: 'combobox', options: { name: /language/i } },
        ],
        { intent: 'language selector in the mobile nav drawer' },
      )
      .resolve();
  }

  /**
   * Returns a resolved locator for the mobile logout button.
   */
  async mobileLogoutButtonLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'nav-logout-mobile' },
          { type: 'role', value: 'button', options: { name: t('nav.logout'), exact: false } },
        ],
        { intent: 'logout button in the mobile nav drawer' },
      )
      .resolve();
  }

  /**
   * Returns a resolved locator for a nav link by layout and destination.
   * Throws StrategyExhaustedError if the link is not found.
   */
  async navLinkLocator(layout: string, destination: string) {
    const testId = `nav-${layout}-${destination}`;
    return this.page
      .locate(
        [
          { type: 'testId', value: testId },
          { type: 'role', value: 'link', options: { name: new RegExp(destination, 'i') } },
        ],
        { intent: `${layout} nav link for ${destination}` },
      )
      .resolve();
  }

  /**
   * Returns a resolved locator for the hamburger layout toggle button.
   * Throws StrategyExhaustedError if the toggle is not in the DOM.
   */
  async menuToggleLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'nav-hamburger-toggle' },
          { type: 'role', value: 'button', options: { name: 'Menu', exact: false } },
        ],
        { intent: 'hamburger layout menu toggle button in navigation' },
      )
      .resolve();
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
    return this.page
      .locate(
        [
          { type: 'testId', value: testId },
          { type: 'css', value: `[data-testid="${testId}"]` },
        ],
        { intent: `administration section divider in the ${layout} nav layout` },
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
