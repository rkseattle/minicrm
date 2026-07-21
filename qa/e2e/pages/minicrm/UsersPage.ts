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
   * Returns whether the users page is loaded (invite form toggle visible).
   *
   * Uses the collapse-toggle button, which is always in the DOM regardless of
   * whether the invite form is open or closed. The submit button lives inside
   * {isOpen && ...} and is absent in the DOM on mobile where the form starts
   * collapsed — making it a poor readiness signal. (heal-trends)
   */
  async isLoaded(): Promise<boolean> {
    try {
      await this.page
        .locate(
          [
            { type: 'testId', value: 'invite-form-toggle' },
            { type: 'role', value: 'button', options: { name: /invite/i } },
          ],
          { intent: 'invite form toggle button indicating users page is loaded' },
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
   * @param role - Role to assign.
   */
  async fillInviteForm(
    name: string,
    email: string,
    role: 'admin' | 'rep' | 'viewer' | 'manager' | 'service_account',
  ): Promise<void> {
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
      // Extended timeout: on mobile the form starts collapsed and the caller
      // must open it first. After the collapse animation completes, the button
      // is attached but may still be mid-transition within the 2 s default
      // window. (heal-trends)
      { intent: 'submit button to send user invite', fallbackTimeout: 6_000 },
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
    // The role fallback is scoped `within` this user's row: on a shared E2E
    // database, other users' rows are visible on the same page, and an
    // unscoped `role: button, name: /actions/i` fallback would resolve to
    // whichever such button happens to be the sole match at probe time —
    // silently opening a DIFFERENT user's actions menu with no error (see
    // MINCRM-410 F-OB8 CI failure).
    await this.page.click(
      [
        { type: 'testId', value: `user-actions-${userId}` },
        { type: 'testId', value: `mobile-user-actions-${userId}` },
        {
          type: 'role',
          value: 'button',
          options: { name: /actions/i },
          within: `user-card-${userId}`,
        },
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
    // Desktop renders data-testid="reset-onboarding-{id}"; mobile prefixes
    // with "mobile-" — same dual-rendering pattern as openActionsMenu above
    // (UserActionsMenu.tsx's testIdPrefix prop).
    await this.page.click(
      [
        { type: 'testId', value: `reset-onboarding-${userId}` },
        { type: 'testId', value: `mobile-reset-onboarding-${userId}` },
        // Scoped `within` this user's row for the same reason as
        // openActionsMenu above — the menu renders in-place (no portal), so
        // scoping to the row also correctly excludes any other user's menu
        // that might still be in the DOM.
        {
          type: 'role',
          value: 'menuitem',
          options: { name: /reset onboarding/i },
          within: `user-card-${userId}`,
        },
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
   * Finds the user card for userId in the user list, starting from the last page.
   * Newly-created ephemeral users are always at the end (oldest-first sort).
   *
   * First switches to the maximum page size (100) to reduce total page count,
   * then jumps to the last page and searches backwards.
   *
   * @param userId - User UUID to find.
   */
  async navigateToUserCard(userId: string): Promise<void> {
    await this.page.waitForLoadState('networkidle');

    // Switch to the largest page size to minimise page count (100 rows/page).
    await this._setPageSize(100);

    if (await this._searchBackwardsFromLastPage(userId)) return;

    // The shared E2E database can gain users from concurrently-running CI
    // shards between the first backward search and now, shifting which page
    // is actually "last" and pushing this user's row past where the first
    // search looked (see MINCRM-410 F-OB8 CI failure). Re-read the total page
    // count and search once more from the (possibly new) last page before
    // giving up — this is a full re-jump, not a resumption, since inserts
    // could have landed anywhere, not just past the original last page.
    if (await this._searchBackwardsFromLastPage(userId)) return;

    throw new Error(`[UsersPage] User card ${userId} not found after two full backward searches`);
  }

  /**
   * Jumps to the current last page and searches backwards for userId's card,
   * up to MAX_BACK pages. Returns true if found (page is left on the card's
   * page), false if exhausted without finding it.
   */
  private async _searchBackwardsFromLastPage(userId: string): Promise<boolean> {
    const totalPages = await this._readTotalPages();
    if (totalPages > 1) {
      await this._jumpToPage(totalPages);
    }

    const MAX_BACK = 20;
    for (let attempt = 0; attempt < MAX_BACK; attempt++) {
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
        if ((await card.count()) > 0) return true;
      } catch {
        // Card not on this page — try previous.
      }

      try {
        await this.page.click(
          [
            { type: 'testId', value: 'pagination-prev' },
            { type: 'role', value: 'button', options: { name: /previous/i } },
          ],
          { intent: 'previous page button in user list pagination', fallbackTimeout: 3_000 },
        );
        await this.page.waitForLoadState('networkidle');
      } catch {
        // No previous page left — exhausted this search.
        return false;
      }
    }
    return false;
  }

  /** Sets the pagination page-size select to the given value. */
  private async _setPageSize(size: number): Promise<void> {
    try {
      const select = await this.page
        .locate(
          [
            { type: 'testId', value: 'pagination-limit-select' },
            { type: 'css', value: '[data-testid="pagination-limit-select"]' },
          ],
          { intent: 'pagination page size selector', fallbackTimeout: 3_000 },
        )
        .resolve();
      await select.selectOption(String(size));
      await this.page.waitForLoadState('networkidle');
    } catch {
      // Page-size selector may not be rendered — continue with default size.
    }
  }

  /** Returns the total number of pages from the pagination-page-indicator ("Page N of M"). */
  private async _readTotalPages(): Promise<number> {
    try {
      const indicator = await this.page
        .locate(
          [
            { type: 'testId', value: 'pagination-page-indicator' },
            { type: 'css', value: '[data-testid="pagination-page-indicator"]' },
          ],
          {
            intent: 'pagination page indicator showing current and total pages',
            fallbackTimeout: 3_000,
          },
        )
        .resolve();
      const text = await indicator.textContent();
      const match = text?.match(/(\d+)\s*$/);
      return match ? parseInt(match[1], 10) : 1;
    } catch {
      return 1;
    }
  }

  /** Clicks Next repeatedly until the target page is reached. */
  private async _jumpToPage(targetPage: number): Promise<void> {
    for (let p = 1; p < targetPage; p++) {
      try {
        await this.page.click(
          [
            { type: 'testId', value: 'pagination-next' },
            { type: 'role', value: 'button', options: { name: /next/i } },
          ],
          { intent: 'next page button to jump to last page', fallbackTimeout: 3_000 },
        );
        await this.page.waitForLoadState('networkidle');
      } catch {
        break;
      }
    }
  }

  /**
   * Returns the current page URL.
   */
  url(): string {
    return this.page.url();
  }
}
