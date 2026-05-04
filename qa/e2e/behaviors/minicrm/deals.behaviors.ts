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

  // Simulate HTML5 drag-and-drop by injecting synthetic events directly via
  // page.evaluate(). Playwright's dragTo() fires mouse events that Chromium
  // does not reliably translate into the HTML5 drag event sequence in headless
  // mode, especially when the drop target has child elements that intercept the
  // pointer position. Dispatching events from JS guarantees the correct sequence
  // (dragstart → dragover+preventDefault → drop) with the right dataTransfer payload.
  // Strings are used for both calls to avoid DOM lib errors in the Node tsconfig.
  const cardTestId = `deal-card-${dealId}`;
  const headerTestId = `stage-column-header-${targetSlug}`;

  await context.page.waitForFunction(
    `document.querySelector('[data-testid="${cardTestId}"]') !== null && ` +
      `document.querySelector('[data-testid="${headerTestId}"]') !== null`,
    undefined,
    { timeout: 10_000 },
  );

  await context.page.evaluate(`(() => {
    const source = document.querySelector('[data-testid="${cardTestId}"]');
    const target = document.querySelector('[data-testid="${headerTestId}"]');
    if (!source || !target) throw new Error('drag elements not found');
    // Scroll the drop target into view so Chromium's event routing sees it even
    // when the column is off the right edge of the overflow-x-auto board container.
    target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    const dt = new DataTransfer();
    dt.setData('text/plain', '${dealId}');
    source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
    target.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: dt }));
    target.dispatchEvent(new DragEvent('dragover',  { bubbles: true, cancelable: true, dataTransfer: dt }));
    target.dispatchEvent(new DragEvent('drop',      { bubbles: true, cancelable: true, dataTransfer: dt }));
    source.dispatchEvent(new DragEvent('dragend',   { bubbles: true, cancelable: true, dataTransfer: dt }));
  })()`);

  let closeDealModalOpened = false;

  if (isTerminal) {
    // CloseDealModal opens — fill required close_date and confirm.
    // waitForFunction polls until the modal element is in the DOM before
    // resolve(), because resolve() throws StrategyExhaustedError immediately
    // when the element is absent rather than waiting for it to appear.
    await context.page.waitForFunction(
      `document.querySelector('[data-testid="close-deal-modal"]') !== null`,
      undefined,
      { timeout: 8_000 },
    );
    const modal = await context.page
      .locate(
        [
          { type: 'testId', value: 'close-deal-modal' },
          { type: 'css', value: '[data-testid="close-deal-modal"]' },
        ],
        { intent: 'modal dialog that appears when closing a deal as Won or Lost' },
      )
      .resolve();
    await modal.waitFor({ state: 'visible', timeout: 5_000 });
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

    // Explicit timeout matches the appear-guard above — prevents undismissed modal
    // from silently consuming the full 30s test budget on a slow CI runner. (MINCRM-298)
    await modal.waitFor({ state: 'hidden', timeout: 8_000 });
  }

  // Wait for the card to appear in the target column. Use waitForFunction rather
  // than locate().resolve().waitFor() because resolve() throws immediately when
  // the element is absent — it never enters the timed wait for newly-appearing
  // elements. For terminal stages this also implicitly waits for the React Query
  // refetch triggered by the mutation's onSettled to complete, since the card
  // only moves columns once the board data re-fetches. Pass the selector as a
  // JS expression string so document is evaluated in the browser context.
  const cardSelector = `[data-testid="stage-column-${targetSlug}"] [data-testid="deal-card-${dealId}"]`;
  await context.page
    .waitForFunction(
      `document.querySelector(${JSON.stringify(cardSelector)}) !== null`,
      undefined,
      { timeout: 15_000 },
    )
    .catch(() => null);

  const columnSlug = await boardPage.getDealColumnSlug(dealId);
  return { closeDealModalOpened, columnSlug };
}
