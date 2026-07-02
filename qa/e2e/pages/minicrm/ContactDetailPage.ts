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
   * Returns a resolved locator for the Edit button (visible in read mode only).
   * Use to confirm the detail page has finished loading before snapshotting.
   */
  async editButtonLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'edit-contact-button' },
          { type: 'role', value: 'button', options: { name: t('common.edit'), exact: false } },
        ],
        { intent: 'edit button confirming contact detail page is fully loaded' },
      )
      .resolve();
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
   * Returns a resolved locator for the send email button.
   * Throws if not found — contact must have an email address for this button to appear.
   */
  async sendEmailButtonLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'send-email-button' },
          { type: 'role', value: 'button', options: { name: /send email/i } },
        ],
        { intent: 'send email button on contact detail page' },
      )
      .resolve();
  }

  /**
   * Returns a resolved locator for the send email compose modal.
   * Throws if not found — call after `clickSendEmail`.
   */
  async sendEmailModalLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'send-email-modal' },
          { type: 'role', value: 'dialog', options: { name: /send email/i } },
        ],
        { intent: 'send email compose modal dialog' },
      )
      .resolve();
  }

  /**
   * Returns a resolved locator for the send email success message.
   * Throws if not found — call after `submitSendEmail`.
   */
  async sendEmailSuccessLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'send-email-success' },
          { type: 'role', value: 'status' },
        ],
        { intent: 'success message after sending email from contact detail page' },
      )
      .resolve();
  }

  /**
   * Returns a resolved locator for the account link on the contact detail page.
   * Throws if not found — contact must be linked to an account.
   */
  async accountLinkLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'detail-account' },
          { type: 'role', value: 'link', options: { name: /account/i } },
        ],
        { intent: 'account link on contact detail page' },
      )
      .resolve();
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
        { intent: 'attachments section container on detail page' },
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
        { intent: 'file input for uploading attachments' },
      )
      .resolve();
  }

  /**
   * Returns a resolved locator for the attachments list container.
   * Throws if not found — call after a successful upload.
   */
  async attachmentsListLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'attachments-list' },
          { type: 'role', value: 'list' },
        ],
        { intent: 'list of uploaded attachments' },
      )
      .resolve();
  }

  /**
   * Returns a resolved locator for the attachments upload error message.
   * Throws if not found — call after uploading a disallowed file type or oversized file.
   */
  async attachmentsUploadErrorLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'attachments-upload-error' },
          { type: 'role', value: 'alert' },
        ],
        { intent: 'upload error message when attachment is rejected' },
      )
      .resolve();
  }

  /**
   * Returns a resolved locator for the delete button for a specific attachment.
   *
   * @param attachmentId - Attachment UUID.
   */
  async attachmentDeleteLocator(attachmentId: string) {
    return this.page
      .locate(
        [
          { type: 'testId', value: `attachment-delete-${attachmentId}` },
          { type: 'css', value: `[data-testid="attachment-delete-${attachmentId}"]` },
        ],
        { intent: 'delete button for a specific attachment row' },
      )
      .resolve();
  }

  /**
   * Returns a resolved locator for the custom fields edit grid container.
   * Visible when the contact is in edit mode.
   */
  async customFieldsEditGridLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'custom-fields-edit-grid' },
          { type: 'css', value: '[data-testid="custom-fields-edit-grid"]' },
        ],
        { intent: 'custom fields edit grid container in contact edit form' },
      )
      .resolve();
  }

  /**
   * Returns a resolved locator for the custom fields read grid container.
   * Visible when the contact is in read mode and has at least one custom field value.
   * Returns null when the grid is not present (e.g. after all definitions are deleted).
   */
  async customFieldsReadGridLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'custom-fields-read-grid' },
          { type: 'css', value: '[data-testid="custom-fields-read-grid"]' },
        ],
        { intent: 'custom fields read grid container on contact detail page' },
      )
      .resolve()
      .catch(() => null);
  }

  /**
   * Returns a resolved locator for the not-found alert paragraph shown when
   * navigating to a contact ID that does not exist.
   *
   * @param timeout - Probe timeout in ms. Default 2 000; pass a longer value
   *   when React Query's error state may arrive after networkidle (e.g. 10 000).
   */
  async notFoundAlertLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'role', value: 'alert' },
          { type: 'css', value: '[role="alert"]' },
        ],
        {
          fallbackTimeout: timeout,
          intent: 'not-found message on the contact detail page for an invalid id',
        },
      )
      .resolve();
  }

  /**
   * Returns a resolved locator for the back-to-contacts link on the not-found page.
   */
  async notFoundBackLinkLocator() {
    return this.page
      .locate(
        [
          { type: 'css', value: 'main a[href="/contacts"]' },
          { type: 'css', value: 'main a' },
        ],
        { intent: 'back to contacts navigation link on the not-found page' },
      )
      .resolve();
  }

  /**
   * Returns a resolved locator for the contact name heading.
   */
  async contactNameLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'contact-name' },
          { type: 'role', value: 'heading' },
        ],
        { intent: 'contact name heading on the contact detail page' },
      )
      .resolve();
  }

  /**
   * Returns the current page URL.
   */
  url(): string {
    return this.page.url();
  }

  // ── AI champion/blocker detection (MINCRM-466) ──────────────────────────────────

  /** Returns a resolved locator for the champion/blocker badge, scoped to a contact ID. */
  async championBlockerBadgeLocator(contactId: string) {
    return this.page
      .locate(
        [
          { type: 'testId', value: `champion-blocker-badge-${contactId}` },
          { type: 'css', value: `[data-testid="champion-blocker-badge-${contactId}"]` },
        ],
        { intent: 'AI champion/blocker classification badge on the contact detail page' },
      )
      .resolve();
  }
}
