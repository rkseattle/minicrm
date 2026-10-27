/**
 * EmailSyncSettingsPage — Page Object for the admin Email Sync panel on the Integrations
 * tab of Admin Settings: the org-wide excluded domains and the backfill window.
 *
 * Every element uses a HealingLocator with at least two strategies, testId first.
 *
 * Page Objects interact with UI only — no business logic, no API calls, no assertions.
 */

import type { PageFacade } from '@framework/fixtures/index.js';
import { t } from '@framework/i18n/locale.js';

/** Subset of Playwright fixtures required by EmailSyncSettingsPage. */
export interface EmailSyncSettingsPageContext {
  page: PageFacade;
}

/**
 * Page Object for the EmailSyncSettings component.
 *
 * Does NOT navigate — callers open the Integrations tab first.
 */
export class EmailSyncSettingsPage {
  private readonly page: PageFacade;

  constructor(context: EmailSyncSettingsPageContext) {
    this.page = context.page;
  }

  /** Returns a resolved locator for the panel itself. */
  async panelLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'email-sync-settings' },
          {
            type: 'role',
            value: 'region',
            options: { name: t('settings.emailSync.sectionTitle') },
          },
        ],
        { intent: 'Email Sync panel on the admin Integrations tab' },
      )
      .resolve(timeout);
  }

  /**
   * Returns true when the off-org-wide banner is absent. Probed by testId only, never healed:
   * the banner's text also appears on other panels on this tab.
   *
   * @param timeout - How long the probe waits for absence.
   */
  async disabledBannerIsAbsent(timeout: number): Promise<boolean> {
    return this.page.doesNotExist(
      [
        { type: 'testId', value: 'email-sync-settings-disabled-banner' },
        { type: 'css', value: '[data-testid="email-sync-settings-disabled-banner"]' },
      ],
      timeout,
    );
  }

  /** Returns a resolved locator for the excluded-domains textarea. */
  async domainsInputLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'email-sync-excluded-domains-input' },
          { type: 'label', value: t('settings.emailSync.domainsLabel') },
        ],
        { intent: 'Org-wide excluded domains text area, one per line' },
      )
      .resolve(timeout);
  }

  /** Returns a resolved locator for the excluded domains' Save button. */
  async domainsSaveLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'email-sync-domains-save' },
          { type: 'css', value: '[data-testid="email-sync-domains-save"]' },
        ],
        { intent: 'Save button for the org excluded domains' },
      )
      .resolve(timeout);
  }

  /** Returns a resolved locator for the excluded domains' validation error. */
  async domainsErrorLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'email-sync-domains-error' },
          { type: 'css', value: '[data-testid="email-sync-domains-error"][role="alert"]' },
        ],
        { intent: 'Validation error under the excluded domains field' },
      )
      .resolve(timeout);
  }

  /** Returns a resolved locator for the excluded domains' saved confirmation. */
  async domainsSavedLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'email-sync-domains-saved' },
          { type: 'css', value: '[data-testid="email-sync-domains-saved"][role="status"]' },
        ],
        { intent: 'Saved confirmation for the excluded domains' },
      )
      .resolve(timeout);
  }

  /** Returns a resolved locator for the backfill-window number input. */
  async daysInputLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'email-sync-backfill-days-input' },
          { type: 'label', value: t('settings.emailSync.daysLabel') },
        ],
        { intent: 'Backfill window input, in days' },
      )
      .resolve(timeout);
  }

  /** Returns a resolved locator for the backfill window's Save button. */
  async daysSaveLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'email-sync-days-save' },
          { type: 'css', value: '[data-testid="email-sync-days-save"]' },
        ],
        { intent: 'Save button for the backfill window' },
      )
      .resolve(timeout);
  }
}
