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

import type { SafePage } from '@framework/fixtures/index.js';
import type { HealPage } from '@framework/fixtures/heal-page.fixture.js';
import { PipelineBoardPage } from '@pages/minicrm/PipelineBoardPage.js';
import type { PipelineStage } from '@pages/minicrm/PipelineBoardPage.js';

// ---------------------------------------------------------------------------
// Fixture context
// ---------------------------------------------------------------------------

/** Fixtures required by deal behaviors. */
export interface DealsBehaviorContext {
  page: SafePage;
  healPage: HealPage;
  testName: string;
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
 * const result = await openDeal(deal.id, { page, healPage, testName });
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
 * const result = await advanceDealStage(deal.id, 'Qualification', { page, healPage, testName });
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
  const columnSlug = await boardPage.getDealColumnSlug(dealId);
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
 * const result = await closeDealAsWon(deal.id, { page, healPage, testName });
 * expect(result.columnSlug).toBe('closed-won');
 * ```
 */
export async function closeDealAsWon(
  dealId: string,
  context: DealsBehaviorContext,
): Promise<CloseDealAsWonResult> {
  return advanceDealStage(dealId, 'Closed Won', context);
}
