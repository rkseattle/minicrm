/**
 * Behaviors for the MiniCRM in-app notification bell (MINCRM-469).
 *
 * Each behavior composes NotificationBellPage interactions into named,
 * intent-describing async functions. No assertions inside behaviors —
 * return typed result objects instead.
 */

import type { PageFacade } from '@framework/fixtures/index.js';
import { NotificationBellPage } from '@pages/minicrm/NotificationBellPage.js';

export interface NotificationBellBehaviorContext {
  page: PageFacade;
}

/** Navigates to the dashboard, where the notification bell is present in the nav header. */
export async function navigateToDashboardForNotifications(
  context: NotificationBellBehaviorContext,
): Promise<void> {
  await context.page.goto('/');
}

/** Opens the notification dropdown. */
export async function openNotificationDropdown(
  context: NotificationBellBehaviorContext,
): Promise<void> {
  const bell = new NotificationBellPage(context);
  await bell.toggle();
}

/** Waits for the notification bell button to be visible. */
export async function waitForNotificationBell(
  context: NotificationBellBehaviorContext,
  timeout = 10_000,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const bell = new NotificationBellPage(context);
  const locator = await bell.bellButtonLocator(timeout);
  await expect(locator).toBeVisible({ timeout });
}

/** Returns true when the unread-count badge is currently visible. */
export async function isNotificationBadgeVisible(
  context: NotificationBellBehaviorContext,
): Promise<boolean> {
  const bell = new NotificationBellPage(context);
  return bell.isUnreadBadgeVisible();
}

/** Waits for the notification dropdown empty state to be visible. */
export async function waitForNotificationEmptyState(
  context: NotificationBellBehaviorContext,
  timeout = 10_000,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const bell = new NotificationBellPage(context);
  const locator = await bell.emptyStateLocator(timeout);
  await expect(locator).toBeVisible({ timeout });
}
