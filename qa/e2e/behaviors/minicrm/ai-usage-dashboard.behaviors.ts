/**
 * Behaviors for the MiniCRM AI usage/cost dashboard page (MINCRM-459).
 *
 * Each behavior composes AiUsageDashboardPage interactions into named,
 * intent-describing async functions. No assertions inside behaviors —
 * return typed result objects or resolved locators instead.
 */

import type { PageFacade } from '@framework/fixtures/index.js';
import { AiUsageDashboardPage } from '@pages/minicrm/AiUsageDashboardPage.js';

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

export interface AiUsageDashboardBehaviorContext {
  page: PageFacade;
}

// ---------------------------------------------------------------------------
// Behaviors
// ---------------------------------------------------------------------------

/** Navigates directly to the AI usage/cost dashboard page. */
export async function navigateToAiUsageDashboard(
  context: AiUsageDashboardBehaviorContext,
): Promise<void> {
  const dashboard = new AiUsageDashboardPage(context);
  await dashboard.navigate();
}

/** Returns the total-tokens summary card locator. */
export async function getAiUsageTotalTokensCard(context: AiUsageDashboardBehaviorContext) {
  return new AiUsageDashboardPage(context).totalTokensCardLocator();
}

/** Returns the per-user usage table locator. */
export async function getAiUsagePerUserTable(context: AiUsageDashboardBehaviorContext) {
  return new AiUsageDashboardPage(context).perUserTableLocator();
}

/** Selects a date range preset on the dashboard (e.g. 'last_month', 'custom'). */
export async function selectAiUsageRangePreset(
  preset: string,
  context: AiUsageDashboardBehaviorContext,
): Promise<void> {
  await new AiUsageDashboardPage(context).selectRangePreset(preset);
}

/**
 * Clicks the AI usage dashboard "Export PDF" button and waits for the
 * underlying export.pdf HTTP response, returning its status and content-type
 * so the spec can assert a real download was triggered. (MINCRM-601)
 */
export async function clickAiUsageExportPdfAndAwaitResponse(
  context: AiUsageDashboardBehaviorContext,
): Promise<{ status: number; contentType: string }> {
  const dashboard = new AiUsageDashboardPage(context);
  await dashboard.openExportMenu();
  const responsePromise = context.page.waitForResponse(
    (response) =>
      response.url().includes('/api/v1/admin/ai/usage/export.pdf') &&
      response.request().method() === 'GET',
  );
  await dashboard.clickExportPdf();
  const response = await responsePromise;
  return {
    status: response.status(),
    contentType: response.headers()['content-type'] ?? '',
  };
}
