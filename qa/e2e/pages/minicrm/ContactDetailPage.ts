/**
 * ContactDetailPage — Page Object for the MiniCRM contact detail screen.
 *
 * Covers the read/edit view at `/contacts/:id`. Every element uses a
 * HealingLocator with at least 2 strategies.
 *
 * Page Objects interact with UI only — no business logic, no API calls,
 * no assertions.
 *
 *
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
  async editButtonLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'edit-contact-button' },
          { type: 'role', value: 'button', options: { name: t('common.edit'), exact: false } },
        ],
        { intent: 'edit button confirming contact detail page is fully loaded' },
      )
      .resolve(timeout);
  }

  /**
   * Returns a resolved locator for the Export PDF button on the contact detail page.
   */
  async exportPdfButtonLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'contact-detail-export-pdf-button' },
          { type: 'role', value: 'button', options: { name: /export pdf/i } },
        ],
        { intent: 'button to export this contact as a single-record PDF' },
      )
      .resolve(timeout);
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
  async sendEmailButtonLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'send-email-button' },
          { type: 'role', value: 'button', options: { name: /send email/i } },
        ],
        { intent: 'send email button on contact detail page' },
      )
      .resolve(timeout);
  }

  /**
   * Returns a resolved locator for the send email compose modal.
   * Throws if not found — call after `clickSendEmail`.
   */
  async sendEmailModalLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'send-email-modal' },
          { type: 'role', value: 'dialog', options: { name: /send email/i } },
        ],
        { intent: 'send email compose modal dialog' },
      )
      .resolve(timeout);
  }

  /**
   * Returns a resolved locator for the send email success message.
   * Throws if not found — call after `submitSendEmail`.
   */
  async sendEmailSuccessLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'send-email-success' },
          { type: 'role', value: 'status' },
        ],
        { intent: 'success message after sending email from contact detail page' },
      )
      .resolve(timeout);
  }

  /**
   * Returns a resolved locator for the account link on the contact detail page.
   * Throws if not found — contact must be linked to an account.
   */
  async accountLinkLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'detail-account' },
          { type: 'role', value: 'link', options: { name: /account/i } },
        ],
        { intent: 'account link on contact detail page' },
      )
      .resolve(timeout);
  }

  /**
   * Returns a resolved locator for the attachments section container.
   * Returns null if not present.
   */
  async attachmentsSectionLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'attachments-section' },
          { type: 'role', value: 'region', options: { name: /attachment/i } },
        ],
        { intent: 'attachments section container on detail page' },
      )
      .resolve(timeout)
      .catch(() => null);
  }

  /**
   * Returns a resolved locator for the attachments file input.
   */
  async attachmentsFileInputLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'attachments-file-input' },
          { type: 'css', value: 'input[type="file"]' },
        ],
        { intent: 'file input for uploading attachments' },
      )
      .resolve(timeout);
  }

  /**
   * Returns a resolved locator for the attachments list container.
   * Throws if not found — call after a successful upload.
   */
  async attachmentsListLocator(timeout?: number) {
    // eslint-disable-next-line local/require-locator-fallback -- unnamed <ul> with no accessible name; role:list matches every list on the page
    return this.page
      .locate([{ type: 'testId', value: 'attachments-list' }], {
        intent: 'list of uploaded attachments',
      })
      .resolve(timeout);
  }

  /**
   * Returns a resolved locator for the attachments upload error message.
   * Throws if not found — call after uploading a disallowed file type or oversized file.
   */
  async attachmentsUploadErrorLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'attachments-upload-error' },
          { type: 'role', value: 'alert' },
        ],
        { intent: 'upload error message when attachment is rejected' },
      )
      .resolve(timeout);
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
  async customFieldsEditGridLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'custom-fields-edit-grid' },
          { type: 'css', value: '[data-testid="custom-fields-edit-grid"]' },
        ],
        { intent: 'custom fields edit grid container in contact edit form' },
      )
      .resolve(timeout);
  }

  /**
   * Returns a resolved locator for the custom fields read grid container.
   * Visible when the contact is in read mode and has at least one custom field value.
   * Returns null when the grid is not present (e.g. after all definitions are deleted).
   */
  async customFieldsReadGridLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'custom-fields-read-grid' },
          { type: 'css', value: '[data-testid="custom-fields-read-grid"]' },
        ],
        { intent: 'custom fields read grid container on contact detail page' },
      )
      .resolve(timeout)
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
      .resolve(timeout);
  }

  /**
   * Returns a resolved locator for the back-to-contacts link on the not-found page.
   */
  async notFoundBackLinkLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'css', value: 'main a[href="/contacts"]' },
          { type: 'css', value: 'main a' },
        ],
        { intent: 'back to contacts navigation link on the not-found page' },
      )
      .resolve(timeout);
  }

  /**
   * Returns a resolved locator for the contact name heading.
   *
   * The role-based fallback is scoped to level: 1 rather than a bare
   * `heading` role: the page renders several h2 sub-section headings in the
   * same DOM tree, so an unscoped heading role matches all of them too — see
   * AutomationPage.headingLocator() for the identical failure mode. The
   * contact name itself is dynamic per-test data, so an exact-text match
   * (used for the other fixes of this bug class) isn't viable here;
   * level: 1 alone is sufficient since this page has exactly one h1.
   */
  async contactNameLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'contact-name' },
          { type: 'role', value: 'heading', options: { level: 1 } },
        ],
        { intent: 'contact name heading on the contact detail page' },
      )
      .resolve(timeout);
  }

  /**
   * Returns the current page URL.
   */
  url(): string {
    return this.page.url();
  }

  // ── AI champion/blocker detection ──────────────────────────────────

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

  /**
   * Returns true when the champion/blocker badge is currently visible, scoped
   * to a contact ID. Guards presence first — locate().resolve() throws
   * StrategyExhaustedError immediately on an absent element rather than
   * waiting for it, which is unsuitable for "may legitimately be absent"
   * checks.
   */
  async isChampionBlockerBadgeVisible(contactId: string): Promise<boolean> {
    const present = await this.page
      .waitForPresent(`[data-testid="champion-blocker-badge-${contactId}"]`, 500)
      .then(() => true)
      .catch(() => false);
    if (!present) return false;
    const locator = await this.championBlockerBadgeLocator(contactId);
    return locator.isVisible().catch(() => false);
  }

  // ── AI sentiment tracking ──────────────────────────────────────────

  /**
   * Returns true when the sentiment trend sparkline is currently visible, scoped
   * to a contact ID. Guards presence first — the sparkline legitimately does not
   * render until at least 2 non-flagged scored interactions exist.
   */
  async isSentimentTrendVisible(contactId: string): Promise<boolean> {
    const present = await this.page
      .waitForPresent(`[data-testid="sentiment-trend-${contactId}"]`, 500)
      .then(() => true)
      .catch(() => false);
    if (!present) return false;
    const locator = await this.page
      .locate(
        [
          { type: 'testId', value: `sentiment-trend-${contactId}` },
          { type: 'css', value: `[data-testid="sentiment-trend-${contactId}"]` },
        ],
        { intent: 'AI sentiment trend sparkline on the contact detail page' },
      )
      .resolve();
    return locator.isVisible().catch(() => false);
  }

  // ── AI smart follow-up timing suggestions ───────────────────────────

  /**
   * Returns true when the follow-up timing card is currently visible, scoped
   * to a contact ID. Guards presence first — the card legitimately does not
   * render until at least 5 logged interactions exist.
   */
  async isFollowUpTimingCardVisible(contactId: string): Promise<boolean> {
    const present = await this.page
      .waitForPresent(`[data-testid="followup-timing-card-${contactId}"]`, 500)
      .then(() => true)
      .catch(() => false);
    if (!present) return false;
    const locator = await this.page
      .locate(
        [
          { type: 'testId', value: `followup-timing-card-${contactId}` },
          { type: 'css', value: `[data-testid="followup-timing-card-${contactId}"]` },
        ],
        { intent: 'AI follow-up timing suggestion card on the contact detail page' },
      )
      .resolve();
    return locator.isVisible().catch(() => false);
  }

  // ── AI warm introduction path mapping ──────────────────────────────

  /** Returns a resolved locator for the "Find warm path" button, scoped to a contact ID. */
  async findWarmPathButtonLocator(contactId: string) {
    return this.page
      .locate(
        [
          { type: 'testId', value: `find-warm-path-${contactId}` },
          { type: 'role', value: 'button', options: { name: /find warm path/i } },
        ],
        { intent: 'Find warm path button on the contact detail page' },
      )
      .resolve();
  }

  /** Clicks the "Find warm path" button, scoped to a contact ID. */
  async clickFindWarmPath(contactId: string): Promise<void> {
    const locator = await this.findWarmPathButtonLocator(contactId);
    await locator.click();
  }

  /**
   * Returns true when the "Find warm path" button is currently visible, scoped
   * to a contact ID. Guards presence first — the button legitimately does not
   * render when the ai_warm_intro_path flag is off.
   */
  async isFindWarmPathButtonVisible(contactId: string): Promise<boolean> {
    const present = await this.page
      .waitForPresent(`[data-testid="find-warm-path-${contactId}"]`, 500)
      .then(() => true)
      .catch(() => false);
    if (!present) return false;
    const locator = await this.findWarmPathButtonLocator(contactId);
    return locator.isVisible().catch(() => false);
  }

  /** Returns a resolved locator for the warm-path results container, scoped to a contact ID. */
  async warmPathResultsLocator(contactId: string) {
    return this.page
      .locate(
        [
          { type: 'testId', value: `warm-intro-paths-results-${contactId}` },
          { type: 'css', value: `[data-testid="warm-intro-paths-results-${contactId}"]` },
        ],
        { intent: 'warm introduction path results container on the contact detail page' },
      )
      .resolve();
  }

  /** Returns a resolved locator for the no-warm-path-found empty state message. */
  async warmPathEmptyMessageLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'warm-intro-empty' },
          { type: 'css', value: '[data-testid="warm-intro-empty"]' },
        ],
        { intent: 'no-warm-path-found message on the contact detail page' },
      )
      .resolve(timeout);
  }

  /** Returns a resolved locator for the "Draft Email" button. */
  async draftEmailButtonLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'draft-email-button' },
          { type: 'role', value: 'button', options: { name: t('emailDraft.draftEmailButton') } },
        ],
        { intent: 'button that generates an AI email draft for this contact' },
      )
      .resolve(timeout);
  }

  /** Clicks the "Draft Email" button. */
  async clickDraftEmail(timeout?: number): Promise<void> {
    const locator = await this.draftEmailButtonLocator(timeout);
    await locator.click();
  }

  /**
   * Returns true when the "Draft Email" button is currently visible. Guards
   * presence first — locate().resolve() throws StrategyExhaustedError
   * immediately on an absent element rather than waiting for it, which is
   * unsuitable for "may legitimately be absent" checks.
   */
  async isDraftEmailButtonVisible(): Promise<boolean> {
    const present = await this.page
      .waitForPresent('[data-testid="draft-email-button"]', 500)
      .then(() => true)
      .catch(() => false);
    if (!present) return false;
    const locator = await this.draftEmailButtonLocator();
    return locator.isVisible().catch(() => false);
  }
}
