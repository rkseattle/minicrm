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
    // closeDealModalLocator(), because locate().resolve() throws StrategyExhaustedError
    // immediately when the element is absent rather than waiting for it to appear.
    await context.page.waitForFunction(
      `document.querySelector('[data-testid="close-deal-modal"]') !== null`,
      undefined,
      { timeout: 8_000 },
    );
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
  await context.page.waitForFunction(
    `document.querySelector(${JSON.stringify(cardInTargetSelector)}) !== null`,
    undefined,
    { timeout: 25_000 },
  );

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
