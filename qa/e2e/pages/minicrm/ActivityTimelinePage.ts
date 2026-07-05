/**
 * ActivityTimelinePage — Page Object for the reusable activity timeline/form
 * embedded on contact, account, and deal detail pages.
 *
 * Covers the "Log activity" flow and the AI call/note summarizer (MINCRM-436).
 * Every element uses a HealingLocator with at least 2 strategies.
 *
 * Page Objects interact with UI only — no business logic, no API calls,
 * no assertions.
 */

import type { PageFacade } from '@framework/fixtures/index.js';
import { t } from '@framework/i18n/locale.js';

/** Subset of Playwright fixtures required by ActivityTimelinePage. */
export interface ActivityTimelinePageContext {
  page: PageFacade;
}

/**
 * Page Object for the activity timeline and its inline create/edit form.
 */
export class ActivityTimelinePage {
  private readonly page: PageFacade;

  constructor(context: ActivityTimelinePageContext) {
    this.page = context.page;
  }

  /**
   * Returns whether an element is currently visible without throwing when it
   * is legitimately absent. locate().resolve() throws StrategyExhaustedError
   * immediately on an absent element rather than waiting for it — unsuitable
   * for "may or may not be rendered" checks. waitForPresent guards presence
   * first so callers can safely treat "not present" as `false`.
   */
  private async isElementCurrentlyVisible(
    testIdSelector: string,
    resolveLocator: () => Promise<{ isVisible(): Promise<boolean> }>,
  ): Promise<boolean> {
    const present = await this.page
      .waitForPresent(testIdSelector, 500)
      .then(() => true)
      .catch(() => false);
    if (!present) return false;
    const locator = await resolveLocator();
    return locator.isVisible().catch(() => false);
  }

  /** Returns true when the "Summarize" action is currently visible in the activity form. */
  async isSummarizeButtonVisible(): Promise<boolean> {
    return this.isElementCurrentlyVisible('[data-testid="activity-summarize-button"]', () =>
      this.summarizeButtonLocator(),
    );
  }

  /** Returns a resolved locator for the "Log activity" button that opens the create form. */
  async addActivityButtonLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'add-activity-button' },
          { type: 'css', value: '[data-testid="add-activity-button"]' },
        ],
        { intent: 'button to open the inline activity create form' },
      )
      .resolve();
  }

  /** Clicks the "Log activity" button to open the create form. */
  async clickAddActivity(): Promise<void> {
    const locator = await this.addActivityButtonLocator();
    await locator.click();
  }

  /** Returns a resolved locator for the activity type select in the create/edit form. */
  async typeSelectLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'activity-type-select' },
          { type: 'css', value: '[data-testid="activity-type-select"]' },
        ],
        { intent: 'activity type select in the create/edit form' },
      )
      .resolve();
  }

  /** Selects the given activity type in the create/edit form. */
  async selectType(activityType: string): Promise<void> {
    const locator = await this.typeSelectLocator();
    await locator.selectOption(activityType);
  }

  /** Returns a resolved locator for the "Summarize" action inside the activity form. */
  async summarizeButtonLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'activity-summarize-button' },
          { type: 'role', value: 'button', options: { name: t('activities.summarize.action') } },
        ],
        { intent: 'button that opens the AI call/note summarizer modal' },
      )
      .resolve();
  }

  /** Clicks the "Summarize" action inside the activity form. */
  async clickSummarize(): Promise<void> {
    const locator = await this.summarizeButtonLocator();
    await locator.click();
  }

  /** Returns a resolved locator for the pasted-text input in the summarizer modal. */
  async summaryInputLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'activity-summary-input' },
          { type: 'css', value: '[data-testid="activity-summary-input"]' },
        ],
        { intent: 'textarea for pasting call transcript or notes to summarize' },
      )
      .resolve();
  }

  /** Fills the pasted-text input in the summarizer modal. */
  async fillSummaryInput(text: string): Promise<void> {
    const locator = await this.summaryInputLocator();
    await locator.fill(text);
  }

  /** Returns a resolved locator for the submit button inside the summarizer modal. */
  async summarySubmitButtonLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'activity-summary-submit' },
          { type: 'css', value: '[data-testid="activity-summary-submit"]' },
        ],
        { intent: 'button that submits pasted text for AI summarization' },
      )
      .resolve();
  }

  /** Clicks the submit button inside the summarizer modal. */
  async clickSummarySubmit(): Promise<void> {
    const locator = await this.summarySubmitButtonLocator();
    await locator.click();
  }

  /** Returns a resolved locator for the editable summary preview textarea. */
  async summaryPreviewLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'activity-summary-preview' },
          { type: 'css', value: '[data-testid="activity-summary-preview"]' },
        ],
        { intent: 'editable preview of the AI-generated summary before applying' },
      )
      .resolve();
  }

  /** Returns a resolved locator for the suggested-tasks list in the summarizer modal. */
  async suggestedTasksListLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'activity-summary-suggested-tasks' },
          { type: 'css', value: '[data-testid="activity-summary-suggested-tasks"]' },
        ],
        { intent: 'list of AI-suggested follow-up tasks in the summarizer modal' },
      )
      .resolve();
  }

  /** Returns a resolved locator for the dismiss button of the suggested task at the given index. */
  async dismissSuggestedTaskButtonLocator(index: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: `activity-summary-task-dismiss-${index}` },
          { type: 'css', value: `[data-testid="activity-summary-task-dismiss-${index}"]` },
        ],
        { intent: 'button that dismisses one AI-suggested follow-up task' },
      )
      .resolve();
  }

  /** Dismisses the suggested task at the given index. */
  async dismissSuggestedTask(index: number): Promise<void> {
    const locator = await this.dismissSuggestedTaskButtonLocator(index);
    await locator.click();
  }

  /** Returns a resolved locator for the "Apply to activity" button. */
  async applySummaryButtonLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'activity-summary-apply' },
          { type: 'css', value: '[data-testid="activity-summary-apply"]' },
        ],
        { intent: 'button that applies the AI summary to the activity notes field' },
      )
      .resolve();
  }

  /** Clicks "Apply to activity" to close the modal and populate the notes field. */
  async clickApplySummary(): Promise<void> {
    const locator = await this.applySummaryButtonLocator();
    await locator.click();
  }

  /** Returns a resolved locator for the activity notes textarea in the form. */
  async notesFieldLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'activity-notes' },
          { type: 'css', value: '[data-testid="activity-notes"]' },
        ],
        { intent: 'activity form notes textarea' },
      )
      .resolve();
  }

  /** Returns a resolved locator for the activity form's submit (save) button. */
  async formSubmitButtonLocator() {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'activity-form-submit' },
          { type: 'css', value: '[data-testid="activity-form-submit"]' },
        ],
        { intent: 'button that saves the activity form' },
      )
      .resolve();
  }

  /** Submits the activity form. */
  async clickFormSubmit(): Promise<void> {
    const locator = await this.formSubmitButtonLocator();
    await locator.click();
  }
}
