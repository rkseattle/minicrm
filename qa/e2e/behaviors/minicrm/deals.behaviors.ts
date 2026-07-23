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
 * MINCRM-110, MINCRM-357
 */

import type { RestClient } from '@framework/clients/rest-client.js';
import type { PageFacade } from '@framework/fixtures/index.js';
import { PipelineBoardPage } from '@pages/minicrm/PipelineBoardPage.js';
import type { PipelineStage } from '@pages/minicrm/PipelineBoardPage.js';
import { DealDetailPage } from '@pages/minicrm/DealDetailPage.js';
import { DealsPage } from '@pages/minicrm/DealsPage.js';

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

  await context.page.waitForPresent(`[data-testid="${cardTestId}"]`);
  await context.page.waitForPresent(`[data-testid="${headerTestId}"]`);

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
    // closeDealModalLocator(), because locate().resolve() throws StrategyExhaustedError
    // immediately when the element is absent rather than waiting for it to appear.
    await context.page.waitForPresent('[data-testid="close-deal-modal"]', 8_000);
    const modal = await boardPage.closeDealModalLocator();
    await modal?.waitFor({ state: 'visible', timeout: 5_000 });
    closeDealModalOpened = true;

    const dateInput = await boardPage.closeDealDateInputLocator();
    const today = new Date().toISOString().slice(0, 10);
    await dateInput.fill(today);

    await boardPage.confirmCloseDeal();

    // Explicit timeout matches the appear-guard above — prevents undismissed modal
    // from silently consuming the full 30s test budget on a slow CI runner. (MINCRM-298)
    await modal?.waitFor({ state: 'hidden', timeout: 8_000 });
  }

  // Wait for the card to appear in the target column. For terminal stages this
  // implicitly waits for the React Query refetch triggered by the mutation's
  // onSettled to complete. 25s gives the refetch room to settle under CI concurrent
  // load. A reload cycle was tried previously but consumed too much of the 30s test
  // budget even when every step succeeded. (MINCRM-313)
  const cardInTargetSelector = `[data-testid="stage-column-${targetSlug}"] [data-testid="deal-card-${dealId}"]`;
  await context.page.waitForPresent(cardInTargetSelector, 25_000);

  const columnSlug = await boardPage.getDealColumnSlug(dealId);
  return { closeDealModalOpened, columnSlug };
}

// ---------------------------------------------------------------------------
// API data-fetch helpers (MINCRM-357)
// ---------------------------------------------------------------------------

/** Shape returned by GET /api/v1/deals/:id. */
export interface DealRow {
  id: string;
  name: string;
  stage: string;
  value: string | null;
  currency: string;
  close_date: string | null;
  loss_reason: string | null;
  account_id: string;
  owner_id: string;
  /** Optimistic lock version (MINCRM-349). */
  version: number;
}

/** Shape of paginated deal list from GET /api/v1/deals. */
export interface DealListRow {
  id: string;
  name: string;
  stage: string;
  value: string | null;
  currency?: string;
}

/**
 * Fetches a single deal by ID from the API.
 *
 * @param restClient - Authenticated RestClient.
 * @param dealId - Deal UUID.
 * @returns The deal record.
 */
export async function getDealById(restClient: RestClient, dealId: string): Promise<DealRow> {
  const res = await restClient.get<{ deal: DealRow }>(`/api/v1/deals/${dealId}`);
  return res.body.deal;
}

/**
 * Fetches all deals scoped to a specific account.
 *
 * @param restClient - Authenticated RestClient.
 * @param accountId - Account UUID to scope the query.
 * @returns Array of deal list rows.
 */
export async function getDealsByAccount(
  restClient: RestClient,
  accountId: string,
): Promise<DealListRow[]> {
  const res = await restClient.get<{ data: DealListRow[] }>(`/api/v1/deals?account=${accountId}`);
  return res.body.data;
}

/**
 * Links a contact to a deal via POST /api/v1/deals/:dealId/contacts/:contactId.
 *
 * @param restClient - Authenticated RestClient.
 * @param dealId - Deal UUID.
 * @param contactId - Contact UUID to link.
 * @returns HTTP status code (200 on success).
 */
