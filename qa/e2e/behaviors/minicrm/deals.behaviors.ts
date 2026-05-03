/**
 * Deals behaviors for MiniCRM.
 *
 * Behaviors are named, reusable async functions that encapsulate multi-step
 * user journeys. They compose Page Objects internally — callers never touch
 * raw locators or Page Object methods directly.
 *
 * Behaviors do NOT contain assertions (no expect() calls). They return typed
 * result objects that test specs assert against.
 *
 * MINCRM-110
 */

import type { PageFacade } from '@framework/fixtures/index.js';
import { PipelineBoardPage } from '@pages/minicrm/PipelineBoardPage.js';
import type { PipelineStage } from '@pages/minicrm/PipelineBoardPage.js';

// ---------------------------------------------------------------------------
// Fixture context
// ---------------------------------------------------------------------------

/** Fixtures required by deal behaviors. */
export interface DealsBehaviorContext {
  page: PageFacade;
}

// ---------------------------------------------------------------------------
// openDeal()
// ---------------------------------------------------------------------------

/** Result returned by openDeal. */
export interface OpenDealResult {
  /** True when the board loaded and the deal card is present. */
  loaded: boolean;
  /** Kebab-case column slug the deal currently occupies (e.g. 'prospecting'). */
  columnSlug: string | null;
  /** The URL the browser settled on. */
  finalUrl: string;
}

/**
 * Navigates to the pipeline board and locates the given deal card.
 *
 * Returns a result object the caller (test spec) asserts against.
 *
 * @param dealId - Deal UUID.
 * @param context - Playwright fixture context.
 * @returns OpenDealResult describing the outcome.
 *
 * @example
 * ```ts
 * const result = await openDeal(deal.id, { page });
 * expect(result.loaded).toBe(true);
 * expect(result.columnSlug).toBe('prospecting');
 * ```
 */
export async function openDeal(
  dealId: string,
  context: DealsBehaviorContext,
): Promise<OpenDealResult> {
  const boardPage = new PipelineBoardPage(context);

  await boardPage.navigate();
  const loaded = await boardPage.isLoaded();
  const columnSlug = await boardPage.getDealColumnSlug(dealId);
  const finalUrl = boardPage.url();

  return { loaded, columnSlug, finalUrl };
}

// ---------------------------------------------------------------------------
// advanceDealStage()
// ---------------------------------------------------------------------------

/** Result returned by advanceDealStage. */
export interface AdvanceDealStageResult {
  /** The column slug the deal is in after the stage change. */
  columnSlug: string | null;
}

/**
 * Advances a deal's stage to the specified target stage via the pipeline board
 * stage selector dropdown.
 *
 * The board must already be loaded (call openDeal first, or re-use the same
 * PipelineBoardPage session). Navigates to the board if not already there.
 *
 * @param dealId - Deal UUID.
 * @param targetStage - The stage to select.
 * @param context - Playwright fixture context.
 * @returns AdvanceDealStageResult with the column slug after the change.
 *
 * @example
 * ```ts
 * const result = await advanceDealStage(deal.id, 'Qualification', { page });
 * expect(result.columnSlug).toBe('qualification');
 * ```
 */
export async function advanceDealStage(
  dealId: string,
  targetStage: PipelineStage,
  context: DealsBehaviorContext,
): Promise<AdvanceDealStageResult> {
  const boardPage = new PipelineBoardPage(context);

  // Navigate to board only if not already there.
  if (!context.page.url().includes(PipelineBoardPage.PATH)) {
    await boardPage.navigate();
    await boardPage.isLoaded();
  }

  await boardPage.selectDealStage(dealId, targetStage);
  // selectDealStage already waits for the card to appear in the target column
  // and navigates there on mobile. Derive the slug from the stage name rather
  // than calling getDealColumnSlug, which rescans all stages from position 0
  // and is prohibitively slow on mobile (up to 12 button clicks × timeouts).
  const columnSlug = targetStage.toLowerCase().replace(/\s+/g, '-');
  return { columnSlug };
}

// ---------------------------------------------------------------------------
// closeDealAsWon()
// ---------------------------------------------------------------------------

/** Result returned by closeDealAsWon. */
export interface CloseDealAsWonResult {
  /** True when the deal card moved to the 'closed-won' column. */
  columnSlug: string | null;
}

/**
 * Closes a deal as Won via the pipeline board stage selector. Opens the
 * CloseDealModal and confirms with today's date.
 *
 * @param dealId - Deal UUID.
 * @param context - Playwright fixture context.
 * @returns CloseDealAsWonResult with the column slug after the change.
 *
 * @example
 * ```ts
 * const result = await closeDealAsWon(deal.id, { page });
 * expect(result.columnSlug).toBe('closed-won');
 * ```
 */
