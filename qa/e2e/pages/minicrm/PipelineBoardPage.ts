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
 *
 */

import type { PageFacade } from '@framework/fixtures/index.js';

/** Subset of Playwright fixtures required by PipelineBoardPage. */
export interface PipelineBoardPageContext {
  page: PageFacade;
}

/** Pipeline stages that can be selected from the stage dropdown. */
export type PipelineStage =
  'Prospecting' | 'Qualification' | 'Proposal' | 'Negotiation' | 'Closed Won' | 'Closed Lost';

/**
 * Page Object for the MiniCRM pipeline board.
 */
/**
 * How long the board container may take to appear after its data has landed.
 *
 * Covers React's commit after React Query flips isLoading, which networkidle does not
 * wait for. Matched to the mobile board, which mounts its cards asynchronously and is
 * where the shortfall surfaces first.
 */
const BOARD_RENDER_TIMEOUT_MS = 15_000;

export class PipelineBoardPage {
  private readonly page: PageFacade;

  static readonly PATH = '/deals';

  constructor(context: PipelineBoardPageContext) {
    this.page = context.page;
  }

  /**
   * Navigates directly to the pipeline board URL and waits for the board
   * container to be visible before returning.
   *
   * Waiting for the board element (rather than just networkidle) prevents
   * scanMobileColumnSlug from starting its prev-button rewind before React has
   * mounted the board, which caused the rewind to silently no-op and leave the
   * view on whatever stage was last active.
   */
  async navigate(): Promise<void> {
    // waitUntil:'networkidle' ensures deal/stage API calls complete before the
    // board-container probe starts, preventing 2 s timeout heals. (heal-trends)
    await this.page.goto(PipelineBoardPage.PATH, { waitUntil: 'networkidle' });
    await this.page
      .locate(
        [
          { type: 'testId', value: 'pipeline-board' },
          { type: 'css', value: '[data-testid="pipeline-board"]' },
        ],
        { intent: 'pipeline kanban board container after navigation' },
      )
      // Networkidle is not render-complete: the container is gated on React Query's
      // isLoading, which flips a tick AFTER the responses land. The default 2 s probe
      // budget expires inside that gap on a loaded runner and reports selector drift for
      // an element that is merely slow.
      .resolve(BOARD_RENDER_TIMEOUT_MS);
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
  static readonly STAGE_COUNT = 6;

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
   * evaluated inside the browser context by Playwright at runtime.
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
   * a hit. This is the zero-overhead retry path for: on the happy path
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
    // pipeline-mobile-stage-name heading text to change.
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
      // 3 s probe — the card is either rendered in this column or it isn't.
      // The 6s HealingLocator fallback caused up to 24 s of dead time when
      // scanning to 'Closed Won' (index 4). waitForFunction is equivalent
      // without triggering the AI healer for a dynamic UUID testid.
      const cardVisible = await this.page
        .waitForFunction(
          `!!document.querySelector('[data-testid="deal-card-${dealId}"]')`,
          undefined,
          { timeout: 3_000 },
        )
        .then(() => true)
        .catch(() => false);
      if (cardVisible) return slug;

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
   *
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
      // Allow 3 s per column — enough for React to finish rendering deal cards
      // after the column transition, but much shorter than the original 6 s
      // HealingLocator fallback. The column heading change (waitForMobileStageChange)
      // already confirms the board has transitioned before this probe runs.
      const cardVisible = await this.page
        .waitForFunction(
          `!!document.querySelector('[data-testid="deal-card-${dealId}"]')`,
          undefined,
          { timeout: 3_000 },
        )
        .then(() => true)
        .catch(() => false);
      if (cardVisible) return;

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

    const selectTestId = `deal-card-stage-select-${dealId}`;
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
              { type: 'testId', value: `deal-card-${dealId}` },
              { type: 'css', value: `[data-testid="deal-card-${dealId}"]` },
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
   * Returns a resolved locator for the close deal modal dialog.
   * Returns null if the modal is not in the DOM.
   */
  async closeDealModalLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'close-deal-modal' },
          { type: 'role', value: 'dialog', options: { name: /close deal/i } },
        ],
        { intent: 'modal dialog that appears when closing a deal as Won or Lost' },
      )
      .resolve(timeout)
      .catch(() => null);
  }

  /**
   * Returns a resolved locator for the close date input inside the close deal modal.
   */
  async closeDealDateInputLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'close-deal-date-input' },
          { type: 'label', value: 'Close date', options: { exact: false } },
        ],
        { intent: 'date input field inside the close deal confirmation modal' },
      )
      .resolve(timeout);
  }

  /**
   * Clicks the Confirm button in the close deal modal. Use after triggering a
   * terminal stage change via drag-and-drop (which opens the modal but does not
   * automatically confirm it, unlike selectDealStage which handles this internally).
   */
  async confirmCloseDeal(): Promise<void> {
    await this.page.click(
      [
        { type: 'testId', value: 'close-deal-confirm' },
        { type: 'role', value: 'button', options: { name: 'Confirm', exact: false } },
      ],
      { intent: 'confirm button in the close deal modal' },
    );
  }

  /**
   * Clicks the Cancel button in the close deal modal to dismiss it without
   * confirming the stage change.
   */
  async cancelCloseDeal(): Promise<void> {
    await this.page.click(
      [
        { type: 'testId', value: 'close-deal-cancel' },
        { type: 'role', value: 'button', options: { name: 'Cancel', exact: false } },
      ],
      { intent: 'cancel button in the close deal modal' },
    );
  }

  /**
   * Returns a resolved locator for the pipeline kanban board container.
   */
  async boardLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'pipeline-board' },
          { type: 'role', value: 'main' },
        ],
        { intent: 'main pipeline kanban board container' },
      )
      .resolve(timeout);
  }

  /**
   * Rewinds the mobile single-column board to stage 0 (Prospecting) by clicking
   * the "prev" button until it is disabled. No-op on desktop.
   *
   * On mobile, navigate() restores the last active stage rather than starting at
   * stage 0. Call this before asserting that a new deal (always in Prospecting)
   * is visible on the board.
   */
  async rewindToMobileStage0(): Promise<void> {
    if (!this.isMobileView()) return;
    for (let i = 0; i < PipelineBoardPage.STAGE_SLUGS.length; i++) {
      try {
        const prevBtn = await this.page
          .locate(
            [
              { type: 'testId', value: 'pipeline-mobile-prev' },
              { type: 'css', value: '[data-testid="pipeline-mobile-prev"]' },
            ],
            { intent: 'mobile pipeline previous stage button for rewind' },
          )
          .resolve();
        if (!(await prevBtn.isEnabled().catch(() => false))) break;
        const headingEl = await this.page
          .locate(
            [
              { type: 'testId', value: 'pipeline-mobile-stage-name' },
              { type: 'css', value: '[data-testid="pipeline-mobile-stage-name"]' },
            ],
            { intent: 'mobile pipeline stage heading during rewind' },
          )
          .resolve();
        const prevHeading = (await headingEl.textContent()) ?? '';
        await prevBtn.click();
        await this.waitForMobileStageChange(prevHeading).catch(() => null);
      } catch {
        break;
      }
    }
  }

  /**
   * Returns a resolved locator for the mobile single-column stage name heading.
   */
  async mobileStageNameLocator(timeout?: number) {
    // eslint-disable-next-line local/require-locator-fallback -- role:heading is unscoped and matches every heading on the board
    return this.page
      .locate([{ type: 'testId', value: 'pipeline-mobile-stage-name' }], {
        intent: 'mobile single-column stage name heading',
      })
      .resolve(timeout);
  }

  /**
   * Returns a resolved locator for the stage-update error banner.
   * Shown when a deal stage PATCH fails.
   */
  async stageUpdateErrorLocator(timeout?: number) {
    return this.page
      .locate(
        [
          { type: 'testId', value: 'stage-update-error' },
          { type: 'role', value: 'alert' },
        ],
        { intent: 'error banner shown when a stage update fails' },
      )
      .resolve(timeout);
  }

  /**
   * Returns a resolved locator for a specific deal card by ID.
   */
  async dealCardLocator(dealId: string) {
    const testId = `deal-card-${dealId}`;
    return this.page
      .locate(
        [
          { type: 'testId', value: testId },
          { type: 'css', value: `[data-testid="${testId}"]` },
        ],
        { intent: `deal card for deal ${dealId} on the pipeline board` },
      )
      .resolve();
  }

  /**
   * Returns a resolved locator for the stage select dropdown on a specific deal card.
   */
  async dealStageSelectLocator(dealId: string) {
    const testId = `deal-card-stage-select-${dealId}`;
    return this.page
      .locate(
        [
          { type: 'testId', value: testId },
          { type: 'css', value: `[data-testid="${testId}"]` },
        ],
        { intent: `stage dropdown on deal card ${dealId}` },
      )
      .resolve();
  }

  /**
   * Clicks the New Deal button to open the deal creation form.
   * Desktop-only — the button is not rendered on mobile viewports.
   */
  async clickNewDeal(): Promise<void> {
    await this.page.click(
      [
        { type: 'testId', value: 'new-deal-button' },
        { type: 'role', value: 'button', options: { name: /new deal/i } },
      ],
      { intent: 'button that opens the new deal creation form' },
    );
  }

  /**
   * Returns the current page URL.
   */
  url(): string {
    return this.page.url();
  }
}