export async function linkContactToDeal(
  restClient: RestClient,
  dealId: string,
  contactId: string,
): Promise<number> {
  const res = await restClient.post(`/api/v1/deals/${dealId}/contacts/${contactId}`, {});
  return res.status;
}

/**
 * Patches a deal's stage (and close date for terminal stages) via the API.
 *
 * @param restClient - Authenticated RestClient.
 * @param dealId - Deal UUID.
 * @param stage - Target stage name.
 * @param version - Current optimistic-lock version.
 * @param closeDate - Optional close date string (YYYY-MM-DD) for terminal stages.
 */
export async function patchDealStage(
  restClient: RestClient,
  dealId: string,
  stage: string,
  version: number,
  closeDate?: string,
): Promise<void> {
  await restClient.patch(`/api/v1/deals/${dealId}`, {
    stage,
    version,
    ...(closeDate !== undefined ? { close_date: closeDate } : {}),
  });
}

/**
 * Patches arbitrary fields on a deal via the API.
 *
 * @param restClient - Authenticated RestClient.
 * @param dealId - Deal UUID.
 * @param patch - Fields to update (must include version for optimistic locking).
 * @returns The updated deal record.
 */
export async function patchDeal(
  restClient: RestClient,
  dealId: string,
  patch: Partial<DealRow> & { version: number },
): Promise<DealRow> {
  const res = await restClient.patch<{ deal: DealRow }>(`/api/v1/deals/${dealId}`, patch);
  return res.body.deal;
}

/**
 * Deletes a deal by ID via the API.
 *
 * @param restClient - Authenticated RestClient.
 * @param dealId - Deal UUID.
 * @returns The HTTP status code.
 */
export async function deleteDeal(restClient: RestClient, dealId: string): Promise<number> {
  const res = await restClient.delete(`/api/v1/deals/${dealId}`);
  return res.status;
}

/**
 * Fetches a paginated, optionally sorted deals list from the API.
 *
 * @param restClient - Authenticated RestClient.
 * @param options - Query parameters (search, sort, dir, limit, page).
 * @returns Object with data array and total count.
 */
export async function listDealsViaApi(
  restClient: RestClient,
  options: {
    search?: string;
    sort?: string;
    dir?: 'asc' | 'desc';
    limit?: number;
    page?: number;
  } = {},
): Promise<{ total: number; data: DealRow[] }> {
  const params = new URLSearchParams();
  if (options.search) params.set('search', options.search);
  if (options.sort) params.set('sort', options.sort);
  if (options.dir) params.set('dir', options.dir);
  if (options.limit !== undefined) params.set('limit', String(options.limit));
  if (options.page !== undefined) params.set('page', String(options.page));
  const query = params.toString() ? `?${params.toString()}` : '';
  const res = await restClient.get<{ data: DealRow[]; total: number }>(`/api/v1/deals${query}`);
  return { total: res.body.total, data: res.body.data };
}

/**
 * Creates a deal via the API and returns the created record.
 *
 * @param restClient - Authenticated RestClient.
 * @param params - Deal fields.
 * @returns The created deal record.
 */
export async function createDealViaApi(
  restClient: RestClient,
  params: {
    name: string;
    account_id: string;
    stage?: string;
    /** Accepts number or string — the server Zod schema requires a numeric value. */
    value?: number | string;
    currency?: string;
    owner_id?: string;
    pipeline_id?: string;
  },
): Promise<DealRow> {
  const res = await restClient.post<{ deal: DealRow }>('/api/v1/deals', params);
  return res.body.deal;
}

/**
 * Downloads the deals list as a CSV string via the export endpoint.
 *
 * @param restClient - Authenticated RestClient.
 * @returns Raw CSV string.
 */
export async function exportDealsAsCsv(restClient: RestClient): Promise<string> {
  const res = await restClient.get<string>('/api/v1/deals/export', {
    headers: { Accept: 'text/csv' },
  });
  return res.body as unknown as string;
}

// ---------------------------------------------------------------------------
// Navigation / board behaviors
// ---------------------------------------------------------------------------

