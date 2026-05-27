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
        .locate(
          [
            { type: 'testId', value: 'invite-submit' },
            { type: 'role', value: 'button', options: { name: 'Invite', exact: false } },
          ],
          { intent: 'invite submit button indicating users page is loaded' },
        )
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
    await this.page.fill(
      name,
      [
        { type: 'testId', value: 'invite-name' },
        { type: 'label', value: 'Name', options: { exact: false } },
      ],
      { intent: 'name input in user invite form' },
    );
    await this.page.fill(
      email,
      [
        { type: 'testId', value: 'invite-email' },
        { type: 'label', value: 'Email', options: { exact: false } },
      ],
      { intent: 'email input in user invite form' },
    );
    // Role is a <select> — resolve via HealingLocator then call selectOption on the result.
    const roleSelect = await this.page
      .locate(
        [
          { type: 'testId', value: 'invite-role' },
          { type: 'css', value: '[data-testid="invite-role"]' },
        ],
        { intent: 'role select dropdown in user invite form' },
      )
      .resolve();
    await roleSelect.selectOption(role);
  }

  /**
   * Submits the invite form.
   */
  async submitInvite(): Promise<void> {
    await this.page.click(
      [
        { type: 'testId', value: 'invite-submit' },
        { type: 'role', value: 'button', options: { name: 'Invite', exact: false } },
      ],
      { intent: 'submit button to send user invite' },
    );
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * Returns whether a user card is visible in the list.
   *
   * @param userId - User UUID.
   */
  async userCardIsVisible(userId: string): Promise<boolean> {
    await this.page.waitForLoadState('networkidle');
    try {
      const card = await this.page
        .locate(
          [
            { type: 'testId', value: `user-card-${userId}` },
            { type: 'css', value: `[data-testid="user-card-${userId}"]` },
          ],
          { intent: 'user card in the users management list' },
        )
        .resolve();
      return (await card.count()) > 0;
    } catch {
      return false;
    }
  }

  /**
   * Opens the actions menu for a given user row.
   *
   * @param userId - User UUID.
   */
  async openActionsMenu(userId: string): Promise<void> {
    // Desktop renders data-testid="user-actions-{id}"; mobile prefixes with "mobile-".
    // Both are in the DOM simultaneously but only one is visible at the current viewport.
    await this.page.click(
      [
        { type: 'testId', value: `user-actions-${userId}` },
        { type: 'testId', value: `mobile-user-actions-${userId}` },
        { type: 'role', value: 'button', options: { name: /actions/i } },
      ],
      { intent: 'meatball actions menu trigger button for a user row' },
    );
  }

  /**
   * Clicks the Reset onboarding menu item for a given user.
   * The actions menu must already be open.
   *
   * @param userId - User UUID.
   */
  async clickResetOnboarding(userId: string): Promise<void> {
    await this.page.click(
      [
        { type: 'testId', value: `reset-onboarding-${userId}` },
        { type: 'role', value: 'menuitem', options: { name: /reset onboarding/i } },
      ],
      { intent: 'reset onboarding menu item in the user actions menu' },
    );
  }

  /**
   * Returns a resolved locator for the reset onboarding confirmation dialog.
   */
  async resetOnboardingDialogLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'reset-onboarding-dialog' },
          { type: 'role', value: 'dialog', options: { name: /reset onboarding/i } },
        ],
        { intent: 'confirmation dialog for resetting a user onboarding checklist' },
      )
      .resolve();
  }

  /**
   * Clicks the confirm button in the reset onboarding confirmation dialog.
   */
  async confirmResetOnboarding(): Promise<void> {
    await this.page.click(
      [
        { type: 'testId', value: 'reset-onboarding-confirm' },
        { type: 'role', value: 'button', options: { name: /reset/i } },
      ],
      { intent: 'confirm button in the reset onboarding confirmation dialog' },
    );
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * Clicks the cancel button in the reset onboarding confirmation dialog.
   */
  async cancelResetOnboarding(): Promise<void> {
    await this.page.click(
      [
        { type: 'testId', value: 'reset-onboarding-cancel' },
        { type: 'role', value: 'button', options: { name: /cancel/i } },
      ],
      { intent: 'cancel button in the reset onboarding confirmation dialog' },
    );
  }

  /**
   * Returns a resolved locator for the reset onboarding success toast.
   */
  async resetOnboardingSuccessLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'reset-onboarding-success' },
          { type: 'role', value: 'status' },
        ],
        { intent: 'success toast shown after resetting a user onboarding checklist' },
      )
      .resolve();
  }

  /**
   * Paginates through the user list until the card for userId is visible,
   * then stops. Throws if the card is not found after exhausting all pages.
   *
   * The user list is sorted oldest-first, so a newly-created ephemeral user
   * in a shared E2E DB may appear on a page beyond the first. This method
   * handles that case so callers don't need to know which page the user is on.
   *
   * @param userId - User UUID to find.
   */
  async navigateToUserCard(userId: string): Promise<void> {
    await this.page.waitForLoadState('networkidle');
    const MAX_PAGES = 20;
    for (let pageNum = 1; pageNum <= MAX_PAGES; pageNum++) {
      // Check if the card is visible on the current page.
      try {
        const card = await this.page
          .locate(
            [
              { type: 'testId', value: `user-card-${userId}` },
              { type: 'css', value: `[data-testid="user-card-${userId}"]` },
            ],
            { intent: 'user card in the users management list', fallbackTimeout: 2_000 },
          )
          .resolve();
        if ((await card.count()) > 0) return;
      } catch {
        // Card not on this page — try next.
      }

      // Click "Next" if available; otherwise the card doesn't exist.
      try {
        await this.page.click(
          [
            { type: 'testId', value: 'pagination-next' },
            { type: 'role', value: 'button', options: { name: /next/i } },
          ],
          { intent: 'next page button in user list pagination', fallbackTimeout: 3_000 },
        );
        await this.page.waitForLoadState('networkidle');
      } catch {
        throw new Error(`[UsersPage] User card ${userId} not found after ${pageNum} page(s)`);
      }
    }
    throw new Error(`[UsersPage] User card ${userId} not found after ${MAX_PAGES} pages`);
  }

  /**
   * Returns the current page URL.
   */
  url(): string {
    return this.page.url();
  }
}
