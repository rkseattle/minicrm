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
 * MINCRM-110, MINCRM-310, MINCRM-311, MINCRM-315
 */

import type { PageFacade } from '@framework/fixtures/index.js';

/** Subset of Playwright fixtures required by PipelineBoardPage. */
export interface PipelineBoardPageContext {
  page: PageFacade;
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
  private readonly page: PageFacade;

  static readonly PATH = '/deals';

  constructor(context: PipelineBoardPageContext) {
    this.page = context.page;
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
      await this.page
        .locate(
          [
            { type: 'testId', value: 'pipeline-board' },
            { type: 'css', value: '[data-testid="pipeline-board"]' },
          ],
          { intent: 'pipeline kanban board container' },
        )
        .resolve();
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
   * Detected by checking viewport width — the mobile board renders below
   * Tailwind's `md` breakpoint (768 px). Using viewportSize() is deterministic
   * and avoids DOM-visibility races that occur when the board is still rendering.
   */
  private isMobileView(): boolean {
    const size = this.page.viewportSize();
    return size !== null && size.width < 768;
  }

  /**
   * Waits until the mobile stage heading text changes away from `prevHeading`.
   * Used after clicking the prev/next navigation buttons — the heading element
   * (`pipeline-mobile-stage-name`) updates synchronously with React state, so
   * a text change is the most reliable signal that the column has advanced.
   * The predicate is passed as a string so the TypeScript compiler (which has
   * no DOM lib) does not flag `document` as an unknown name; the string is
   * evaluated inside the browser context by Playwright at runtime. MINCRM-310
   */
  private async waitForMobileStageChange(prevHeading: string): Promise<void> {
    const predicate = `(() => {
      const el = document.querySelector('[data-testid="pipeline-mobile-stage-name"]');
      return el !== null && el.textContent !== ${JSON.stringify(prevHeading)};
    })()`;
    await this.page.waitForFunction(predicate, undefined, { timeout: 5_000 });
  }

  /**
   * Polls `scan` up to `timeoutMs` at `intervalMs` cadence, returning the first
   * non-null result immediately. Returns null only when the window elapses without
   * a hit. This is the zero-overhead retry path for MINCRM-311: on the happy path
   * `scan` resolves on the first call and the loop never sleeps.
   */
  private async pollUntilFound(
    scan: () => Promise<string | null>,
    intervalMs = 250,
    timeoutMs = 5_000,
  ): Promise<string | null> {
    const deadline = Date.now() + timeoutMs;
    while (true) {
      const result = await scan();
      if (result !== null) return result;
      const remaining = deadline - Date.now();
      if (remaining <= 0) return null;
      await new Promise<void>((resolve) => setTimeout(resolve, Math.min(intervalMs, remaining)));
    }
  }

  /**
   * Single-pass desktop scan: checks each stage column once for the deal card.
   * Returns the slug of the first column that contains the card, or null.
   */
  private async scanDesktopColumnSlug(dealId: string): Promise<string | null> {
    for (const slug of PipelineBoardPage.STAGE_SLUGS) {
      try {
        // Both strategies are scoped to this specific column so a failed
        // resolve means "card is not in this column" — never matches globally.
        // The XPath fallback is semantically identical to the CSS primary, just
        // expressed differently for the heal framework to prefer the CSS form.
        const cardInColumn = await this.page
          .locate(
            [
              {
                type: 'css',
                value: `[data-testid="stage-column-${slug}"] [data-testid="deal-card-${dealId}"]`,
              },
              {
                type: 'xpath',
                value: `//*[@data-testid="stage-column-${slug}"]//*[@data-testid="deal-card-${dealId}"]`,
              },
            ],
            { intent: `deal card inside stage column ${slug}` },
          )
          .resolve();
        if ((await cardInColumn.count()) > 0) return slug;
      } catch {
        // Card not in this column — continue.
      }
    }
    return null;
  }

  /**
   * Single-pass mobile scan: rewinds to stage 0 then walks forward through each
   * stage column looking for the deal card in the single visible column.
   * Returns the slug of the matching column, or null.
   */
  private async scanMobileColumnSlug(dealId: string): Promise<string | null> {
    // Rewind to stage 0 (Prospecting) by clicking prev until disabled.
    // Stage navigation is pure React state — no network calls. Wait for the
    // pipeline-mobile-stage-name heading text to change. MINCRM-310
    for (let i = 0; i < PipelineBoardPage.STAGE_SLUGS.length; i++) {
      try {
        const prevBtn = await this.page
          .locate(
            [
              { type: 'testId', value: 'pipeline-mobile-prev' },
              { type: 'css', value: '[data-testid="pipeline-mobile-prev"]' },
            ],
            { intent: 'mobile pipeline previous stage button' },
          )
          .resolve();
        if (!(await prevBtn.isEnabled().catch(() => false))) break;
        const headingEl = await this.page
          .locate(
            [
              { type: 'testId', value: 'pipeline-mobile-stage-name' },
              { type: 'css', value: '[data-testid="pipeline-mobile-stage-name"]' },
            ],
            { intent: 'mobile pipeline active stage heading' },
          )
          .resolve();
        const prevHeading = (await headingEl.textContent()) ?? '';
        await prevBtn.click();
        await this.waitForMobileStageChange(prevHeading).catch(() => null);
      } catch {
        break;
      }
    }

    for (const slug of PipelineBoardPage.STAGE_SLUGS) {
      try {
        const card = await this.page
          .locate(
            [
              { type: 'testId', value: `mobile-deal-card-${dealId}` },
              { type: 'css', value: `[data-testid="mobile-deal-card-${dealId}"]` },
            ],
            { intent: 'deal card in mobile single-column board view' },
          )
          .resolve();
        if (await card.isVisible().catch(() => false)) return slug;
      } catch {
        // Card not visible in this column.
      }
      try {
        const nextBtn = await this.page
          .locate(
            [
              { type: 'testId', value: 'pipeline-mobile-next' },
              { type: 'css', value: '[data-testid="pipeline-mobile-next"]' },
            ],
            { intent: 'mobile pipeline next stage button' },
          )
          .resolve();
        if (!(await nextBtn.isEnabled().catch(() => false))) break;
        const headingEl = await this.page
          .locate(
            [
              { type: 'testId', value: 'pipeline-mobile-stage-name' },
              { type: 'css', value: '[data-testid="pipeline-mobile-stage-name"]' },
            ],
            { intent: 'mobile pipeline active stage heading' },
          )
          .resolve();
        const prevHeading = (await headingEl.textContent()) ?? '';
        await nextBtn.click();
        await this.waitForMobileStageChange(prevHeading).catch(() => null);
      } catch {
        break;
      }
    }
    return null;
  }

  /**
   * Returns the stage slug (column testid slug) that currently contains the
   * given deal card.
   *
   * On desktop, checks each stage column in order. On mobile, navigates through
   * all stages one at a time (only one column is rendered at a time).
   *
   * Retries the scan for up to 5 seconds (250 ms intervals) so that a deal card
   * briefly unmounted during a React Query cache invalidation/re-render does not
   * produce a spurious null. Returns immediately on the first successful scan;
   * returns null only after the 5-second window elapses without a hit.
   * MINCRM-311
   *
   * @param dealId - Deal UUID to locate.
   * @returns The column slug (e.g. 'prospecting', 'closed-won') or null.
   */
  async getDealColumnSlug(dealId: string): Promise<string | null> {
    // waitForLoadState('networkidle') is avoided here: under concurrent CI load
    // other workers' API calls prevent the 500ms quiet window from ever settling,
    // which burns the full test timeout. The board data is already current at this
    // call site — callers either just navigated (openDeal) or waited for the card
    // to appear in the target column (dragDealToStage) before calling this.

    const mobile = this.isMobileView();

    if (!mobile) {
      return this.pollUntilFound(() => this.scanDesktopColumnSlug(dealId));
    }

    return this.pollUntilFound(() => this.scanMobileColumnSlug(dealId));
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
        const card = await this.page
          .locate(
            [
              { type: 'testId', value: `mobile-deal-card-${dealId}` },
              { type: 'css', value: `[data-testid="mobile-deal-card-${dealId}"]` },
            ],
            { intent: 'deal card in mobile single-column board view' },
          )
          .resolve();
        if (await card.isVisible().catch(() => false)) return;
      } catch {
        // Not visible in this column — try next.
      }
      try {
        const nextBtn = await this.page
          .locate(
            [
              { type: 'testId', value: 'pipeline-mobile-next' },
              { type: 'css', value: '[data-testid="pipeline-mobile-next"]' },
            ],
            { intent: 'mobile pipeline next stage button' },
          )
          .resolve();
        if (await nextBtn.isEnabled().catch(() => false)) {
          const headingEl = await this.page
            .locate(
              [
                { type: 'testId', value: 'pipeline-mobile-stage-name' },
                { type: 'css', value: '[data-testid="pipeline-mobile-stage-name"]' },
              ],
              { intent: 'mobile pipeline active stage heading' },
            )
            .resolve();
          const prevHeading = (await headingEl.textContent()) ?? '';
          await nextBtn.click();
          await this.waitForMobileStageChange(prevHeading).catch(() => null);
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
    const mobile = this.isMobileView();

    if (mobile) {
      await this.mobileNavigateToStageWithDeal(dealId);
    }

    const prefix = mobile ? 'mobile-' : '';
    const selectTestId = `${prefix}deal-card-stage-select-${dealId}`;
    const select = await this.page
      .locate(
        [
          { type: 'testId', value: selectTestId },
          { type: 'css', value: `[data-testid="${selectTestId}"]` },
        ],
        { intent: 'stage select dropdown on deal card' },
      )
      .resolve();
    await select.selectOption(stage);

    const isTerminal = stage === 'Closed Won' || stage === 'Closed Lost';
    if (isTerminal) {
      // CloseDealModal opens — fill required close_date and confirm.
      const modal = await this.page
        .locate(
          [
            { type: 'testId', value: 'close-deal-modal' },
            { type: 'role', value: 'dialog', options: { name: /close deal/i } },
          ],
          { intent: 'close deal confirmation modal dialog' },
        )
        .resolve();
      await modal.waitFor({ state: 'visible' });

      const dateInput = await this.page
        .locate(
          [
            { type: 'testId', value: 'close-deal-date-input' },
            { type: 'label', value: 'Close date', options: { exact: false } },
          ],
          { intent: 'close date input field in close deal modal' },
        )
        .resolve();
      // Default to today's date in YYYY-MM-DD format.
      const today = new Date().toISOString().slice(0, 10);
      await dateInput.fill(today);

      await this.page.click(
        [
          { type: 'testId', value: 'close-deal-confirm' },
          { type: 'role', value: 'button', options: { name: 'Confirm', exact: false } },
        ],
        { intent: 'confirm button to close deal at terminal stage' },
      );

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
          const prevBtn = await this.page
            .locate(
              [
                { type: 'testId', value: 'pipeline-mobile-prev' },
                { type: 'css', value: '[data-testid="pipeline-mobile-prev"]' },
              ],
              { intent: 'mobile pipeline previous stage button' },
            )
            .resolve();
          if (!(await prevBtn.isEnabled().catch(() => false))) break;
          const headingEl = await this.page
            .locate(
              [
                { type: 'testId', value: 'pipeline-mobile-stage-name' },
                { type: 'css', value: '[data-testid="pipeline-mobile-stage-name"]' },
              ],
              { intent: 'mobile pipeline active stage heading' },
            )
            .resolve();
          const prevHeading = (await headingEl.textContent()) ?? '';
          await prevBtn.click();
          await this.waitForMobileStageChange(prevHeading).catch(() => null);
        } catch {
          break;
        }
      }
      for (let i = 0; i < targetSlugIndex; i++) {
        try {
          const nextBtn = await this.page
            .locate(
              [
                { type: 'testId', value: 'pipeline-mobile-next' },
                { type: 'css', value: '[data-testid="pipeline-mobile-next"]' },
              ],
              { intent: 'mobile pipeline next stage button' },
            )
            .resolve();
          if (await nextBtn.isEnabled().catch(() => false)) {
            const headingEl = await this.page
              .locate(
                [
                  { type: 'testId', value: 'pipeline-mobile-stage-name' },
                  { type: 'css', value: '[data-testid="pipeline-mobile-stage-name"]' },
                ],
                { intent: 'mobile pipeline active stage heading' },
              )
              .resolve();
            const prevHeading = (await headingEl.textContent()) ?? '';
            await nextBtn.click();
            await this.waitForMobileStageChange(prevHeading).catch(() => null);
          }
        } catch {
          break;
        }
      }
      try {
        const card = await this.page
          .locate(
            [
              { type: 'testId', value: `mobile-deal-card-${dealId}` },
              { type: 'css', value: `[data-testid="mobile-deal-card-${dealId}"]` },
            ],
            { intent: 'deal card in mobile single-column board view' },
          )
          .resolve();
        await card.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => null);
      } catch {
        // Card not found — caller will verify state independently.
      }
    } else {
      try {
        // Both strategies scoped to the target column — avoids matching the card
        // in a stale column while React Query is still updating the board.
        const cardInTarget = await this.page
          .locate(
            [
              {
                type: 'css',
                value: `[data-testid="stage-column-${slug}"] [data-testid="deal-card-${dealId}"]`,
              },
              {
                type: 'xpath',
                value: `//*[@data-testid="stage-column-${slug}"]//*[@data-testid="deal-card-${dealId}"]`,
              },
            ],
            { intent: `deal card after move into stage column ${slug}` },
          )
          .resolve();
        await cardInTarget.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => null);
      } catch {
        // Card not found in target column — caller will verify state independently.
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