/**
 * Navigates to the pipeline board page.
 */
export async function navigateToPipelineBoard(context: DealsBehaviorContext): Promise<void> {
  const board = new PipelineBoardPage(context);
  await board.navigate();
}

/**
 * Returns whether the pipeline board is loaded.
 */
export async function pipelineBoardIsLoaded(context: DealsBehaviorContext): Promise<boolean> {
  const board = new PipelineBoardPage(context);
  return board.isLoaded();
}

/**
 * Waits for the pipeline board container to be visible.
 */
export async function waitForPipelineBoard(
  context: DealsBehaviorContext,
  timeout = 10_000,
): Promise<void> {
  const board = new PipelineBoardPage(context);
  const locator = await board.boardLocator();
  await locator.waitFor({ state: 'visible', timeout });
}

/**
 * Asserts a deal card is visible on the pipeline board.
 */
export async function expectDealCardVisible(
  dealId: string,
  context: DealsBehaviorContext,
  timeout = 10_000,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const board = new PipelineBoardPage(context);
  const locator = await board.dealCardLocator(dealId);
  await expect(locator).toBeVisible({ timeout });
}

/**
 * Waits for a deal card to be visible on the pipeline board.
 *
 * On desktop, waits for the deal card element to appear in the DOM (all stage
 * columns are rendered simultaneously). On mobile, the board renders one column
 * at a time; this function rewinds to stage 0 and then walks forward through
 * columns until the deal card is found, matching the scan strategy used by
 * PipelineBoardPage.scanMobileColumnSlug. Call this before interacting with any
 * deal card element to avoid HealingLocator exhaustion under load. (MINCRM-552)
 */
export async function waitForDealCardOnBoard(
  dealId: string,
  context: DealsBehaviorContext,
  timeout = 10_000,
): Promise<void> {
  const board = new PipelineBoardPage(context);
  const size = context.page.viewportSize();
  const isMobile = size !== null && size.width < 768;

  if (!isMobile) {
    await context.page.waitForFunction(
      `document.querySelector('[data-testid="deal-card-${dealId}"]') !== null`,
      undefined,
      { timeout },
    );
    return;
  }

  // Mobile: rewind to stage 0, then walk forward scanning each column.
  await board.rewindToMobileStage0();
  const testId = `deal-card-${dealId}`;
  const deadline = Date.now() + timeout;
  const STAGE_COUNT = PipelineBoardPage.STAGE_COUNT;
  for (let i = 0; i < STAGE_COUNT; i++) {
    const inDom = await context.page.evaluate(
      `document.querySelector('[data-testid="${testId}"]') !== null`,
    );
    if (inDom) return;
    if (Date.now() >= deadline) break;
    // Advance to next column.
    try {
      const nextBtn = await context.page
        .locate(
          [
            { type: 'testId', value: 'pipeline-mobile-next' },
            { type: 'css', value: '[data-testid="pipeline-mobile-next"]' },
          ],
          { intent: 'mobile pipeline next stage button during deal card scan' },
        )
        .resolve();
      if (!(await nextBtn.isEnabled().catch(() => false))) break;
      const headingEl = await context.page
        .locate(
          [
            { type: 'testId', value: 'pipeline-mobile-stage-name' },
            { type: 'css', value: '[data-testid="pipeline-mobile-stage-name"]' },
          ],
          { intent: 'mobile pipeline stage heading during deal card scan' },
        )
        .resolve();
      const prevHeading = (await headingEl.textContent()) ?? '';
      await nextBtn.click();
      // Inline the same stage-change wait that PipelineBoardPage uses internally.
      const predicate = `(() => {
        const el = document.querySelector('[data-testid="pipeline-mobile-stage-name"]');
        return el !== null && el.textContent !== ${JSON.stringify(prevHeading)};
      })()`;
      await context.page
        .waitForFunction(predicate, undefined, { timeout: 5_000 })
        .catch(() => null);
    } catch {
      break;
    }
  }
  throw new Error(
    `waitForDealCardOnBoard: deal card [data-testid="${testId}"] not found in any mobile board column within ${timeout}ms`,
  );
}

