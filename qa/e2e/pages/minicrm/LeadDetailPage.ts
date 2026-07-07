/**
 * LeadDetailPage — Page Object for the MiniCRM lead detail screen.
 *
 * Encapsulates all UI interactions on `/leads/:id`. Every element uses a
 * HealingLocator with at least 2 strategies.
 *
 * Page Objects interact with UI only — no business logic, no API calls,
 * no assertions.
 *
 * MINCRM-192
 */

import type { PageFacade } from '@framework/fixtures/index.js';
import { t } from '@framework/i18n/locale.js';

// ---------------------------------------------------------------------------
// Fixture context
// ---------------------------------------------------------------------------

/** Subset of Playwright fixtures required by LeadDetailPage. */
export interface LeadDetailPageContext {
  page: PageFacade;
}

// ---------------------------------------------------------------------------
// LeadDetailPage
// ---------------------------------------------------------------------------

/**
 * Page Object for the MiniCRM lead detail screen.
 */
export class LeadDetailPage {
  private readonly page: PageFacade;

  /**
   * @param context - Playwright fixture context containing page.
   */
  constructor(context: LeadDetailPageContext) {
    this.page = context.page;
  }

  // ---------------------------------------------------------------------------
  // Navigation
  // ---------------------------------------------------------------------------

  /**
   * Navigates directly to the lead detail page for the given ID.
   *
   * @param leadId - Lead UUID.
   */
  async navigate(leadId: string): Promise<void> {
    await this.page.goto(`/leads/${leadId}`);
  }

  // ---------------------------------------------------------------------------
  // Conversion
  // ---------------------------------------------------------------------------

  /**
   * Clicks the "Convert Lead" button to open the conversion modal.
   */
  async clickConvert(): Promise<void> {
    await this.page.click(
      [
        { type: 'testId', value: 'convert-lead-button' },
        { type: 'role', value: 'button', options: { name: t('leads.convert'), exact: false } },
      ],
      { intent: 'convert lead button to open conversion modal' },
    );
  }

  /**
   * Returns the value of the contact first name field in the conversion modal.
   */
  async conversionContactFirstName(): Promise<string> {
    const resolved = await this.page
      .locate(
        [
          { type: 'testId', value: 'convert-contact-first-name' },
          { type: 'label', value: 'First name', options: { exact: false } },
        ],
        { intent: 'contact first name field in lead conversion modal' },
      )
      .resolve();
    return (await resolved.inputValue()) ?? '';
  }

  /**
   * Returns the value of the contact email field in the conversion modal.
   */
  async conversionContactEmail(): Promise<string> {
    const resolved = await this.page
      .locate(
        [
          { type: 'testId', value: 'convert-contact-email' },
          { type: 'label', value: 'Email', options: { exact: false } },
        ],
        { intent: 'contact email field in lead conversion modal' },
      )
      .resolve();
    return (await resolved.inputValue()) ?? '';
  }

  /**
   * Returns the value of the account name field in the conversion modal.
   */
  async conversionAccountName(): Promise<string> {
    const resolved = await this.page
      .locate(
        [
          { type: 'testId', value: 'convert-account-name' },
          { type: 'label', value: 'Account name', options: { exact: false } },
        ],
        { intent: 'account name field in lead conversion modal' },
      )
      .resolve();
    return (await resolved.inputValue()) ?? '';
  }

  /**
   * Clicks the "Confirm" button to complete the lead conversion.
   */
  async confirmConvert(): Promise<void> {
    await this.page.click(
      [
        { type: 'testId', value: 'convert-confirm' },
        {
          type: 'role',
          value: 'button',
          options: { name: t('leads.confirmConvert'), exact: false },
        },
      ],
      { intent: 'confirm button to complete lead conversion' },
    );
  }

  // ---------------------------------------------------------------------------
  // Export
  // ---------------------------------------------------------------------------

