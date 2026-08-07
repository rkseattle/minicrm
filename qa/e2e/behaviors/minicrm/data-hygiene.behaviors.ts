/**
 * Behaviors for the MiniCRM data hygiene assistant queue (MINCRM-476).
 *
 * Each behavior composes DataHygienePage interactions into named,
 * intent-describing async functions. No assertions inside behaviors —
 * return typed result objects instead.
 */

import type { PageFacade } from '@framework/fixtures/index.js';
import { DataHygienePage } from '@pages/minicrm/DataHygienePage.js';

export interface DataHygieneBehaviorContext {
  page: PageFacade;
}

/** Navigates to the personal (scope=mine) hygiene queue at /hygiene. */
export async function navigateToMyDataHygieneQueue(
  context: DataHygieneBehaviorContext,
): Promise<void> {
  const hygienePage = new DataHygienePage(context);
  await hygienePage.navigatePersonal();
}

/** Navigates to the org-wide (scope=all) admin hygiene queue at /admin/hygiene. */
export async function navigateToAdminDataHygieneQueue(
  context: DataHygieneBehaviorContext,
): Promise<void> {
  const hygienePage = new DataHygienePage(context);
  await hygienePage.navigateAdmin();
}

/** Waits for the page heading to be visible. */
export async function waitForDataHygieneHeading(
  context: DataHygieneBehaviorContext,
  timeout = 10_000,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const hygienePage = new DataHygienePage(context);
  const locator = await hygienePage.headingLocator(timeout);
  await expect(locator).toBeVisible({ timeout });
}

/**
 * Returns true once the findings list has rendered at least one row, false if
 * it never does within the timeout. Never throws.
 */
export async function hasAtLeastOneHygieneFinding(
  context: DataHygieneBehaviorContext,
  timeout = 10_000,
): Promise<boolean> {
  const hygienePage = new DataHygienePage(context);
  return hygienePage.hasAtLeastOneFinding(timeout);
}

/**
 * Dismisses a specific hygiene finding: clicks its Dismiss action, fills in
 * the required reason, and confirms. Waits for the dialog to close and the
 * finding row to disappear from the list.
 */
export async function dismissHygieneFindingViaUI(
  findingId: string,
  reason: string,
  context: DataHygieneBehaviorContext,
): Promise<void> {
  const hygienePage = new DataHygienePage(context);
  await hygienePage.clickDismiss(findingId);
  await hygienePage.fillDismissReason(reason);

  const responsePromise = context.page.waitForResponse(
    (response) =>
      response.url().includes(`/api/v1/data-hygiene/findings/${findingId}/dismiss`) &&
      response.request().method() === 'POST',
  );
  await hygienePage.clickDismissConfirm();
  await responsePromise;

  await hygienePage.waitForDismissDialogClosed();
  await hygienePage.waitForFindingAbsent(findingId);
}
