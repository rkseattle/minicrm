/**
 * DealDetailPage — Page Object for the MiniCRM deal detail screen.
 *
 * Covers the read/edit view at `/deals/:id`. Every element uses a
 * HealingLocator with at least 2 strategies.
 *
 * Page Objects interact with UI only — no business logic, no API calls,
 * no assertions.
 *
 *
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
   *
   * The role fallback is scoped to the detail page's own action bar
   * (data-testid="deal-detail-actions") — an unscoped `getByRole('button',
   * { name: /delete/i })` also matches a linked activity's own per-row
   * delete-activity-<uuid> button (same accessible name "Delete"), causing
   * a Playwright strict-mode violation whenever the deal has a linked
   * activity (e.g. F7-D3). Scoping to the action bar makes the fallback
   * unambiguous regardless of what else is on the page.
   */
  async clickDelete(): Promise<void> {
    await this.page.click(
      [
        { type: 'testId', value: 'delete-deal-button' },
        {
          type: 'role',
          value: 'button',
          options: { name: /delete/i },
          within: 'deal-detail-actions',
        },
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
  async nameInputLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'deal-name-input' },
          { type: 'label', value: 'Name', options: { exact: false } },
        ],
        { intent: 'deal name text input field on deal form' },
      )
      .resolve(timeout);
  }

  /**
   * Returns a resolved locator for the deal stage select on the deal form.
   */
  async stageSelectLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'deal-stage-select' },
          { type: 'role', value: 'combobox', options: { name: /stage/i } },
        ],
        { intent: 'deal pipeline stage selector on deal form' },
      )
      .resolve(timeout);
  }

  /**
   * Returns a resolved locator for the deal value input on the deal form.
   */
  async valueInputLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'deal-value-input' },
          { type: 'label', value: 'Value', options: { exact: false } },
        ],
        { intent: 'deal monetary value input field on deal form' },
      )
      .resolve(timeout);
  }

  /**
   * Returns a resolved locator for the deal close date input on the deal form.
   */
  async closeDateInputLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'deal-close-date-input' },
          { type: 'label', value: 'Close date', options: { exact: false } },
        ],
        { intent: 'deal expected close date input on deal form' },
      )
      .resolve(timeout);
  }

  /**
   * Returns a resolved locator for the deal account select on the deal form.
   */
  async accountSelectLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'deal-account-select' },
          { type: 'role', value: 'combobox', options: { name: /account/i } },
        ],
        { intent: 'account selector on the deal form' },
      )
      .resolve(timeout);
  }

  /**
   * Returns a resolved locator for the deal form submit button.
   */
  async submitLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'deal-form-submit' },
          { type: 'role', value: 'button', options: { name: /save|submit/i } },
        ],
        { intent: 'submit button on the deal form' },
      )
      .resolve(timeout);
  }

  /**
   * Returns a resolved locator for the deal name heading on the detail page.
   *
   * The role-based fallback is scoped to level: 1 rather than a bare
   * `heading` role: the page renders several h2 sub-section headings (Deal
   * Health, Proposal Draft, Stakeholder Map, etc.) in the same DOM tree, so
   * an unscoped heading role matches all of them too — see
   * AutomationPage.headingLocator() for the identical failure mode. The deal
   * name itself is dynamic per-test data, so an exact-text match (used for
   * the other fixes of this bug class) isn't viable here; level: 1 alone is
   * sufficient since this page has exactly one h1.
   */
  async dealNameLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'deal-name' },
          { type: 'role', value: 'heading', options: { level: 1 } },
        ],
        // Extended timeout: the deal API response arrives near networkidle, and
        // the React render cycle that replaces the loading paragraph with the h1
        // can land just after the 2 s default window under load. (heal-trends)
        { intent: 'deal name heading on the deal detail page', fallbackTimeout: 8_000 },
      )
      .resolve(timeout);
  }

  /**
   * Returns a resolved locator for the Export PDF button on the deal detail page.
   */
  async exportPdfButtonLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'deal-detail-export-pdf-button' },
          { type: 'role', value: 'button', options: { name: /export pdf/i } },
        ],
        { intent: 'button to export this deal as a single-record PDF' },
      )
      .resolve(timeout);
  }

  /**
   * Returns a resolved locator for the linked contacts section heading.
   */
  async linkedContactsHeadingLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'linked-contacts-heading' },
          { type: 'role', value: 'heading', options: { name: /contact/i } },
        ],
        { intent: 'linked contacts section heading on deal detail page' },
      )
      .resolve(timeout);
  }

  /**
   * Returns a resolved locator for the contact link select dropdown.
   */
  async linkContactSelectLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'link-contact-select' },
          { type: 'role', value: 'combobox', options: { name: /contact/i } },
        ],
        { intent: 'dropdown to select a contact to link to the deal' },
      )
      .resolve(timeout);
  }

  /**
   * Returns a resolved locator for the link contact button.
   */
  async linkContactButtonLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'link-contact-button' },
          { type: 'role', value: 'button', options: { name: /link/i } },
        ],
        { intent: 'button to confirm linking the selected contact to the deal' },
      )
      .resolve(timeout);
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
  async linkedContactsEmptyLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'linked-contacts-empty' },
          { type: 'role', value: 'status' },
        ],
        { intent: 'empty state message when no contacts are linked to the deal' },
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
        { intent: 'attachments section container on deal detail page' },
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
        { intent: 'file input for uploading attachments on deal detail page' },
      )
      .resolve(timeout);
  }

  /**
   * Returns a resolved locator for the attachments list container.
   * Returns null if not present.
   */
  async attachmentsListLocator(timeout?: number) {
    // eslint-disable-next-line local/require-locator-fallback -- unnamed <ul> with no accessible name; role:list matches every list on the page
    return this.page
      .locate([{ type: 'testId', value: 'attachments-list' }], {
        intent: 'list of uploaded attachments on deal detail page',
      })
      .resolve(timeout)
      .catch(() => null);
  }

  /**
   * Returns a resolved locator for the attachments upload error message.
   * Returns null if not present.
   */
  async attachmentsUploadErrorLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'attachments-upload-error' },
          { type: 'role', value: 'alert' },
        ],
        { intent: 'upload error message when attachment is rejected on deal detail page' },
      )
      .resolve(timeout)
      .catch(() => null);
  }

  /**
   * Returns a resolved locator for the not-found alert paragraph shown when
   * navigating to a deal ID that does not exist.
   */
  async notFoundAlertLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'css', value: 'p[role="alert"]' },
          { type: 'css', value: 'main p[role="alert"]' },
        ],
        { intent: 'not-found message on the deal detail page for an invalid id' },
      )
      .resolve(timeout);
  }

  /**
   * Returns a resolved locator for the back-to-deals link on the not-found page.
   */
  async notFoundBackLinkLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'css', value: 'main a[href="/deals"]' },
          { type: 'css', value: 'main a' },
        ],
        { intent: 'back to deals navigation link on the not-found page' },
      )
      .resolve(timeout);
  }

  /**
   * Returns the current page URL.
   */
  url(): string {
    return this.page.url();
  }

  // ── AI deal health check ──────────────────────────────────────────

  /**
   * Returns a resolved locator for the deal health section heading.
   */
  async healthCheckHeadingLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'deal-health-heading' },
          { type: 'role', value: 'heading', options: { name: /health/i } },
        ],
        { intent: 'heading for the AI deal health section on the deal detail page' },
      )
      .resolve(timeout);
  }

  /** Returns true when the deal health section heading is currently visible. */
  async isHealthCheckHeadingVisible(): Promise<boolean> {
    return this.isElementCurrentlyVisible('[data-testid="deal-health-heading"]', () =>
      this.healthCheckHeadingLocator(),
    );
  }

  /**
   * Returns a resolved locator for the empty state shown before any check has run.
   * CSS fallback scopes to the deal health section to avoid matching unrelated
   * empty-state text elsewhere on the page.
   */
  async healthCheckEmptyStateLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'deal-health-empty' },
          {
            type: 'css',
            value:
              'section:has([data-testid="deal-health-heading"]) [data-testid="deal-health-empty"]',
          },
        ],
        { intent: 'empty state message shown before a deal health check has been run' },
      )
      .resolve(timeout);
  }

  /**
   * Returns a resolved locator for the "Check health" action button.
   */
  async runHealthCheckButtonLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'run-deal-health-check-button' },
          { type: 'role', value: 'button', options: { name: /check health/i } },
        ],
        { intent: 'button to run the AI deal health check on the deal detail page' },
      )
      .resolve(timeout);
  }

  /**
   * Returns a resolved locator for the rendered health check result container.
   * CSS fallback anchors on the heading's data-testid, scoped to the deal
   * health section, since the result container has no accessible role or
   * text that is stable independent of the AI-generated content.
   */
  async healthCheckResultLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'deal-health-result' },
          {
            type: 'css',
            value:
              'section:has([data-testid="deal-health-heading"]) [data-testid="deal-health-result"]',
          },
        ],
        {
          intent:
            'container for the AI deal health check result — status badge, narrative, next actions',
        },
      )
      .resolve(timeout);
  }

  /** Returns true when the deal health check result container is currently visible. */
  async isHealthCheckResultVisible(): Promise<boolean> {
    return this.isElementCurrentlyVisible('[data-testid="deal-health-result"]', () =>
      this.healthCheckResultLocator(),
    );
  }

  /**
   * Returns a resolved locator for the health check error message.
   * CSS fallback scopes to the deal health section specifically — role="alert"
   * alone would be ambiguous since several other error banners on this page
   * also use role="alert".
   */
  async healthCheckErrorLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'deal-health-error' },
          {
            type: 'css',
            value: 'section:has([data-testid="deal-health-heading"]) [role="alert"]',
          },
        ],
        { intent: 'error message shown when the AI deal health check request fails' },
      )
      .resolve(timeout);
  }

  // ── AI stage advancement suggestion ───────────────────────────────

  /**
   * Returns a resolved locator for the "Ready to advance?" indicator button.
   */
  async stageAdvancementIndicatorLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'stage-advancement-indicator' },
          { type: 'role', value: 'button', options: { name: /ready to advance/i } },
        ],
        { intent: 'AI stage advancement indicator on the deal detail page' },
      )
      .resolve(timeout);
  }

  /** Returns true when the stage advancement indicator is currently visible. */
  async isStageAdvancementIndicatorVisible(): Promise<boolean> {
    return this.isElementCurrentlyVisible('[data-testid="stage-advancement-indicator"]', () =>
      this.stageAdvancementIndicatorLocator(),
    );
  }

  // ── AI objection pattern matching ──────────────────────────────────

  /** Returns a resolved locator for a specific activity's objection category badge. */
  async objectionCategoryBadgeLocator(activityId: string) {
    return this.page
      .locate(
        [
          { type: 'testId', value: `objection-category-badge-${activityId}` },
          { type: 'css', value: `[data-testid="objection-category-badge-${activityId}"]` },
        ],
        { intent: 'AI objection category badge on an activity in the timeline' },
      )
      .resolve();
  }

  /** Returns true when a specific activity's objection category badge is currently visible. */
  async isObjectionCategoryBadgeVisible(activityId: string): Promise<boolean> {
    return this.isElementCurrentlyVisible(
      `[data-testid="objection-category-badge-${activityId}"]`,
      () => this.objectionCategoryBadgeLocator(activityId),
    );
  }

  /**
   * Returns a resolved locator for a specific activity's card in the timeline.
   *
   * `fallbackTimeout` is threaded from the caller rather than left on the 2s
   * default: the timeline is gated on the `feature-flags/me` query
   * (EntityDetailSidebar), so `ActivityTimeline` does not mount — and
   * `GET /api/v1/activities` never fires — until that request resolves. Under CI
   * worker contention it has been measured at 2.9s, which exhausts both default
   * probes before the element is ever attached. Matches ContactDetailPage's
   * `fallbackTimeout: timeout` precedent.
   */
  async activityItemLocator(activityId: string, fallbackTimeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: `activity-item-${activityId}` },
          { type: 'css', value: `[data-testid="activity-item-${activityId}"]` },
        ],
        { fallbackTimeout, intent: 'activity timeline card for a specific activity' },
      )
      .resolve();
  }

  // ── AI proposal draft generation ───────────────────────────────────

  /** Returns a resolved locator for the "Generate Proposal Draft" button. */
  async generateProposalDraftButtonLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'generate-proposal-draft-button' },
          { type: 'role', value: 'button', options: { name: /generate proposal draft/i } },
        ],
        { intent: 'button to generate an AI proposal draft on the deal detail page' },
      )
      .resolve(timeout);
  }

  /** Returns true when the "Generate Proposal Draft" button is currently visible. */
  async isGenerateProposalDraftButtonVisible(): Promise<boolean> {
    return this.isElementCurrentlyVisible('[data-testid="generate-proposal-draft-button"]', () =>
      this.generateProposalDraftButtonLocator(),
    );
  }

  /** Returns a resolved locator for the full-screen proposal draft editor. */
  async proposalDraftEditorLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'proposal-draft-editor' },
          { type: 'role', value: 'dialog' },
        ],
        { intent: 'full-screen AI proposal draft editor panel' },
      )
      .resolve(timeout);
  }

  /** Returns a resolved locator for the proposal draft editor's dismiss button. */
  async proposalDraftDismissButtonLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'proposal-draft-dismiss-button' },
          {
            type: 'css',
            value:
              '[data-testid="proposal-draft-editor"] [data-testid="proposal-draft-dismiss-button"]',
          },
        ],
        { intent: 'button to dismiss the AI proposal draft editor without exporting' },
      )
      .resolve(timeout);
  }
}
