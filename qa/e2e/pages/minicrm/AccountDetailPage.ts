/**
 * AccountDetailPage — Page Object for the MiniCRM account detail screen.
 *
 * Covers the read/edit view at `/accounts/:id`. Every element uses a
 * HealingLocator with at least 2 strategies.
 *
 * Page Objects interact with UI only — no business logic, no API calls,
 * no assertions.
 *
 * MINCRM-139
 */

import type { PageFacade } from '@framework/fixtures/index.js';
import { t } from '@framework/i18n/locale.js';

/** Subset of Playwright fixtures required by AccountDetailPage. */
export interface AccountDetailPageContext {
  page: PageFacade;
}

/**
 * Page Object for the MiniCRM account detail screen.
 */
export class AccountDetailPage {
  private readonly page: PageFacade;

  constructor(context: AccountDetailPageContext) {
    this.page = context.page;
  }

  /**
   * Navigates directly to the account detail URL.
   *
   * @param id - Account UUID.
   */
  async navigate(id: string): Promise<void> {
    await this.page.goto(`/accounts/${id}`);
  }

  /**
   * Clicks the Edit button to enter edit mode.
   */
  async clickEdit(): Promise<void> {
    await this.page.click(
      [
        { type: 'testId', value: 'edit-account-button' },
        { type: 'role', value: 'button', options: { name: t('accounts.edit'), exact: false } },
      ],
      { intent: 'edit button to enter account edit mode' },
    );
  }

  /**
   * Fills a text field on the edit form.
   *
   * @param testId - data-testid of the input (e.g. 'account-name-input').
   * @param label - i18n label text used as fallback strategy.
   * @param value - Value to type.
   */
  async fillField(testId: string, label: string, value: string): Promise<void> {
    await this.page.fill(
      value,
      [
        { type: 'testId', value: testId },
        { type: 'label', value: label, options: { exact: false } },
      ],
      { intent: `account edit form field labeled ${label}` },
    );
  }

  /**
   * Clicks the Save button to submit the edit form.
   */
  async save(): Promise<void> {
    await this.page.click(
      [
        { type: 'testId', value: 'account-form-submit' },
        {
          type: 'role',
          value: 'button',
          options: { name: t('accounts.saveChanges'), exact: false },
        },
      ],
      { intent: 'save button to submit account edit form' },
    );
  }

  /**
   * Returns whether the account detail page is in read mode (Edit button visible).
   */
  async isLoaded(): Promise<boolean> {
    try {
      await this.page
        .locate(
          [
            { type: 'testId', value: 'edit-account-button' },
            { type: 'role', value: 'button', options: { name: t('accounts.edit'), exact: false } },
          ],
          { intent: 'edit button indicating account detail page is in read mode' },
        )
        .resolve();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Clicks the Delete button to open the confirmation modal.
   */
  async clickDelete(): Promise<void> {
    await this.page.click(
      [
        { type: 'testId', value: 'delete-account-button' },
        { type: 'role', value: 'button', options: { name: t('accounts.delete'), exact: false } },
      ],
      { intent: 'delete button to open account delete confirmation modal' },
    );
  }

  /**
   * Clicks the Confirm button in the delete confirmation modal.
   */
  async confirmDelete(): Promise<void> {
    await this.page.click(
      [
        { type: 'testId', value: 'confirm-delete-confirm' },
        { type: 'role', value: 'button', options: { name: t('common.delete'), exact: false } },
      ],
      { intent: 'confirm button in account delete confirmation modal' },
    );
  }

  /**
   * Clicks the Cancel button in the delete confirmation modal.
   */
  async cancelDelete(): Promise<void> {
    await this.page.click(
      [
        { type: 'testId', value: 'confirm-delete-cancel' },
        { type: 'role', value: 'button', options: { name: t('common.cancel'), exact: false } },
      ],
      { intent: 'cancel button in account delete confirmation modal' },
    );
  }

  /**
   * Clicks the Cancel button in the account edit form.
   */
  async cancelEdit(): Promise<void> {
    await this.page.click(
      [
        { type: 'testId', value: 'account-form-cancel' },
        { type: 'role', value: 'button', options: { name: t('accounts.cancel'), exact: false } },
      ],
      { intent: 'cancel button in account edit form' },
    );
  }

  /**
   * Returns a resolved locator for a linked contact row by contact ID.
   * Returns null if the contact is not linked.
   *
   * @param id - Contact UUID.
   */
  async linkedContactLocator(id: string) {
    return this.page
      .locate(
        [
          { type: 'testId', value: `linked-contact-${id}` },
          { type: 'css', value: `[data-testid="linked-contact-${id}"]` },
        ],
        { intent: 'linked contact row on account detail page' },
      )
      .resolve()
      .catch(() => null);
  }

  /**
   * Returns a resolved locator for the empty state when no contacts are linked.
   */
  async linkedContactsEmptyLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'linked-contacts-empty' },
          { type: 'role', value: 'status' },
        ],
        { intent: 'empty state message when no contacts are linked to account' },
      )
      .resolve()
      .catch(() => null);
  }

  /**
   * Returns a resolved locator for the attachments section container.
   * Returns null if not present.
   */
  async attachmentsSectionLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'attachments-section' },
          { type: 'role', value: 'region', options: { name: /attachment/i } },
        ],
        { intent: 'attachments section container on account detail page' },
      )
      .resolve()
      .catch(() => null);
  }

  /**
   * Returns a resolved locator for the attachments file input.
   */
  async attachmentsFileInputLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'attachments-file-input' },
          { type: 'css', value: 'input[type="file"]' },
        ],
        { intent: 'file input for uploading attachments on account detail page' },
      )
      .resolve();
  }

  /**
   * Returns a resolved locator for the attachments list container.
   * Returns null if not present.
   */
  async attachmentsListLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'attachments-list' },
          { type: 'role', value: 'list' },
        ],
        { intent: 'list of uploaded attachments on account detail page' },
      )
      .resolve()
      .catch(() => null);
  }

  /**
   * Returns the current page URL.
   */
  url(): string {
    return this.page.url();
  }
}