/**
 * Selects a stage option on a deal card's stage dropdown on the pipeline board.
 *
 * Used when the spec needs to trigger a stage change (and possibly open the
 * CloseDealModal) rather than assert a value.
 */
export async function selectDealStageOnBoard(
  dealId: string,
  stage: string,
  context: DealsBehaviorContext,
): Promise<void> {
  const board = new PipelineBoardPage(context);
  const locator = await board.dealStageSelectLocator(dealId);
  await locator.selectOption(stage);
}

/**
 * Waits for the stage update error banner to be visible on the pipeline board.
 */
export async function waitForPipelineBoardStageUpdateError(
  context: DealsBehaviorContext,
  timeout = 10_000,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const board = new PipelineBoardPage(context);
  const locator = await board.stageUpdateErrorLocator();
  await expect(locator).toBeVisible({ timeout });
}

/**
 * Waits for the close deal modal to be visible on the pipeline board.
 */
export async function waitForPipelineBoardCloseDealModal(
  context: DealsBehaviorContext,
  timeout = 8_000,
): Promise<void> {
  // waitForPresent polls document.querySelector before resolve() so we don't hit
  // the 2s HealingLocator probe timeout while the modal is still mounting.
  await context.page.waitForPresent('[data-testid="close-deal-modal"]', timeout);
  const board = new PipelineBoardPage(context);
  const locator = await board.closeDealModalLocator();
  if (locator) {
    await locator.waitFor({ state: 'visible', timeout });
  }
}

/**
 * Cancels the close-deal modal without confirming the stage change.
 */
export async function cancelCloseDealModal(context: DealsBehaviorContext): Promise<void> {
  const board = new PipelineBoardPage(context);
  await board.cancelCloseDeal();
}

/**
 * Clicks the New Deal button on the pipeline board.
 */
export async function clickNewDealOnBoard(context: DealsBehaviorContext): Promise<void> {
  const board = new PipelineBoardPage(context);
  await board.clickNewDeal();
}

/**
 * Waits for the mobile stage name heading to be visible on the pipeline board.
 */
export async function waitForPipelineMobileStageName(
  context: DealsBehaviorContext,
  timeout = 10_000,
): Promise<void> {
  const board = new PipelineBoardPage(context);
  const locator = await board.mobileStageNameLocator();
  await locator.waitFor({ state: 'visible', timeout });
}

/**
 * Navigates to a deal detail page.
 */
export async function navigateToDealDetail(
  id: string,
  context: DealsBehaviorContext,
): Promise<void> {
  const detail = new DealDetailPage(context);
  await detail.navigate(id);
}

/**
 * Clicks the Edit button on a deal detail page.
 */
export async function openDealEditForm(context: DealsBehaviorContext): Promise<void> {
  const detail = new DealDetailPage(context);
  await detail.clickEdit();
}

/**
 * Fills the deal name input on the deal form.
 */
export async function fillDealNameInput(
  value: string,
  context: DealsBehaviorContext,
): Promise<void> {
  const detail = new DealDetailPage(context);
  const locator = await detail.nameInputLocator();
  await locator.fill(value);
}

/**
 * Selects a stage option on the deal form's stage select.
 */
export async function selectDealStageOnForm(
  stage: string,
  context: DealsBehaviorContext,
): Promise<void> {
  const detail = new DealDetailPage(context);
  const locator = await detail.stageSelectLocator();
  await locator.selectOption(stage);
}

/**
 * Fills the deal value input on the deal form.
 */
export async function fillDealValueInput(
  value: string,
  context: DealsBehaviorContext,
): Promise<void> {
  const detail = new DealDetailPage(context);
  const locator = await detail.valueInputLocator();
  await locator.fill(value);
}

/**
 * Fills the deal close date input on the deal form.
 */
export async function fillDealCloseDateInput(
  date: string,
  context: DealsBehaviorContext,
): Promise<void> {
  const detail = new DealDetailPage(context);
  const locator = await detail.closeDateInputLocator();
  await locator.fill(date);
}

/**
 * Selects an account on the deal form's account select.
 */
