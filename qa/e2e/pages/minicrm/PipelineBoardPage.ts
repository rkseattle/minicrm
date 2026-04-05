/**
 * PipelineBoardPage — Page Object for the MiniCRM pipeline board screen.
 *
 * Covers the Kanban view at `/deals`. Stage changes are driven via the
 * per-deal stage selector dropdown (deal-card-stage-select-{id}).
 * Terminal-stage moves (Closed Won / Closed Lost) require interacting with
 * CloseDealModal before the PATCH is submitted.
 *
 * Page Objects interact with UI only — no business logic, no API calls,
 * no assertions.
 *
 * MINCRM-110
 */

import type { Page } from '@playwright/test';
import type { HealPage } from '@framework/fixtures/heal-page.fixture.js';

/** Subset of Playwright fixtures required by PipelineBoardPage. */
export interface PipelineBoardPageContext {
  page: Page;
  healPage: HealPage;
  testName: string;
}

/** Pipeline stages that can be selected from the stage dropdown. */
export type PipelineStage =
  | 'Prospecting'
  | 'Qualification'
  | 'Proposal'
  | 'Negotiation'
  | 'Closed Won'
  | 'Closed Lost';

/**
 * Page Object for the MiniCRM pipeline board.
 */
export class PipelineBoardPage {
  private readonly page: Page;
  private readonly healPage: HealPage;
  private readonly testName: string;

  static readonly PATH = '/deals';

  constructor(context: PipelineBoardPageContext) {
    this.page = context.page;
    this.healPage = context.healPage;
    this.testName = context.testName;
  }

  /**
   * Navigates directly to the pipeline board URL.
   */
  async navigate(): Promise<void> {
    await this.page.goto(PipelineBoardPage.PATH);
  }

  /**
   * Returns whether the pipeline board is loaded (board container visible).
   */
  async isLoaded(): Promise<boolean> {
    try {
      await this.healPage
        .locate([
          { type: 'testId', value: 'pipeline-board' },
          { type: 'css', value: '[data-testid="pipeline-board"]' },
        ])
        .resolve(this.testName);
      return true;
    } catch {
      return false;
    }
  }

  /** All pipeline stage slugs in board order. */
  private static readonly STAGE_SLUGS = [
    'prospecting',
    'qualification',
    'proposal',
    'negotiation',
    'closed-won',
    'closed-lost',
  ] as const;

  /**
   * Returns the stage slug (column testid slug) that currently contains the
   * given deal card.
   *
   * Checks each stage column in order; returns the slug of the first column
   * whose `stage-column-{slug}` container holds a `deal-card-{dealId}` element.
   *
   * @param dealId - Deal UUID to locate.
   * @returns The column slug (e.g. 'prospecting', 'closed-won') or null.
   */
  async getDealColumnSlug(dealId: string): Promise<string | null> {
    await this.page.waitForLoadState('networkidle');

    for (const slug of PipelineBoardPage.STAGE_SLUGS) {
      const cardInColumn = this.page.locator(
        `[data-testid="stage-column-${slug}"] [data-testid="deal-card-${dealId}"]`,
      );
      const count = await cardInColumn.count();
      if (count > 0) return slug;
    }
    return null;
  }

  /**
   * Changes a deal's stage by selecting from its stage dropdown.
   * For non-terminal stages this resolves after the select change.
   * For terminal stages (Closed Won / Closed Lost) the CloseDealModal is
   * submitted with today's date automatically.
   *
   * @param dealId - Deal UUID.
   * @param stage - Target stage value.
   */
  async selectDealStage(dealId: string, stage: PipelineStage): Promise<void> {
    const selectTestId = `deal-card-stage-select-${dealId}`;
    const select = this.page.locator(`[data-testid="${selectTestId}"]`);
    await select.selectOption(stage);

    const isTerminal = stage === 'Closed Won' || stage === 'Closed Lost';
    if (isTerminal) {
      // CloseDealModal opens — fill required close_date and confirm.
      const modal = this.page.locator('[data-testid="close-deal-modal"]');
      await modal.waitFor({ state: 'visible' });

      const dateInput = this.page.locator('[data-testid="close-deal-date-input"]');
      // Default to today's date in YYYY-MM-DD format.
      const today = new Date().toISOString().slice(0, 10);
      await dateInput.fill(today);

      await this.healPage.click([
        { type: 'testId', value: 'close-deal-confirm' },
        { type: 'role', value: 'button', options: { name: 'Confirm', exact: false } },
      ]);

      await modal.waitFor({ state: 'hidden' });
    }

    // Wait for any in-flight PATCH to settle before returning.
    await this.page.waitForLoadState('networkidle');
  }

  /**
   * Returns the current page URL.
   */
  url(): string {
    return this.page.url();
  }
}
