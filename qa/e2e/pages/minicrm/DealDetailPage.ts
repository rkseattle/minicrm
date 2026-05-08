/**
 * DealDetailPage — Page Object for the MiniCRM deal detail screen.
 *
 * Covers the read/edit view at `/deals/:id`. Every element uses a
 * HealingLocator with at least 2 strategies.
 *
 * Page Objects interact with UI only — no business logic, no API calls,
 * no assertions.
 *
 * MINCRM-314
 */

import type { PageFacade } from '@framework/fixtures/index.js';

/** Subset of Playwright fixtures required by DealDetailPage. */
export interface DealDetailPageContext {
  page: PageFacade;
}

/**
 * Page Object for the MiniCRM deal detail screen.
 */
export class DealDetailPage {
  private readonly page: PageFacade;

  constructor(context: DealDetailPageContext) {
    this.page = context.page;
  }

  /**
   * Navigates directly to the deal detail URL.
   *
   * @param id - Deal UUID.
   */
  async navigate(id: string): Promise<void> {
    await this.page.goto(`/deals/${id}`);
  }

  /**
   * Clicks the Edit button to enter edit mode.
   */
  async clickEdit(): Promise<void> {
    await this.page.click(
      [
        { type: 'testId', value: 'edit-deal-button' },
        { type: 'role', value: 'button', options: { name: /edit/i } },
      ],
      { intent: 'button to open the deal edit form' },
    );
  }

  /**
   * Clicks the Delete button to open the confirmation modal.
   */
  async clickDelete(): Promise<void> {
    await this.page.click(
      [
        { type: 'testId', value: 'delete-deal-button' },
        { type: 'role', value: 'button', options: { name: /delete/i } },
      ],
      { intent: 'button to initiate deal deletion' },
    );
  }

  /**
   * Clicks the Confirm button in the delete confirmation modal.
   */
  async confirmDelete(): Promise<void> {
    await this.page.click(
      [
        { type: 'testId', value: 'confirm-delete-confirm' },
        { type: 'role', value: 'button', options: { name: /confirm|delete/i } },
      ],
      { intent: 'confirm button in the delete confirmation modal' },
    );
  }

  /**
   * Clicks the Submit button to save the deal form.
   */
  async submitForm(): Promise<void> {
    await this.page.click(
      [
        { type: 'testId', value: 'deal-form-submit' },
        { type: 'role', value: 'button', options: { name: /save|submit/i } },
      ],
      { intent: 'submit button on the deal form' },
    );
  }

