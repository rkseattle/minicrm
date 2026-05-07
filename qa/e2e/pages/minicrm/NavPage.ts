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
   * Returns the current page URL.
   */
  url(): string {
    return this.page.url();
  }
}