  /**
   * Returns a resolved locator for the Export PDF button on the lead detail page.
   */
  async exportPdfButtonLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'lead-detail-export-pdf-button' },
          { type: 'role', value: 'button', options: { name: /export pdf/i } },
        ],
        { intent: 'button to export this lead as a single-record PDF' },
      )
      .resolve();
  }

  // ---------------------------------------------------------------------------
  // Edit
  // ---------------------------------------------------------------------------

  /**
   * Clicks the Edit button to enter edit mode.
   */
  async clickEdit(): Promise<void> {
    await this.page.click(
      [
        { type: 'testId', value: 'edit-lead-button' },
        { type: 'role', value: 'button', options: { name: t('leads.edit'), exact: false } },
      ],
      { intent: 'edit button to enter lead edit mode' },
    );
  }

  /**
   * Fills a text field on the edit form.
   *
   * @param testId - data-testid of the input (e.g. 'lead-first-name').
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
      { intent: `lead edit form field labeled ${label}` },
    );
  }

  /**
   * Clicks the Save button to submit the edit form.
   */
  async save(): Promise<void> {
    await this.page.click(
      [
        { type: 'testId', value: 'lead-form-submit' },
        {
          type: 'role',
          value: 'button',
          options: { name: t('leads.save'), exact: false },
        },
      ],
      { intent: 'save button to submit lead edit form' },
    );
  }

  /**
   * Returns whether the lead detail page is in read mode (Edit button visible).
   */
  async isLoaded(): Promise<boolean> {
    try {
      await this.page
        .locate(
          [
            { type: 'testId', value: 'edit-lead-button' },
            {
              type: 'role',
              value: 'button',
              options: { name: t('leads.edit'), exact: false },
            },
          ],
          { intent: 'edit button indicating lead detail page is in read mode' },
        )
        .resolve();
      return true;
    } catch {
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Delete
  // ---------------------------------------------------------------------------

  /**
   * Clicks the "Delete" button on the lead detail page to open the confirmation modal.
   */
  async clickDelete(): Promise<void> {
    await this.page.click(
      [
        { type: 'testId', value: 'delete-lead-button' },
        { type: 'role', value: 'button', options: { name: t('leads.delete'), exact: false } },
      ],
      { intent: 'delete button on lead detail page' },
    );
  }

  /**
   * Confirms the delete in the confirmation modal.
   * Falls back to a role-based "last Delete button" strategy for the confirm modal.
   */
  async confirmDelete(): Promise<void> {
    await this.page.click(
      [
        { type: 'testId', value: 'confirm-delete-confirm' },
        { type: 'role', value: 'button', options: { name: t('common.delete'), exact: false } },
      ],
      { intent: 'confirm delete button in deletion confirmation modal' },
    );
  }

  // ---------------------------------------------------------------------------
  // AI lead scoring (MINCRM-441 prerequisite + MINCRM-441)
  // ---------------------------------------------------------------------------

  /** Returns a resolved locator for the lead score badge. */
  async scoreBadgeLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'lead-score-badge' },
          { type: 'css', value: '[data-testid="lead-score-badge"]' },
        ],
        { intent: 'rule-based lead quality score badge' },
      )
      .resolve();
  }

  /** Returns a resolved locator for the "Why this score?" button. */
  async scoreWhyButtonLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'lead-score-why-button' },
          { type: 'css', value: '[data-testid="lead-score-why-button"]' },
        ],
        { intent: 'button that generates an AI narrative explanation of the lead score' },
      )
      .resolve();
  }

  /** Clicks the "Why this score?" button. */
  async clickScoreWhy(): Promise<void> {
    const locator = await this.scoreWhyButtonLocator();
    await locator.click();
  }

  /** Returns a resolved locator for the inline AI score narrative text. */
  async scoreNarrativeLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'lead-score-narrative' },
          { type: 'css', value: '[data-testid="lead-score-narrative"]' },
        ],
        { intent: 'inline AI-generated narrative explaining the lead score' },
      )
      .resolve();
  }

  // ---------------------------------------------------------------------------
  // State queries
  // ---------------------------------------------------------------------------

  /**
   * Returns the current page URL.
   */
  url(): string {
    return this.page.url();
  }
}
