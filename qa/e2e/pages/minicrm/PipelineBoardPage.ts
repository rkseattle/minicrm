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
   * Returns true when running in the mobile single-stage view.
   * Detected by checking whether the mobile-prefixed stage column is visible.
   */
  private async isMobileView(): Promise<boolean> {
    try {
      const mobileColumn = await this.healPage
        .locate([
          { type: 'css', value: '[data-testid^="mobile-stage-column-"]' },
          { type: 'css', value: '[data-testid="mobile-stage-column-prospecting"]' },
        ])
        .resolve(this.testName);
      return mobileColumn
        .first()
        .isVisible()
        .catch(() => false);
    } catch {
      return false;
    }
  }

  /**
   * Returns the stage slug (column testid slug) that currently contains the
   * given deal card.
   *
   * On desktop, checks each stage column in order. On mobile, navigates through
   * all stages one at a time (only one column is rendered at a time).
   *
   * @param dealId - Deal UUID to locate.
   * @returns The column slug (e.g. 'prospecting', 'closed-won') or null.
   */
  async getDealColumnSlug(dealId: string): Promise<string | null> {
    await this.page.waitForLoadState('networkidle');

    const mobile = await this.isMobileView();

    if (!mobile) {
      for (const slug of PipelineBoardPage.STAGE_SLUGS) {
        try {
          const cardInColumn = await this.healPage
            .locate([
              {
                type: 'css',
                value: `[data-testid="stage-column-${slug}"] [data-testid="deal-card-${dealId}"]`,
              },
              { type: 'css', value: `[data-testid="deal-card-${dealId}"]` },
            ])
            .resolve(this.testName);
          if ((await cardInColumn.count()) > 0) return slug;
        } catch {
          // Card not in this column — continue.
        }
      }
      return null;
    }

    // Mobile: navigate through each stage and check the single visible column.
    // First, rewind to stage 0 (Prospecting) by clicking prev until disabled.
    for (let i = 0; i < PipelineBoardPage.STAGE_SLUGS.length; i++) {
      try {
        const prevBtn = await this.healPage
          .locate([
            { type: 'testId', value: 'pipeline-mobile-prev' },
            { type: 'css', value: '[data-testid="pipeline-mobile-prev"]' },
          ])
          .resolve(this.testName);
        if (!(await prevBtn.isEnabled().catch(() => false))) break;
        await prevBtn.click();
        await this.page.waitForLoadState('networkidle');
      } catch {
        break;
      }
    }

    for (const slug of PipelineBoardPage.STAGE_SLUGS) {
      try {
        const card = await this.healPage
          .locate([
            { type: 'testId', value: `mobile-deal-card-${dealId}` },
            { type: 'css', value: `[data-testid="mobile-deal-card-${dealId}"]` },
          ])
          .resolve(this.testName);
        if (await card.isVisible().catch(() => false)) return slug;
      } catch {
        // Card not visible in this column.
      }
      try {
        const nextBtn = await this.healPage
          .locate([
            { type: 'testId', value: 'pipeline-mobile-next' },
            { type: 'css', value: '[data-testid="pipeline-mobile-next"]' },
          ])
          .resolve(this.testName);
        if (!(await nextBtn.isEnabled().catch(() => false))) break;
        await nextBtn.click();
        await this.page.waitForLoadState('networkidle');
      } catch {
        break;
      }
    }
    return null;
  }

  /**
   * On mobile, navigates to the stage column that contains the given deal by
   * clicking the next/prev buttons until the deal card is visible.
   *
   * @param dealId - Deal UUID.
   */
  private async mobileNavigateToStageWithDeal(dealId: string): Promise<void> {
    const STAGE_COUNT = PipelineBoardPage.STAGE_SLUGS.length;
    for (let i = 0; i < STAGE_COUNT; i++) {
      try {
        const card = await this.healPage
          .locate([
            { type: 'testId', value: `mobile-deal-card-${dealId}` },
            { type: 'css', value: `[data-testid="mobile-deal-card-${dealId}"]` },
          ])
          .resolve(this.testName);
        if (await card.isVisible().catch(() => false)) return;
      } catch {
        // Not visible in this column — try next.
      }
      try {
        const nextBtn = await this.healPage
          .locate([
            { type: 'testId', value: 'pipeline-mobile-next' },
            { type: 'css', value: '[data-testid="pipeline-mobile-next"]' },
          ])
          .resolve(this.testName);
        if (await nextBtn.isEnabled().catch(() => false)) {
          await nextBtn.click();
          await this.page.waitForLoadState('networkidle');
        }
      } catch {
        break;
      }
    }
  }

  /**
   * Changes a deal's stage by selecting from its stage dropdown.
   * For non-terminal stages this resolves after the select change.
   * For terminal stages (Closed Won / Closed Lost) the CloseDealModal is
   * submitted with today's date automatically.
   *
   * On mobile, navigates to the deal's current stage column first.
   *
   * @param dealId - Deal UUID.
   * @param stage - Target stage value.
   */
  async selectDealStage(dealId: string, stage: PipelineStage): Promise<void> {
    const mobile = await this.isMobileView();

    if (mobile) {
      await this.mobileNavigateToStageWithDeal(dealId);
    }

    const prefix = mobile ? 'mobile-' : '';
    const selectTestId = `${prefix}deal-card-stage-select-${dealId}`;
    const select = await this.healPage
      .locate([
        { type: 'testId', value: selectTestId },
        { type: 'css', value: `[data-testid="${selectTestId}"]` },
      ])
      .resolve(this.testName);
    await select.selectOption(stage);

    const isTerminal = stage === 'Closed Won' || stage === 'Closed Lost';
    if (isTerminal) {
      // CloseDealModal opens — fill required close_date and confirm.
      const modal = await this.healPage
        .locate([
          { type: 'testId', value: 'close-deal-modal' },
          { type: 'css', value: '[data-testid="close-deal-modal"]' },
        ])
        .resolve(this.testName);
      await modal.waitFor({ state: 'visible' });

      const dateInput = await this.healPage
        .locate([
          { type: 'testId', value: 'close-deal-date-input' },
          { type: 'css', value: '[data-testid="close-deal-date-input"]' },
        ])
        .resolve(this.testName);
      // Default to today's date in YYYY-MM-DD format.
      const today = new Date().toISOString().slice(0, 10);
      await dateInput.fill(today);

      await this.healPage.click([
        { type: 'testId', value: 'close-deal-confirm' },
        { type: 'role', value: 'button', options: { name: 'Confirm', exact: false } },
      ]);

      await modal.waitFor({ state: 'hidden' });
    }

    // Wait for the deal card to appear in the target column before returning.
    // networkidle alone is not sufficient — React Query invalidation and re-render
    // may lag behind the settled network state.
    const slug = stage.toLowerCase().replace(/\s+/g, '-');

    if (mobile) {
      // On mobile, navigate to the target stage column so the card is visible.
      // Rewind to stage 0 first, then advance to targetSlugIndex.
      const targetSlugIndex = PipelineBoardPage.STAGE_SLUGS.indexOf(
        slug as (typeof PipelineBoardPage.STAGE_SLUGS)[number],
      );
      for (let i = 0; i < PipelineBoardPage.STAGE_SLUGS.length; i++) {
        try {
          const prevBtn = await this.healPage
            .locate([
              { type: 'testId', value: 'pipeline-mobile-prev' },
              { type: 'css', value: '[data-testid="pipeline-mobile-prev"]' },
            ])
            .resolve(this.testName);
          if (!(await prevBtn.isEnabled().catch(() => false))) break;
          await prevBtn.click();
          await this.page.waitForLoadState('networkidle');
        } catch {
          break;
        }
      }
      for (let i = 0; i < targetSlugIndex; i++) {
        try {
          const nextBtn = await this.healPage
            .locate([
              { type: 'testId', value: 'pipeline-mobile-next' },
              { type: 'css', value: '[data-testid="pipeline-mobile-next"]' },
            ])
            .resolve(this.testName);
          if (await nextBtn.isEnabled().catch(() => false)) {
            await nextBtn.click();
            await this.page.waitForLoadState('networkidle');
          }
        } catch {
          break;
        }
      }
      try {
        const card = await this.healPage
          .locate([
            { type: 'testId', value: `mobile-deal-card-${dealId}` },
            { type: 'css', value: `[data-testid="mobile-deal-card-${dealId}"]` },
          ])
          .resolve(this.testName);
        await card.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => null);
      } catch {
        // Card not found — caller will verify state independently.
      }
    } else {
      try {
        const cardInTarget = await this.healPage
          .locate([
            {
              type: 'css',
              value: `[data-testid="stage-column-${slug}"] [data-testid="deal-card-${dealId}"]`,
            },
            { type: 'css', value: `[data-testid="deal-card-${dealId}"]` },
          ])
          .resolve(this.testName);
        await cardInTarget.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => null);
      } catch {
        // Card not found — caller will verify state independently.
      }
    }
  }

  /**
   * Returns the current page URL.
   */
  url(): string {
    return this.page.url();
  }
}