  /**
   * Returns a resolved locator for the deal name input on the deal form.
   */
  async nameInputLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'deal-name-input' },
          { type: 'label', value: 'Name', options: { exact: false } },
        ],
        { intent: 'deal name text input field on deal form' },
      )
      .resolve();
  }

  /**
   * Returns a resolved locator for the deal stage select on the deal form.
   */
  async stageSelectLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'deal-stage-select' },
          { type: 'role', value: 'combobox', options: { name: /stage/i } },
        ],
        { intent: 'deal pipeline stage selector on deal form' },
      )
      .resolve();
  }

  /**
   * Returns a resolved locator for the deal value input on the deal form.
   */
  async valueInputLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'deal-value-input' },
          { type: 'label', value: 'Value', options: { exact: false } },
        ],
        { intent: 'deal monetary value input field on deal form' },
      )
      .resolve();
  }

  /**
   * Returns a resolved locator for the deal close date input on the deal form.
   */
  async closeDateInputLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'deal-close-date-input' },
          { type: 'label', value: 'Close date', options: { exact: false } },
        ],
        { intent: 'deal expected close date input on deal form' },
      )
      .resolve();
  }

  /**
   * Returns a resolved locator for the deal account select on the deal form.
   */
  async accountSelectLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'deal-account-select' },
          { type: 'role', value: 'combobox', options: { name: /account/i } },
        ],
        { intent: 'account selector on the deal form' },
      )
      .resolve();
  }

  /**
   * Returns a resolved locator for the deal form submit button.
   */
  async submitLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'deal-form-submit' },
          { type: 'role', value: 'button', options: { name: /save|submit/i } },
        ],
        { intent: 'submit button on the deal form' },
      )
      .resolve();
  }

  /**
   * Returns a resolved locator for the deal name heading on the detail page.
   */
  async dealNameLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'deal-name' },
          { type: 'role', value: 'heading' },
        ],
        { intent: 'deal name heading on the deal detail page' },
      )
      .resolve();
  }

  /**
   * Returns a resolved locator for the linked contacts section heading.
   */
  async linkedContactsHeadingLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'linked-contacts-heading' },
          { type: 'role', value: 'heading', options: { name: /contact/i } },
        ],
        { intent: 'linked contacts section heading on deal detail page' },
      )
      .resolve();
  }

  /**
   * Returns a resolved locator for the contact link select dropdown.
   */
  async linkContactSelectLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'link-contact-select' },
          { type: 'role', value: 'combobox', options: { name: /contact/i } },
        ],
        { intent: 'dropdown to select a contact to link to the deal' },
      )
      .resolve();
  }

  /**
   * Returns a resolved locator for the link contact button.
   */
  async linkContactButtonLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'link-contact-button' },
          { type: 'role', value: 'button', options: { name: /link/i } },
        ],
        { intent: 'button to confirm linking the selected contact to the deal' },
      )
      .resolve();
  }

  /**
   * Returns a resolved locator for a linked contact entry by contact ID.
   *
   * @param contactId - Contact UUID.
   */
  async linkedContactLocator(contactId: string) {
    return this.page
      .locate(
        [
          { type: 'testId', value: `linked-contact-${contactId}` },
          { type: 'css', value: `[data-testid="linked-contact-${contactId}"]` },
        ],
        { intent: 'linked contact entry on deal detail page' },
      )
      .resolve();
  }

  /**
   * Returns a resolved locator for the unlink button for a specific contact.
   *
   * @param contactId - Contact UUID.
   */
  async unlinkContactLocator(contactId: string) {
    return this.page
      .locate(
        [
          { type: 'testId', value: `unlink-contact-${contactId}` },
          { type: 'css', value: `[data-testid="unlink-contact-${contactId}"]` },
        ],
        { intent: 'button to remove a linked contact from the deal' },
      )
      .resolve();
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
        { intent: 'empty state message when no contacts are linked to the deal' },
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
        { intent: 'attachments section container on deal detail page' },
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
        { intent: 'file input for uploading attachments on deal detail page' },
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
        { intent: 'list of uploaded attachments on deal detail page' },
      )
      .resolve()
      .catch(() => null);
  }

  /**
   * Returns a resolved locator for the attachments upload error message.
   * Returns null if not present.
   */
  async attachmentsUploadErrorLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'attachments-upload-error' },
          { type: 'role', value: 'alert' },
        ],
        { intent: 'upload error message when attachment is rejected on deal detail page' },
      )
      .resolve()
      .catch(() => null);
  }

  /**
   * Returns a resolved locator for the not-found alert paragraph shown when
   * navigating to a deal ID that does not exist.
   */
  async notFoundAlertLocator() {
    return this.page
      .locate(
        [
          { type: 'css', value: 'p[role="alert"]' },
          { type: 'css', value: 'main p[role="alert"]' },
        ],
        { intent: 'not-found message on the deal detail page for an invalid id' },
      )
      .resolve();
  }

  /**
   * Returns a resolved locator for the back-to-deals link on the not-found page.
   */
  async notFoundBackLinkLocator() {
    return this.page
      .locate(
        [
          { type: 'css', value: 'main a[href="/deals"]' },
          { type: 'css', value: 'main a' },
        ],
        { intent: 'back to deals navigation link on the not-found page' },
      )
      .resolve();
  }

  /**
   * Returns the current page URL.
   */
  url(): string {
    return this.page.url();
  }
}
