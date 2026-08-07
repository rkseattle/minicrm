/**
 * EmailDraftPanelPage — Page Object for the AI email draft sidebar panel. (MINCRM-437)
 *
 * The panel is opened from either the Contact detail page or the Activity
 * timeline's "Draft Email" action; its own locators are shared regardless of
 * entry point. Every element uses a HealingLocator with at least 2 strategies.
 *
 * Page Objects interact with UI only — no business logic, no API calls,
 * no assertions.
 */

import type { PageFacade } from '@framework/fixtures/index.js';
import { t } from '@framework/i18n/locale.js';

/** Subset of Playwright fixtures required by EmailDraftPanelPage. */
export interface EmailDraftPanelPageContext {
  page: PageFacade;
}

/**
 * Page Object for the AI email draft sidebar panel.
 */
export class EmailDraftPanelPage {
  private readonly page: PageFacade;

  constructor(context: EmailDraftPanelPageContext) {
    this.page = context.page;
  }

  /** Returns a resolved locator for the panel container. */
  async panelLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'email-draft-panel' },
          { type: 'role', value: 'dialog', options: { name: t('emailDraft.panelTitle') } },
        ],
        { intent: 'AI email draft sidebar panel' },
      )
      .resolve(timeout);
  }

  /** Returns a resolved locator for the editable subject input. */
  async subjectInputLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'email-draft-subject' },
          { type: 'css', value: '[data-testid="email-draft-subject"]' },
        ],
        { intent: 'editable subject line of the AI-generated email draft' },
      )
      .resolve(timeout);
  }

  /** Returns a resolved locator for the editable body textarea. */
  async bodyInputLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'email-draft-body' },
          { type: 'css', value: '[data-testid="email-draft-body"]' },
        ],
        { intent: 'editable body of the AI-generated email draft' },
      )
      .resolve(timeout);
  }

  /** Returns a resolved locator for the tone selector. */
  async toneSelectLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'email-draft-tone-select' },
          { type: 'css', value: '[data-testid="email-draft-tone-select"]' },
        ],
        { intent: 'tone selector for regenerating the AI email draft' },
      )
      .resolve(timeout);
  }

  /** Selects the given tone, triggering a regeneration. */
  async selectTone(tone: string): Promise<void> {
    const locator = await this.toneSelectLocator();
    await locator.selectOption(tone);
  }

  /** Returns a resolved locator for the copy-to-clipboard button. */
  async copyButtonLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'email-draft-copy-button' },
          { type: 'role', value: 'button', options: { name: t('emailDraft.copyToClipboard') } },
        ],
        { intent: 'button that copies the email draft to the clipboard' },
      )
      .resolve(timeout);
  }

  /** Clicks the copy-to-clipboard button. */
  async clickCopyToClipboard(timeout?: number): Promise<void> {
    const locator = await this.copyButtonLocator(timeout);
    await locator.click();
  }

  /** Returns a resolved locator for the dismiss button. */
  async dismissButtonLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'email-draft-dismiss' },
          { type: 'role', value: 'button', options: { name: t('emailDraft.dismiss') } },
        ],
        { intent: 'button that dismisses the AI email draft panel' },
      )
      .resolve(timeout);
  }

  /** Clicks the dismiss button. */
  async clickDismiss(timeout?: number): Promise<void> {
    const locator = await this.dismissButtonLocator(timeout);
    await locator.click();
  }
}
