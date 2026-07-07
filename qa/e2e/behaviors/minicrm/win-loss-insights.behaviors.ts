/**
 * Behaviors for the MiniCRM AI win/loss pattern insights page (MINCRM-464).
 *
 * Each behavior composes WinLossInsightsPage interactions into named,
 * intent-describing async functions. No assertions inside behaviors —
 * return typed result objects instead.
 */

import type { PageFacade } from '@framework/fixtures/index.js';
import { WinLossInsightsPage } from '@pages/minicrm/WinLossInsightsPage.js';

export interface WinLossInsightsBehaviorContext {
  page: PageFacade;
}

/** Navigates directly to the win/loss pattern insights page. */
export async function navigateToWinLossInsights(
  context: WinLossInsightsBehaviorContext,
): Promise<void> {
  const insightsPage = new WinLossInsightsPage(context);
  await insightsPage.navigate();
}

/** Waits for the page heading to be visible. */
export async function waitForWinLossInsightsHeading(
  context: WinLossInsightsBehaviorContext,
  timeout = 10_000,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const insightsPage = new WinLossInsightsPage(context);
  const locator = await insightsPage.headingLocator();
  await expect(locator).toBeVisible({ timeout });
}

/** Waits for the insufficient-closed-deal-history message to be visible. */
export async function waitForWinLossInsufficientData(
  context: WinLossInsightsBehaviorContext,
  timeout = 10_000,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const insightsPage = new WinLossInsightsPage(context);
  const locator = await insightsPage.insufficientDataLocator();
  await expect(locator).toBeVisible({ timeout });
}

/** Returns true when the win patterns section heading is currently visible. */
export async function isWinPatternsHeadingVisible(
  context: WinLossInsightsBehaviorContext,
): Promise<boolean> {
  const insightsPage = new WinLossInsightsPage(context);
  return insightsPage.isWinPatternsHeadingVisible();
}

/** Returns true when the Export CSV button is currently enabled. */
export async function isWinLossExportCsvEnabled(
  context: WinLossInsightsBehaviorContext,
): Promise<boolean> {
  const insightsPage = new WinLossInsightsPage(context);
  const locator = await insightsPage.exportCsvButtonLocator();
  return locator.isEnabled().catch(() => false);
}

/**
 * Clicks the win/loss insights "Export PDF" button and waits for the
 * underlying export.pdf HTTP response, returning its status and content-type
 * so the spec can assert a real download was triggered. (MINCRM-601)
 */
export async function clickWinLossExportPdfAndAwaitResponse(
  context: WinLossInsightsBehaviorContext,
): Promise<{ status: number; contentType: string }> {
  const insightsPage = new WinLossInsightsPage(context);
  const responsePromise = context.page.waitForResponse(
    (response) =>
      response.url().includes('/api/v1/insights/win-loss/export.pdf') &&
      response.request().method() === 'GET',
  );
  const button = await insightsPage.exportPdfButtonLocator();
  await button.click();
  const response = await responsePromise;
  return {
    status: response.status(),
    contentType: response.headers()['content-type'] ?? '',
  };
}