export async function selectDealAccount(
  accountId: string,
  context: DealsBehaviorContext,
): Promise<void> {
  const detail = new DealDetailPage(context);
  const locator = await detail.accountSelectLocator();
  await locator.selectOption(accountId);
}

/**
 * Clicks the deal form submit button and waits for the button to detach from DOM.
 */
export async function clickDealFormSubmitAndWaitForDetach(
  context: DealsBehaviorContext,
  timeout = 15_000,
): Promise<void> {
  const detail = new DealDetailPage(context);
  const locator = await detail.submitLocator();
  await locator.click();
  await locator.waitFor({ state: 'detached', timeout });
}

/**
 * Submits the deal detail form.
 */
export async function submitDealForm(context: DealsBehaviorContext): Promise<void> {
  const detail = new DealDetailPage(context);
  await detail.submitForm();
}

/**
 * Waits for the deal name heading to be visible on the deal detail page.
 */
export async function waitForDealNameHeading(
  context: DealsBehaviorContext,
  timeout = 10_000,
): Promise<void> {
  const detail = new DealDetailPage(context);
  const locator = await detail.dealNameLocator();
  await locator.waitFor({ state: 'visible', timeout });
}

/**
 * Asserts the deal name heading is visible on the deal detail page.
 */
export async function expectDealNameHeadingVisible(
  context: DealsBehaviorContext,
  timeout = 10_000,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const detail = new DealDetailPage(context);
  const locator = await detail.dealNameLocator();
  await expect(locator).toBeVisible({ timeout });
}

/**
 * Asserts the deal name heading contains the given text.
 */
export async function expectDealNameHeadingContainsText(
  text: string,
  context: DealsBehaviorContext,
  timeout = 10_000,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const detail = new DealDetailPage(context);
  const locator = await detail.dealNameLocator();
  await expect(locator).toContainText(text, { timeout });
}

/**
 * Asserts the deal name heading has exactly the given text.
 */
export async function expectDealNameHeadingHasText(
  text: string,
  context: DealsBehaviorContext,
  timeout = 10_000,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const detail = new DealDetailPage(context);
  const locator = await detail.dealNameLocator();
  await expect(locator).toHaveText(text, { timeout });
}

/**
 * Clicks the Delete button on the deal detail page.
 */
export async function clickDeleteDeal(context: DealsBehaviorContext): Promise<void> {
  const detail = new DealDetailPage(context);
  await detail.clickDelete();
}

/**
 * Confirms deletion in the deal delete confirmation modal.
 */
export async function confirmDeleteDeal(context: DealsBehaviorContext): Promise<void> {
  const detail = new DealDetailPage(context);
  await detail.confirmDelete();
}

/**
 * Waits for the linked contacts heading to be visible on the deal detail page.
 */
export async function waitForDealLinkedContactsHeading(
  context: DealsBehaviorContext,
  timeout = 10_000,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const detail = new DealDetailPage(context);
  const locator = await detail.linkedContactsHeadingLocator();
  await expect(locator).toBeVisible({ timeout });
}

/**
 * Selects a contact in the link contact dropdown on the deal detail page.
 */
export async function selectDealLinkContact(
  contactId: string,
  context: DealsBehaviorContext,
): Promise<void> {
  const detail = new DealDetailPage(context);
  const locator = await detail.linkContactSelectLocator();
  await locator.selectOption(contactId);
}

/**
 * Clicks the link contact button on the deal detail page.
 */
export async function clickDealLinkContactButton(context: DealsBehaviorContext): Promise<void> {
  const detail = new DealDetailPage(context);
  const locator = await detail.linkContactButtonLocator();
  await locator.click();
}

/**
 * Asserts a linked contact entry is visible on the deal detail page.
 */
export async function expectDealLinkedContactVisible(
  contactId: string,
  context: DealsBehaviorContext,
  timeout = 10_000,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const detail = new DealDetailPage(context);
  const locator = await detail.linkedContactLocator(contactId);
  await expect(locator).toBeVisible({ timeout });
}

/**
 * Clicks the unlink button for a specific contact on the deal detail page.
 */
