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

import type { Page } from '@playwright/test';
import type { HealPage } from '@framework/fixtures/heal-page.fixture.js';
import { t } from '@framework/i18n/locale.js';

// ---------------------------------------------------------------------------
// Fixture context
// ---------------------------------------------------------------------------

/** Subset of Playwright fixtures required by LeadDetailPage. */
export interface LeadDetailPageContext {
  page: Page;
  healPage: HealPage;
  /** Current test name, passed to HealingLocator.resolve() for heal audit records. */
  testName: string;
}

// ---------------------------------------------------------------------------
// LeadDetailPage
// ---------------------------------------------------------------------------

/**
 * Page Object for the MiniCRM lead detail screen.
 */
export class LeadDetailPage {
  private readonly page: Page;
  private readonly healPage: HealPage;
  private readonly testName: string;

  /**
   * @param context - Playwright fixture context containing page, healPage, and testName.
   */
  constructor(context: LeadDetailPageContext) {
    this.page = context.page;
    this.healPage = context.healPage;
    this.testName = context.testName;
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
    await this.healPage.click([
      { type: 'testId', value: 'convert-lead-button' },
      { type: 'role', value: 'button', options: { name: t('leads.convert'), exact: false } },
    ]);
  }

  /**
   * Returns the value of the contact first name field in the conversion modal.
   */
  async conversionContactFirstName(): Promise<string> {
    const resolved = await this.healPage
      .locate([
        { type: 'testId', value: 'convert-contact-first-name' },
        { type: 'label', value: 'First name', options: { exact: false } },
      ])
      .resolve(this.testName);
    return (await resolved.inputValue()) ?? '';
  }

  /**
   * Returns the value of the contact email field in the conversion modal.
   */
  async conversionContactEmail(): Promise<string> {
    const resolved = await this.healPage
      .locate([
        { type: 'testId', value: 'convert-contact-email' },
        { type: 'label', value: 'Email', options: { exact: false } },
      ])
      .resolve(this.testName);
    return (await resolved.inputValue()) ?? '';
  }

  /**
   * Returns the value of the account name field in the conversion modal.
   */
  async conversionAccountName(): Promise<string> {
    const resolved = await this.healPage
      .locate([
        { type: 'testId', value: 'convert-account-name' },
        { type: 'label', value: 'Account name', options: { exact: false } },
      ])
      .resolve(this.testName);
    return (await resolved.inputValue()) ?? '';
  }

  /**
   * Clicks the "Confirm" button to complete the lead conversion.
   */
  async confirmConvert(): Promise<void> {
    await this.healPage.click([
      { type: 'testId', value: 'convert-confirm' },
      { type: 'role', value: 'button', options: { name: t('leads.confirmConvert'), exact: false } },
    ]);
  }

  // ---------------------------------------------------------------------------
  // Delete
  // ---------------------------------------------------------------------------

  /**
   * Clicks the "Delete" button on the lead detail page to open the confirmation modal.
   */
  async clickDelete(): Promise<void> {
    await this.healPage.click([
      { type: 'testId', value: 'delete-lead-button' },
      { type: 'role', value: 'button', options: { name: t('leads.delete'), exact: false } },
    ]);
  }

  /**
   * Confirms the delete in the confirmation modal.
   * Falls back to a role-based "last Delete button" strategy for the confirm modal.
   */
  async confirmDelete(): Promise<void> {
    await this.healPage.click([
      { type: 'testId', value: 'confirm-delete-confirm' },
      { type: 'role', value: 'button', options: { name: t('common.delete'), exact: false } },
    ]);
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
