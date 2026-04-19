/**
 * UsersPage — Page Object for the MiniCRM user management screen.
 *
 * Covers the admin user list at `/users`. Provides methods for filling the
 * invite form and checking that a user appears in the list.
 *
 * Page Objects interact with UI only — no business logic, no API calls,
 * no assertions.
 *
 * MINCRM-110
 */

import type { PageFacade } from '@framework/fixtures/index.js';

/** Subset of Playwright fixtures required by UsersPage. */
export interface UsersPageContext {
  page: PageFacade;
}

/**
 * Page Object for the MiniCRM user management screen.
 */
export class UsersPage {
  private readonly page: PageFacade;

  static readonly PATH = '/users';

  constructor(context: UsersPageContext) {
    this.page = context.page;
  }

  /**
   * Navigates directly to the users management URL.
   */
  async navigate(): Promise<void> {
    await this.page.goto(UsersPage.PATH);
  }

  /**
   * Returns whether the users page is loaded (invite form visible).
   */
  async isLoaded(): Promise<boolean> {
    try {
      await this.page
        .locate([
          { type: 'testId', value: 'invite-submit' },
          { type: 'role', value: 'button', options: { name: 'Invite', exact: false } },
        ])
        .resolve();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Fills the invite user form fields.
   *
   * @param name - User display name.
   * @param email - User email address.
   * @param role - 'admin' | 'rep'.
   */
  async fillInviteForm(name: string, email: string, role: 'admin' | 'rep'): Promise<void> {
    await this.page.fill(name, [
      { type: 'testId', value: 'invite-name' },
      { type: 'label', value: 'Name', options: { exact: false } },
    ]);
    await this.page.fill(email, [
      { type: 'testId', value: 'invite-email' },
      { type: 'label', value: 'Email', options: { exact: false } },
    ]);
    // Role is a <select> — resolve via HealingLocator then call selectOption on the result.
    const roleSelect = await this.page
      .locate([
        { type: 'testId', value: 'invite-role' },
        { type: 'css', value: '[data-testid="invite-role"]' },
      ])
      .resolve();
    await roleSelect.selectOption(role);
  }

  /**
   * Submits the invite form.
   */
  async submitInvite(): Promise<void> {
    await this.page.click([
      { type: 'testId', value: 'invite-submit' },
      { type: 'role', value: 'button', options: { name: 'Invite', exact: false } },
    ]);
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * Returns whether a user card is visible in the list (mobile or desktop).
   *
   * Checks both the mobile card testid and a text-based fallback so this works
   * across desktop and mobile-web Playwright projects.
   *
   * @param userId - User UUID.
   */
  async userCardIsVisible(userId: string): Promise<boolean> {
    await this.page.waitForLoadState('networkidle');
    // Try the mobile card testid first via HealingLocator.
    try {
      const card = await this.page
        .locate([
          { type: 'testId', value: `user-card-${userId}` },
          { type: 'css', value: `[data-testid="user-card-${userId}"]` },
        ])
        .resolve();
      if ((await card.count()) > 0) return true;
    } catch {
      // No mobile card — try the desktop row action button fallback.
    }
    // Desktop renders rows without user-card-* testids — fall back to action button.
    try {
      const action = await this.page
        .locate([
          { type: 'testId', value: `user-actions-${userId}` },
          { type: 'css', value: `[data-testid="user-actions-${userId}"]` },
        ])
        .resolve();
      return (await action.count()) > 0;
    } catch {
      return false;
    }
  }

  /**
   * Returns the current page URL.
   */
  url(): string {
    return this.page.url();
  }
}