export async function clickDealUnlinkContact(
  contactId: string,
  context: DealsBehaviorContext,
): Promise<void> {
  const detail = new DealDetailPage(context);
  const locator = await detail.unlinkContactLocator(contactId);
  await locator.click();
}

/**
 * Asserts the empty state is visible when no contacts are linked to a deal.
 */
export async function expectDealLinkedContactsEmptyVisible(
  context: DealsBehaviorContext,
  timeout = 10_000,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const detail = new DealDetailPage(context);
  const locator = await detail.linkedContactsEmptyLocator();
  await expect(locator).toBeVisible({ timeout });
}

/**
 * Asserts the not-found alert is visible on a deal detail page.
 */
export async function expectDealNotFoundVisible(
  context: DealsBehaviorContext,
  timeout = 10_000,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const detail = new DealDetailPage(context);
  const locator = await detail.notFoundAlertLocator();
  await expect(locator).toBeVisible({ timeout });
}

/**
 * Asserts the back-to-deals link is visible on the deal not-found page.
 */
export async function expectDealNotFoundBackLinkVisible(
  context: DealsBehaviorContext,
  timeout = 10_000,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const detail = new DealDetailPage(context);
  const locator = await detail.notFoundBackLinkLocator();
  await expect(locator).toBeVisible({ timeout });
}

/**
 * Navigates directly to a deal detail URL by ID and waits for the not-found
 * error state to render.
 *
 * @param id - Deal UUID (may be non-existent to trigger the 404 state).
 * @param context - Playwright fixture context.
 */
export async function navigateToDealNotFound(
  id: string,
  context: DealsBehaviorContext,
): Promise<void> {
  await context.page.goto(`/deals/${id}`, { waitUntil: 'domcontentloaded' });
  await context.page.waitForPresent('p[role="alert"]');
}

/**
 * Waits for the attachments section to be visible on a deal detail page.
 */
export async function waitForDealAttachmentsSection(
  context: DealsBehaviorContext,
  timeout = 10_000,
): Promise<void> {
  const detail = new DealDetailPage(context);
  const locator = await detail.attachmentsSectionLocator();
  await locator?.waitFor({ state: 'visible', timeout });
}

/**
 * Uploads a file to a deal via the deal detail page attachments file input.
 */
export async function uploadDealAttachment(
  context: DealsBehaviorContext,
  file: { name: string; mimeType: string; buffer: Buffer },
): Promise<void> {
  const detail = new DealDetailPage(context);
  const locator = await detail.attachmentsFileInputLocator();
  await locator.setInputFiles(file);
}

/**
 * Waits for the attachments list to be visible on a deal detail page.
 */
export async function waitForDealAttachmentsList(
  context: DealsBehaviorContext,
  timeout = 10_000,
): Promise<void> {
  const detail = new DealDetailPage(context);
  const locator = await detail.attachmentsListLocator();
  await locator?.waitFor({ state: 'visible', timeout });
}

// ---------------------------------------------------------------------------
// Navigation helpers — keep page.waitForURL() out of spec files. (MINCRM-418)
// ---------------------------------------------------------------------------

/**
 * Waits for the browser URL to match the deals list path after a redirect.
 * Resolves the final pathname for the caller to assert against.
 */
export async function waitForDealsListUrl(
  context: DealsBehaviorContext,
  timeout = 10_000,
): Promise<string> {
  await context.page.waitForURL('/deals', { timeout });
  return new URL(context.page.url()).pathname;
}

// ---------------------------------------------------------------------------
// AI deal health check (MINCRM-442)
// ---------------------------------------------------------------------------

/** Result returned by runDealHealthCheck. */
export interface RunDealHealthCheckResult {
  /** HTTP status code returned by POST /deals/:id/health-check. */
  status: number;
}

/**
 * Clicks the "Check health" action and waits for the health-check POST to
 * resolve. Registers the response wait before clicking so a fast server
 * response is never missed. Does not assert — callers branch on `status`
 * per the network-response-first pattern (MINCRM-418).
 */
