/**
 * OnboardingPage — Page Object for the MiniCRM onboarding banner.
 *
 * Encapsulates UI interactions with the onboarding banner that appears for
 * first-run admin sessions. Every element uses a HealingLocator with at
 * least 2 strategies.
 *
 * Page Objects interact with UI only — no business logic, no API calls,
 * no assertions.
 *
 * MINCRM-256, MINCRM-344
 */

import type { PageFacade } from '@framework/fixtures/index.js';

/** Subset of Playwright fixtures required by OnboardingPage. */
export interface OnboardingPageContext {
  page: PageFacade;
}

/**
 * Page Object for the MiniCRM onboarding banner.
 */
export class OnboardingPage {
  private readonly page: PageFacade;

  constructor(context: OnboardingPageContext) {
    this.page = context.page;
  }

  // ---------------------------------------------------------------------------
  // State queries
  // ---------------------------------------------------------------------------

  /**
   * Returns a resolved locator for the onboarding banner container.
   * Throws if the banner is not found — use `page.isNotVisible` to assert absence.
   */
  async bannerLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'onboarding-banner' },
          { type: 'role', value: 'region', options: { name: /onboarding/i } },
        ],
        { intent: 'onboarding banner container element', fallbackTimeout: 10_000 },
      )
      .resolve();
  }

  /**
   * Returns a resolved locator for onboarding step 1 content.
   * Throws if not found — the banner must be visible before calling this.
   */
  async step1Locator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'onboarding-step-1' },
          { type: 'css', value: '[data-testid="onboarding-step-1"]' },
        ],
        { intent: 'onboarding step 1 content panel', fallbackTimeout: 10_000 },
      )
      .resolve();
  }

  /**
   * Returns a resolved locator for onboarding step 2 content.
   * Throws if not found — call after clicking "Looks good" on step 1.
   */
  async step2Locator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'onboarding-step-2' },
          { type: 'css', value: '[data-testid="onboarding-step-2"]' },
        ],
        { intent: 'onboarding step 2 content panel' },
      )
      .resolve();
  }

  // ---------------------------------------------------------------------------
  // Interactions
  // ---------------------------------------------------------------------------

  /**
   * Clicks the dismiss (X) button to close the onboarding banner.
   */
  async dismiss(): Promise<void> {
    await this.page.click(
      [
        { type: 'testId', value: 'onboarding-dismiss-button' },
        { type: 'role', value: 'button', options: { name: /dismiss|close/i } },
      ],
      { intent: 'dismiss button to close the onboarding banner' },
    );
  }

  /**
   * Clicks the "Looks good" button on step 1 to advance to step 2.
   */
  async clickLooksGood(): Promise<void> {
    await this.page.click(
      [
        { type: 'testId', value: 'onboarding-step1-looks-good' },
        { type: 'role', value: 'button', options: { name: /looks good/i } },
      ],
      { intent: 'looks good button on onboarding step 1 to advance to step 2' },
    );
  }
}
