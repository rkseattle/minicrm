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

import type { Page } from '@playwright/test';
import type { HealPage } from '@framework/fixtures/heal-page.fixture.js';

/** Subset of Playwright fixtures required by UsersPage. */
export interface UsersPageContext {
  page: Page;
  healPage: HealPage;
  testName: string;
}

/**
 * Page Object for the MiniCRM user management screen.
 */
export class UsersPage {
  private readonly page: Page;
  private readonly healPage: HealPage;
  private readonly testName: string;

  static readonly PATH = '/users';

  constructor(context: UsersPageContext) {
    this.page = context.page;
    this.healPage = context.healPage;
    this.testName = context.testName;
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
      await this.healPage
        .locate([
          { type: 'testId', value: 'invite-submit' },
          { type: 'role', value: 'button', options: { name: 'Invite', exact: false } },
        ])
        .resolve(this.testName);
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
    await this.healPage.fill(name, [
      { type: 'testId', value: 'invite-name' },
      { type: 'label', value: 'Name', options: { exact: false } },
    ]);
    await this.healPage.fill(email, [
      { type: 'testId', value: 'invite-email' },
      { type: 'label', value: 'Email', options: { exact: false } },
    ]);
    // Role is a <select> — use selectOption directly; testId as CSS selector fallback.
    const roleSelect = this.page.locator('[data-testid="invite-role"]');
    await roleSelect.selectOption(role);
  }

  /**
   * Submits the invite form.
   */
  async submitInvite(): Promise<void> {
    await this.healPage.click([
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
    const card = this.page.locator(`[data-testid="user-card-${userId}"]`);
    // Desktop renders rows without user-card-* testids — fall back to email text.
    const byCard = await card.count();
    if (byCard > 0) return true;
    // Row-level fallback: any element containing the userId (e.g. action buttons).
    const byAction = await this.page.locator(`[data-testid="user-actions-${userId}"]`).count();
    return byAction > 0;
  }

  /**
   * Returns the current page URL.
   */
  url(): string {
    return this.page.url();
  }
}