export async function runDealHealthCheck(
  context: DealsBehaviorContext,
): Promise<RunDealHealthCheckResult> {
  const detail = new DealDetailPage(context);
  const button = await detail.runHealthCheckButtonLocator();

  const responseReceived = context.page.waitForResponse(
    (res) => res.request().method() === 'POST' && res.url().includes('/health-check'),
    { timeout: 30_000 },
  );
  await button.click();
  const response = await responseReceived;

  return { status: response.status() };
}

/**
 * Waits for the AI deal health check result (badge, narrative, next actions)
 * to be visible after a successful check.
 */
export async function waitForDealHealthResult(
  context: DealsBehaviorContext,
  timeout = 10_000,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const detail = new DealDetailPage(context);
  const locator = await detail.healthCheckResultLocator();
  await expect(locator).toBeVisible({ timeout });
}

/**
 * Waits for the AI deal health check error message to be visible after a
 * failed check.
 */
export async function waitForDealHealthError(
  context: DealsBehaviorContext,
  timeout = 10_000,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const detail = new DealDetailPage(context);
  const locator = await detail.healthCheckErrorLocator();
  await expect(locator).toBeVisible({ timeout });
}

/**
 * Waits for the deal health empty state (shown before any check has run) to be visible.
 */
export async function waitForDealHealthEmptyState(
  context: DealsBehaviorContext,
  timeout = 10_000,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const detail = new DealDetailPage(context);
  const locator = await detail.healthCheckEmptyStateLocator();
  await expect(locator).toBeVisible({ timeout });
}

/**
 * Returns true when the deal health result container is currently visible.
 */
export async function isDealHealthResultVisible(context: DealsBehaviorContext): Promise<boolean> {
  const detail = new DealDetailPage(context);
  return detail.isHealthCheckResultVisible();
}

/**
 * Returns true when the deal health section heading is currently visible.
 * Used to assert the panel is hidden when the ai_deal_health_check flag is off.
 */
export async function isDealHealthHeadingVisible(context: DealsBehaviorContext): Promise<boolean> {
  const detail = new DealDetailPage(context);
  return detail.isHealthCheckHeadingVisible();
}

// ---------------------------------------------------------------------------
// AI stage advancement suggestion (MINCRM-443)
// ---------------------------------------------------------------------------

/**
 * Waits for the "Ready to advance?" indicator to be visible.
 */
export async function waitForStageAdvancementIndicator(
  context: DealsBehaviorContext,
  timeout = 10_000,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const detail = new DealDetailPage(context);
  const locator = await detail.stageAdvancementIndicatorLocator();
  await expect(locator).toBeVisible({ timeout });
}

/**
 * Returns true when the "Ready to advance?" indicator is currently visible.
 */
export async function isStageAdvancementIndicatorVisible(
  context: DealsBehaviorContext,
): Promise<boolean> {
  const detail = new DealDetailPage(context);
  return detail.isStageAdvancementIndicatorVisible();
}

/**
 * Clicks the "Ready to advance?" indicator, which opens the edit form
 * pre-set to the suggested next stage.
 */
export async function clickStageAdvancementIndicator(context: DealsBehaviorContext): Promise<void> {
  const detail = new DealDetailPage(context);
  const locator = await detail.stageAdvancementIndicatorLocator();
  await locator.click();
}

/**
 * Returns the currently selected value of the stage select on the deal form.
 * Used to assert the indicator pre-set the form to the suggested stage.
 */
export async function getSelectedDealFormStage(context: DealsBehaviorContext): Promise<string> {
  const detail = new DealDetailPage(context);
  const locator = await detail.stageSelectLocator();
  return locator.inputValue();
}

// ---------------------------------------------------------------------------
// AI objection pattern matching (MINCRM-471)
// ---------------------------------------------------------------------------

/** Returns true when the given activity's objection category badge is currently visible. */
export async function isObjectionCategoryBadgeVisible(
  context: DealsBehaviorContext,
  activityId: string,
): Promise<boolean> {
  const detail = new DealDetailPage(context);
  return detail.isObjectionCategoryBadgeVisible(activityId);
}

