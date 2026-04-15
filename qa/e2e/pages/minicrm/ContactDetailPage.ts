/**
 * ContactDetailPage — Page Object for the MiniCRM contact detail screen.
 *
 * Covers the read/edit view at `/contacts/:id`. Every element uses a
 * HealingLocator with at least 2 strategies.
 *
 * Page Objects interact with UI only — no business logic, no API calls,
 * no assertions.
 *
 * MINCRM-110
 */

import type { SafePage } from '@framework/fixtures/index.js';
import type { HealPage } from '@framework/fixtures/heal-page.fixture.js';
import { t } from '@framework/i18n/locale.js';

/** Subset of Playwright fixtures required by ContactDetailPage. */
export interface ContactDetailPageContext {
  page: SafePage;
  healPage: HealPage;
  testName: string;
}

/**
 * Page Object for the MiniCRM contact detail screen.
 */
export class ContactDetailPage {
  private readonly page: SafePage;
  private readonly healPage: HealPage;
  private readonly testName: string;

  constructor(context: ContactDetailPageContext) {
    this.page = context.page;
    this.healPage = context.healPage;
    this.testName = context.testName;
  }

  /**
   * Navigates directly to the contact detail URL.
   *
   * @param id - Contact UUID.
   */
  async navigate(id: string): Promise<void> {
    await this.page.goto(`/contacts/${id}`);
  }

  /**
   * Clicks the Edit button to enter edit mode.
   */
  async clickEdit(): Promise<void> {
    await this.healPage.click([
      { type: 'testId', value: 'edit-contact-button' },
      { type: 'role', value: 'button', options: { name: t('common.edit'), exact: false } },
    ]);
  }

  /**
   * Fills a text field on the edit form.
   *
   * @param testId - data-testid of the input (e.g. 'edit-first-name').
   * @param label - i18n label text used as fallback strategy.
   * @param value - Value to type.
   */
  async fillField(testId: string, label: string, value: string): Promise<void> {
    await this.healPage.fill(value, [
      { type: 'testId', value: testId },
      { type: 'label', value: label, options: { exact: false } },
    ]);
  }

  /**
   * Clicks the Save button to submit the edit form.
   */
  async save(): Promise<void> {
    await this.healPage.click([
      { type: 'testId', value: 'contact-form-submit' },
      { type: 'role', value: 'button', options: { name: t('contacts.saveChanges'), exact: false } },
    ]);
  }

  /**
   * Returns whether the contact detail page is in read mode (Edit button visible).
   *
   * The edit button is only present in read mode — it disappears while the edit
   * form is active. Using it as the ready indicator ensures we detect save completion
   * rather than just heading presence (the heading is visible in both modes).
   */
  async isLoaded(): Promise<boolean> {
    try {
      await this.healPage
        .locate([
          { type: 'testId', value: 'edit-contact-button' },
          { type: 'role', value: 'button', options: { name: t('common.edit'), exact: false } },
        ])
        .resolve(this.testName);
      return true;
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
