/**
 * Behaviors for the MiniCRM AI rep coaching insights page.
 *
 * Each behavior composes CoachingInsightsPage interactions into named,
 * intent-describing async functions. No assertions inside behaviors —
 * return typed result objects instead.
 */

import type { PageFacade } from '@framework/fixtures/index.js';
import { CoachingInsightsPage } from '@pages/minicrm/CoachingInsightsPage.js';

export interface CoachingInsightsBehaviorContext {
  page: PageFacade;
}

/** Navigates directly to the manager/admin rep coaching insights page. */
export async function navigateToCoachingInsights(
  context: CoachingInsightsBehaviorContext,
): Promise<void> {
  const insightsPage = new CoachingInsightsPage(context);
  await insightsPage.navigate();
}

/** Waits for the page heading to be visible. */
export async function waitForCoachingInsightsHeading(
  context: CoachingInsightsBehaviorContext,
  timeout = 10_000,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const insightsPage = new CoachingInsightsPage(context);
  const locator = await insightsPage.headingLocator(timeout);
  await expect(locator).toBeVisible({ timeout });
}

/** Selects a specific rep by ID from the rep selector dropdown. */
export async function selectCoachingRep(
  repId: string,
  context: CoachingInsightsBehaviorContext,
): Promise<void> {
  const insightsPage = new CoachingInsightsPage(context);
  await insightsPage.selectRep(repId);
}

/**
 * Returns true once the insights list has rendered at least one row, false if
 * it never does within the timeout. Never throws.
 */
export async function hasAtLeastOneCoachingInsight(
  context: CoachingInsightsBehaviorContext,
  timeout = 10_000,
): Promise<boolean> {
  const insightsPage = new CoachingInsightsPage(context);
  return insightsPage.hasAtLeastOneInsightRow(timeout);
}

/** Waits for the insufficient-closed-deal-data message to be visible. */
export async function waitForCoachingInsufficientData(
  context: CoachingInsightsBehaviorContext,
  timeout = 10_000,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const insightsPage = new CoachingInsightsPage(context);
  const locator = await insightsPage.insufficientDataLocator(timeout);
  await expect(locator).toBeVisible({ timeout });
}

/**
 * Waits for either the insights list (at least one row) or the "sufficient
 * data but zero insights" empty state to be visible — whichever the rep's
 * current data produces. Returns which one appeared.
 */
export async function waitForCoachingListOrEmptyState(
  context: CoachingInsightsBehaviorContext,
  timeout = 10_000,
): Promise<'list' | 'empty'> {
  const insightsPage = new CoachingInsightsPage(context);
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await insightsPage.hasAtLeastOneInsightRow(250)) return 'list';
    const emptyVisible = await insightsPage
      .emptyInsightsLocator(timeout)
      .then((locator) => locator.isVisible())
      .catch(() => false);
    if (emptyVisible) return 'empty';
  }
  throw new Error(
    'waitForCoachingListOrEmptyState: neither the insights list nor the empty state appeared within the timeout',
  );
}