/** Waits for the given activity's card to be visible in the timeline. */
export async function waitForActivityItem(
  context: DealsBehaviorContext,
  activityId: string,
  timeout = 10_000,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const detail = new DealDetailPage(context);
  const locator = await detail.activityItemLocator(activityId);
  await expect(locator).toBeVisible({ timeout });
}

// ---------------------------------------------------------------------------
// AI proposal draft generation (MINCRM-473)
// ---------------------------------------------------------------------------

/** Clicks the "Generate Proposal Draft" button. */
export async function clickGenerateProposalDraft(context: DealsBehaviorContext): Promise<void> {
  const detail = new DealDetailPage(context);
  const locator = await detail.generateProposalDraftButtonLocator();
  await locator.click();
}

/** Returns true when the "Generate Proposal Draft" button is currently visible. */
export async function isGenerateProposalDraftButtonVisible(
  context: DealsBehaviorContext,
): Promise<boolean> {
  const detail = new DealDetailPage(context);
  return detail.isGenerateProposalDraftButtonVisible();
}

/** Waits for the full-screen proposal draft editor to be visible. */
export async function waitForProposalDraftEditor(
  context: DealsBehaviorContext,
  timeout = 10_000,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const detail = new DealDetailPage(context);
  const locator = await detail.proposalDraftEditorLocator();
  await expect(locator).toBeVisible({ timeout });
}

/** Dismisses the proposal draft editor. */
export async function dismissProposalDraftEditor(context: DealsBehaviorContext): Promise<void> {
  const detail = new DealDetailPage(context);
  const locator = await detail.proposalDraftDismissButtonLocator();
  await locator.click();
}

/**
 * Waits for the proposal draft editor to no longer be visible.
 *
 * Uses waitForAbsent rather than resolving the editor locator and asserting
 * not-visible — by the time dismiss finishes, the dialog is typically already
 * unmounted, and locate().resolve() throws StrategyExhaustedError immediately
 * on an absent element rather than treating "already gone" as success.
 */
export async function waitForProposalDraftEditorClosed(
  context: DealsBehaviorContext,
  timeout = 10_000,
): Promise<void> {
  await context.page.waitForAbsent('[data-testid="proposal-draft-editor"]', timeout);
}

// ---------------------------------------------------------------------------
// Deals list page — navigation and PDF/CSV export (MINCRM-601)
// ---------------------------------------------------------------------------

/** Navigates directly to the deals list page. */
export async function navigateToDealsList(context: DealsBehaviorContext): Promise<void> {
  const dealsPage = new DealsPage(context);
  await dealsPage.navigate();
}

/**
 * Clicks the deals list "Export PDF" button and waits for the underlying
 * export.pdf HTTP response, returning its status and content-type so the
 * spec can assert a real download was triggered without needing a
 * framework-level download-event primitive.
 */
export async function clickDealsExportPdfAndAwaitResponse(
  context: DealsBehaviorContext,
): Promise<{ status: number; contentType: string }> {
  const dealsPage = new DealsPage(context);
  await dealsPage.openExportMenu();
  const responsePromise = context.page.waitForResponse(
    (response) =>
      response.url().includes('/api/v1/deals/export.pdf') && response.request().method() === 'GET',
  );
  const button = await dealsPage.exportPdfButtonLocator();
  await button.click();
  const response = await responsePromise;
  return {
    status: response.status(),
    contentType: response.headers()['content-type'] ?? '',
  };
}

/**
 * Clicks the deal detail page's "Export PDF" button and waits for the
 * underlying single-record export.pdf HTTP response, returning its status
 * and content-type. (MINCRM-650)
 */
export async function clickDealExportPdfAndAwaitResponse(
  id: string,
  context: DealsBehaviorContext,
): Promise<{ status: number; contentType: string }> {
  const detail = new DealDetailPage(context);
  const responsePromise = context.page.waitForResponse(
    (response) =>
      response.url().includes(`/api/v1/deals/${id}/export.pdf`) &&
      response.request().method() === 'GET',
  );
  const button = await detail.exportPdfButtonLocator();
  await button.click();
  const response = await responsePromise;
  return {
    status: response.status(),
    contentType: response.headers()['content-type'] ?? '',
  };
}
