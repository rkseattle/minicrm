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

import type { PageFacade } from '@framework/fixtures/index.js';
import { t } from '@framework/i18n/locale.js';

/** Subset of Playwright fixtures required by ContactDetailPage. */
export interface ContactDetailPageContext {
  page: PageFacade;
}

/**
 * Page Object for the MiniCRM contact detail screen.
 */
export class ContactDetailPage {
  private readonly page: PageFacade;

  constructor(context: ContactDetailPageContext) {
    this.page = context.page;
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
    await this.page.click(
      [
        { type: 'testId', value: 'edit-contact-button' },
        { type: 'role', value: 'button', options: { name: t('common.edit'), exact: false } },
      ],
      { intent: 'edit button to enter contact edit mode' },
    );
  }

  /**
   * Fills a text field on the edit form.
   *
   * @param testId - data-testid of the input (e.g. 'edit-first-name').
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
      { intent: `contact edit form field labeled ${label}` },
    );
  }

  /**
   * Clicks the Save button to submit the edit form.
   */
  async save(): Promise<void> {
    await this.page.click(
      [
        { type: 'testId', value: 'contact-form-submit' },
        {
          type: 'role',
          value: 'button',
          options: { name: t('contacts.saveChanges'), exact: false },
        },
      ],
      { intent: 'save button to submit contact edit form' },
    );
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
      await this.page
        .locate(
          [
            { type: 'testId', value: 'edit-contact-button' },
            { type: 'role', value: 'button', options: { name: t('common.edit'), exact: false } },
          ],
          { intent: 'edit button indicating contact detail page is in read mode' },
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
        { type: 'testId', value: 'delete-contact-button' },
        { type: 'role', value: 'button', options: { name: t('contacts.delete'), exact: false } },
      ],
      { intent: 'delete button to open contact delete confirmation modal' },
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
      { intent: 'confirm button in contact delete confirmation modal' },
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
      { intent: 'cancel button in contact delete confirmation modal' },
    );
  }

  /**
   * Clicks the Cancel button in the contact edit form.
   */
  async cancelEdit(): Promise<void> {
    await this.page.click(
      [
        { type: 'testId', value: 'contact-form-cancel' },
        { type: 'role', value: 'button', options: { name: t('contacts.cancel'), exact: false } },
      ],
      { intent: 'cancel button in contact edit form' },
    );
  }

  /**
   * Confirms deletion in the attachment delete confirmation dialog.
   */
  async confirmAttachmentDelete(): Promise<void> {
    await this.page.click(
      [
        { type: 'testId', value: 'attachment-delete-confirm' },
        { type: 'role', value: 'button', options: { name: /confirm|delete/i } },
      ],
      { intent: 'confirm button in the attachment delete confirmation dialog' },
    );
  }

  /**
   * Clicks the Send Email button to open the compose modal.
   */
  async clickSendEmail(): Promise<void> {
    await this.page.click(
      [
        { type: 'testId', value: 'send-email-button' },
        { type: 'role', value: 'button', options: { name: /send email/i } },
      ],
      { intent: 'send email button to open email compose modal' },
    );
  }

  /**
   * Fills the subject field in the send email modal.
   *
   * @param subject - Subject line text.
   */
  async fillSendEmailSubject(subject: string): Promise<void> {
    await this.page.fill(
      subject,
      [
        { type: 'testId', value: 'send-email-subject' },
        { type: 'label', value: 'Subject', options: { exact: false } },
      ],
      { intent: 'subject field in the send email compose modal' },
    );
  }

  /**
   * Fills the body field in the send email modal.
   *
   * @param body - Email body text.
   */
  async fillSendEmailBody(body: string): Promise<void> {
    await this.page.fill(
      body,
      [
        { type: 'testId', value: 'send-email-body' },
        { type: 'label', value: 'Body', options: { exact: false } },
      ],
      { intent: 'body field in the send email compose modal' },
    );
  }

  /**
   * Clicks the Send button to submit the email compose form.
   */
  async submitSendEmail(): Promise<void> {
    await this.page.click(
      [
        { type: 'testId', value: 'send-email-submit' },
        { type: 'role', value: 'button', options: { name: /^send$/i } },
      ],
      { intent: 'send button to submit the email compose form' },
    );
  }

  /**
   * Returns the current page URL.
   */
  url(): string {
    return this.page.url();
  }
}
