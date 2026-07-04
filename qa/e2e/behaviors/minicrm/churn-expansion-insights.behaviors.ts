/**
 * Behaviors for the MiniCRM AI churn/expansion insights page (MINCRM-469).
 *
 * Each behavior composes ChurnExpansionInsightsPage interactions into named,
 * intent-describing async functions. No assertions inside behaviors —
 * return typed result objects instead.
 */

import type { PageFacade } from '@framework/fixtures/index.js';
import { ChurnExpansionInsightsPage } from '@pages/minicrm/ChurnExpansionInsightsPage.js';

export interface ChurnExpansionInsightsBehaviorContext {
  page: PageFacade;
}

/** Navigates directly to the churn/expansion insights page. */
export async function navigateToChurnExpansionInsights(
  context: ChurnExpansionInsightsBehaviorContext,
): Promise<void> {
  const insightsPage = new ChurnExpansionInsightsPage(context);
  await insightsPage.navigate();
}

/** Waits for the page heading to be visible. */
export async function waitForChurnExpansionInsightsHeading(
  context: ChurnExpansionInsightsBehaviorContext,
  timeout = 10_000,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const insightsPage = new ChurnExpansionInsightsPage(context);
  const locator = await insightsPage.headingLocator();
  await expect(locator).toBeVisible({ timeout });
}

/** Waits for the at-risk accounts empty state to be visible. */
export async function waitForAtRiskEmptyState(
  context: ChurnExpansionInsightsBehaviorContext,
  timeout = 10_000,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const insightsPage = new ChurnExpansionInsightsPage(context);
  const locator = await insightsPage.atRiskEmptyStateLocator();
  await expect(locator).toBeVisible({ timeout });
}

/** Returns true when the page heading is currently visible. */
export async function isChurnExpansionInsightsHeadingVisible(
  context: ChurnExpansionInsightsBehaviorContext,
): Promise<boolean> {
  const insightsPage = new ChurnExpansionInsightsPage(context);
  return insightsPage.isHeadingVisible();
}
