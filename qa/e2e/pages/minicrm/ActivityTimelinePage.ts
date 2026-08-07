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
  async addActivityButtonLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'add-activity-button' },
          { type: 'css', value: '[data-testid="add-activity-button"]' },
        ],
        { intent: 'button to open the inline activity create form' },
      )
      .resolve(timeout);
  }

  /** Clicks the "Log activity" button to open the create form. */
  async clickAddActivity(): Promise<void> {
    const locator = await this.addActivityButtonLocator();
    await locator.click();
  }

  /** Returns a resolved locator for the activity type select in the create/edit form. */
  async typeSelectLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'activity-type-select' },
          { type: 'css', value: '[data-testid="activity-type-select"]' },
        ],
        { intent: 'activity type select in the create/edit form' },
      )
      .resolve(timeout);
  }

  /** Selects the given activity type in the create/edit form. */
  async selectType(activityType: string): Promise<void> {
    const locator = await this.typeSelectLocator();
    await locator.selectOption(activityType);
  }

  /** Returns a resolved locator for the "Summarize" action inside the activity form. */
  async summarizeButtonLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'activity-summarize-button' },
          { type: 'role', value: 'button', options: { name: t('activities.summarize.action') } },
        ],
        { intent: 'button that opens the AI call/note summarizer modal' },
      )
      .resolve(timeout);
  }

  /** Clicks the "Summarize" action inside the activity form. */
  async clickSummarize(): Promise<void> {
    const locator = await this.summarizeButtonLocator();
    await locator.click();
  }

  /** Returns a resolved locator for the pasted-text input in the summarizer modal. */
  async summaryInputLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'activity-summary-input' },
          { type: 'css', value: '[data-testid="activity-summary-input"]' },
        ],
        { intent: 'textarea for pasting call transcript or notes to summarize' },
      )
      .resolve(timeout);
  }

  /** Fills the pasted-text input in the summarizer modal. */
  async fillSummaryInput(text: string): Promise<void> {
    const locator = await this.summaryInputLocator();
    await locator.fill(text);
  }

  /** Returns a resolved locator for the submit button inside the summarizer modal. */
  async summarySubmitButtonLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'activity-summary-submit' },
          { type: 'css', value: '[data-testid="activity-summary-submit"]' },
        ],
        { intent: 'button that submits pasted text for AI summarization' },
      )
      .resolve(timeout);
  }

  /** Clicks the submit button inside the summarizer modal. */
  async clickSummarySubmit(): Promise<void> {
    const locator = await this.summarySubmitButtonLocator();
    await locator.click();
  }

  /** Returns a resolved locator for the editable summary preview textarea. */
  async summaryPreviewLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'activity-summary-preview' },
          { type: 'css', value: '[data-testid="activity-summary-preview"]' },
        ],
        { intent: 'editable preview of the AI-generated summary before applying' },
      )
      .resolve(timeout);
  }

  /** Returns a resolved locator for the suggested-tasks list in the summarizer modal. */
  async suggestedTasksListLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'activity-summary-suggested-tasks' },
          { type: 'css', value: '[data-testid="activity-summary-suggested-tasks"]' },
        ],
        { intent: 'list of AI-suggested follow-up tasks in the summarizer modal' },
      )
      .resolve(timeout);
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
  async applySummaryButtonLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'activity-summary-apply' },
          { type: 'css', value: '[data-testid="activity-summary-apply"]' },
        ],
        { intent: 'button that applies the AI summary to the activity notes field' },
      )
      .resolve(timeout);
  }

  /** Clicks "Apply to activity" to close the modal and populate the notes field. */
  async clickApplySummary(): Promise<void> {
    const locator = await this.applySummaryButtonLocator();
    await locator.click();
  }

  /** Returns a resolved locator for the activity notes textarea in the form. */
  async notesFieldLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'activity-notes' },
          { type: 'css', value: '[data-testid="activity-notes"]' },
        ],
        { intent: 'activity form notes textarea' },
      )
      .resolve(timeout);
  }

  /** Returns a resolved locator for the activity form's submit (save) button. */
  async formSubmitButtonLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'activity-form-submit' },
          { type: 'css', value: '[data-testid="activity-form-submit"]' },
        ],
        { intent: 'button that saves the activity form' },
      )
      .resolve(timeout);
  }

  /** Submits the activity form. */
  async clickFormSubmit(): Promise<void> {
    const locator = await this.formSubmitButtonLocator();
    await locator.click();
  }

  /** Returns a resolved locator for the task-suggestion panel. (MINCRM-438) */
  async taskSuggestionPanelLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'task-suggestion-panel' },
          { type: 'css', value: '[data-testid="task-suggestion-panel"]' },
        ],
        { intent: 'AI follow-up task suggestion panel shown after saving an activity' },
      )
      .resolve(timeout);
  }

  /** Returns true when the task-suggestion panel is currently visible. (MINCRM-438) */
  async isTaskSuggestionPanelVisible(): Promise<boolean> {
    return this.isElementCurrentlyVisible('[data-testid="task-suggestion-panel"]', () =>
      this.taskSuggestionPanelLocator(),
    );
  }

  /** Returns a resolved locator for the "Add Task" button on the suggestion at the given index. */
  async acceptTaskSuggestionButtonLocator(index: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: `task-suggestion-accept-${index}` },
          { type: 'css', value: `[data-testid="task-suggestion-accept-${index}"]` },
        ],
        { intent: 'button that accepts one AI-suggested follow-up task' },
      )
      .resolve();
  }

  /** Accepts the task suggestion at the given index. (MINCRM-438) */
  async acceptTaskSuggestion(index: number): Promise<void> {
    const locator = await this.acceptTaskSuggestionButtonLocator(index);
    await locator.click();
  }

  /** Returns a resolved locator for the activity direction select (Call/Email only). */
  async directionSelectLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'activity-direction-select' },
          { type: 'css', value: '[data-testid="activity-direction-select"]' },
        ],
        { intent: 'activity direction select, shown for Call and Email types' },
      )
      .resolve(timeout);
  }

  /** Returns a resolved locator for the activity subject input. */
  async subjectInputLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'activity-subject' },
          { type: 'css', value: '[data-testid="activity-subject"]' },
        ],
        { intent: 'activity form subject input' },
      )
      .resolve(timeout);
  }

  /**
   * Logs an activity via the create form: opens it, sets type/direction/subject,
   * and submits. Direction is only set for Call/Email types. (MINCRM-438)
   */
  async logActivity(params: { type: string; direction?: string; subject: string }): Promise<void> {
    await this.clickAddActivity();
    await this.selectType(params.type);
    if (params.direction) {
      const directionLocator = await this.directionSelectLocator();
      await directionLocator.selectOption(params.direction);
    }
    const subjectLocator = await this.subjectInputLocator();
    await subjectLocator.fill(params.subject);
    await this.clickFormSubmit();
  }

  // ── AI pre-meeting brief generation (MINCRM-465) ─────────────────────────────

  /** Returns a resolved locator for the "Generate Brief" button, scoped to an activity ID. */
  async generateBriefButtonLocator(activityId: string) {
    return this.page
      .locate(
        [
          { type: 'testId', value: `generate-brief-${activityId}` },
          { type: 'css', value: `[data-testid="generate-brief-${activityId}"]` },
        ],
        { intent: 'Generate Brief button on an activity timeline row' },
      )
      .resolve();
  }

  /** Returns true when the "Generate Brief" button is currently visible, scoped to an activity ID. */
  async isGenerateBriefButtonVisible(activityId: string): Promise<boolean> {
    return this.isElementCurrentlyVisible(`[data-testid="generate-brief-${activityId}"]`, () =>
      this.generateBriefButtonLocator(activityId),
    );
  }

  /** Clicks the "Generate Brief" button, scoped to an activity ID. */
  async clickGenerateBrief(activityId: string): Promise<void> {
    const locator = await this.generateBriefButtonLocator(activityId);
    await locator.click();
  }

  /** Returns a resolved locator for the meeting brief panel. */
  async meetingBriefPanelLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'meeting-brief-panel' },
          { type: 'css', value: '[data-testid="meeting-brief-panel"]' },
        ],
        { intent: 'AI pre-meeting brief panel shown after generating a brief' },
      )
      .resolve(timeout);
  }

  /** Returns true when the meeting brief panel is currently visible. */
  async isMeetingBriefPanelVisible(): Promise<boolean> {
    return this.isElementCurrentlyVisible('[data-testid="meeting-brief-panel"]', () =>
      this.meetingBriefPanelLocator(),
    );
  }
}