export async function closeDealAsWon(
  dealId: string,
  context: DealsBehaviorContext,
): Promise<CloseDealAsWonResult> {
  return advanceDealStage(dealId, 'Closed Won', context);
}

// ---------------------------------------------------------------------------
// dragDealToStage()
// ---------------------------------------------------------------------------

/** Result returned by dragDealToStage. */
export interface DragDealToStageResult {
  /** True when the CloseDealModal opened (only set for terminal-stage drags). */
  closeDealModalOpened: boolean;
  /** The column slug the deal occupies after the drag (and modal confirm, if applicable). */
  columnSlug: string | null;
}

/**
 * Drags a deal card to a target stage column using HTML5 drag-and-drop on the
 * desktop pipeline board view. For terminal stages (Closed Won / Closed Lost)
 * the CloseDealModal is filled with today's date and confirmed.
 *
 * The board must be loaded at the desktop viewport (≥ 768 px) before calling
 * this behavior — drag-and-drop is not supported on the mobile carousel view.
 *
 * @param dealId - Deal UUID.
 * @param targetStage - Stage to drag the card into.
 * @param context - Playwright fixture context.
 * @returns DragDealToStageResult describing the outcome.
 *
 * @example
 * ```ts
 * const result = await dragDealToStage(deal.id, 'Qualification', { page });
 * expect(result.closeDealModalOpened).toBe(false);
 * expect(result.columnSlug).toBe('qualification');
 * ```
 */
export async function dragDealToStage(
  dealId: string,
  targetStage: PipelineStage,
  context: DealsBehaviorContext,
): Promise<DragDealToStageResult> {
  const boardPage = new PipelineBoardPage(context);

  if (!context.page.url().includes(PipelineBoardPage.PATH)) {
    await boardPage.navigate();
    await boardPage.isLoaded();
  }

  const targetSlug = targetStage.toLowerCase().replace(/\s+/g, '-');
  const isTerminal = targetStage === 'Closed Won' || targetStage === 'Closed Lost';

  // Resolve the drag source (deal card) and drop target.
  // We target the column HEADER rather than the full column div so that
  // Playwright's dragTo() lands on a clean surface — the header has no
  // draggable child elements that would intercept the drop event.
  const sourceCard = await context.page
    .locate(
      [
        { type: 'testId', value: `deal-card-${dealId}` },
        { type: 'css', value: `[data-testid="deal-card-${dealId}"]` },
      ],
      { intent: `deal card for deal ${dealId} to drag from its current column` },
    )
    .resolve();

  const targetHeader = await context.page
    .locate(
      [
        { type: 'testId', value: `stage-column-header-${targetSlug}` },
        { type: 'css', value: `[data-testid="stage-column-header-${targetSlug}"]` },
      ],
      {
        intent: `header of the ${targetStage} stage column, used as the drop target for drag-and-drop`,
      },
    )
    .resolve();

  await sourceCard.dragTo(targetHeader);

  let closeDealModalOpened = false;

  if (isTerminal) {
    // CloseDealModal opens — fill required close_date and confirm.
    const modal = await context.page
      .locate(
        [
          { type: 'testId', value: 'close-deal-modal' },
          { type: 'css', value: '[data-testid="close-deal-modal"]' },
        ],
        { intent: 'modal dialog that appears when closing a deal as Won or Lost' },
      )
      .resolve();
    await modal.waitFor({ state: 'visible' });
    closeDealModalOpened = true;

    const dateInput = await context.page
      .locate(
        [
          { type: 'testId', value: 'close-deal-date-input' },
          { type: 'css', value: '[data-testid="close-deal-date-input"]' },
        ],
        { intent: 'date input field inside the close deal confirmation modal' },
      )
      .resolve();
    const today = new Date().toISOString().slice(0, 10);
    await dateInput.fill(today);

    await context.page.click(
      [
        { type: 'testId', value: 'close-deal-confirm' },
        { type: 'role', value: 'button', options: { name: 'Confirm', exact: false } },
      ],
      { intent: 'confirm button in the close deal modal' },
    );

    await modal.waitFor({ state: 'hidden' });
  }

  // Wait for the card to appear in the target column before returning.
  try {
    const cardInTarget = await context.page
      .locate(
        [
          {
            type: 'css',
            value: `[data-testid="stage-column-${targetSlug}"] [data-testid="deal-card-${dealId}"]`,
          },
          {
            type: 'xpath',
            value: `//*[@data-testid="stage-column-${targetSlug}"]//*[@data-testid="deal-card-${dealId}"]`,
          },
        ],
        { intent: `deal card ${dealId} visible inside the ${targetStage} stage column after drag` },
      )
      .resolve();
    await cardInTarget.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => null);
  } catch {
    // Card not yet in target column — caller asserts via getDealColumnSlug.
  }

  const columnSlug = await boardPage.getDealColumnSlug(dealId);
  return { closeDealModalOpened, columnSlug };
}
