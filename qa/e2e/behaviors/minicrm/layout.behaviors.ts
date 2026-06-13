/**
 * Layout behaviors for MiniCRM.
 *
 * Behaviors that verify layout-level properties of the UI — viewport fill,
 * container sizing, responsive structure — shared across multiple page domains.
 *
 * Behaviors do NOT contain assertions (no expect() calls). They return typed
 * result objects that test specs assert against.
 *
 * MINCRM-404
 */

import type { PageFacade, SafeLocator } from '@framework/fixtures/index.js';
import type { PageFacadeShape } from '@framework/fixtures/heal-methods.js';
import { StrategyExhaustedError } from '@framework/healing/index.js';

// ---------------------------------------------------------------------------
// Fixture context
// ---------------------------------------------------------------------------

/** Fixtures required by layout behaviors. */
export interface LayoutBehaviorContext {
  page: PageFacade;
}

// ---------------------------------------------------------------------------
// assertEmptyStateContainerFills()
// ---------------------------------------------------------------------------

/** Result returned by assertEmptyStateContainerFills. */
export interface EmptyStateContainerFillResult {
  /**
   * Rendered clientHeight in pixels of the nearest overflow-auto ancestor of
   * the empty-state element. Zero means the ancestor was not found.
   */
  containerHeight: number;
  /** True when the empty-state element itself has a positive bounding rect. */
  emptyStateVisible: boolean;
}

/**
 * Waits for the empty-state element identified by `emptyStateTestId` to appear
 * in the DOM, then measures whether the PagedListLayout container fills the
 * available viewport height.
 *
 * Returns the container's clientHeight and whether the empty-state element
 * itself is visible — the caller asserts thresholds.
 *
 * DOM access uses browser-evaluated string expressions to avoid TypeScript
 * lib:dom errors in the Node-targeted QA tsconfig.
 *
 * @param emptyStateTestId - data-testid of the empty-state element.
 * @param context          - Playwright fixture context.
 */
export async function assertEmptyStateContainerFills(
  emptyStateTestId: string,
  context: LayoutBehaviorContext,
): Promise<EmptyStateContainerFillResult> {
  const { page } = context;

  await page.waitForPresent(`[data-testid="${emptyStateTestId}"]`);

  // Walk up from the empty-state element to find the nearest overflow-auto
  // ancestor that PagedListLayout applies to the list container, then return
  // its clientHeight. Poll until the container has a positive height so that
  // a deferred flex layout pass in CI does not return 0 prematurely.
  const getHeight = `(() => {
    const el = document.querySelector('[data-testid="${emptyStateTestId}"]');
    if (!el) return 0;
    let node = el.parentElement;
    while (node) {
      if (node.classList.contains('overflow-auto') || node.classList.contains('overflow-hidden')) {
        return node.clientHeight;
      }
      node = node.parentElement;
    }
    return 0;
  })()`;

  // Wait up to 5 s for the flex chain to resolve before taking the measurement.
  await page.waitForFunction(getHeight + ' > 0').catch(() => {
    // If the container never grows, fall through and return 0 so the caller's
    // assertion produces a clear failure message rather than a timeout.
  });

  const containerHeight = (await page.evaluate(getHeight)) as number;

  const emptyEl = await page
    .locate(
      [
        { type: 'testId', value: emptyStateTestId },
        { type: 'css', value: `[data-testid="${emptyStateTestId}"]` },
      ],
      { intent: `empty-state message for the ${emptyStateTestId} list page` },
    )
    .resolve();

  const emptyStateVisible = await emptyEl.isVisible().catch(() => false);

  return { containerHeight, emptyStateVisible };
}

// ---------------------------------------------------------------------------
// Generic page navigation helpers — keep page.goto() out of spec files for
// pages that don't have a dedicated behavior module. (MINCRM-418)
// ---------------------------------------------------------------------------

/**
 * Navigates to a contact detail page by ID and waits for network idle.
 */
export async function navigateToContactDetailPage(
  contactId: string,
  context: LayoutBehaviorContext,
): Promise<void> {
  await context.page.goto(`/contacts/${contactId}`, { waitUntil: 'networkidle' });
}

/**
 * Navigates to a deal detail page by ID and waits for network idle.
 */
export async function navigateToDealDetailPage(
  dealId: string,
  context: LayoutBehaviorContext,
): Promise<void> {
  await context.page.goto(`/deals/${dealId}`, { waitUntil: 'networkidle' });
}

/**
 * Navigates to an account detail page by ID and waits for network idle.
 */
export async function navigateToAccountDetailPage(
  accountId: string,
  context: LayoutBehaviorContext,
): Promise<void> {
  await context.page.goto(`/accounts/${accountId}`, { waitUntil: 'networkidle' });
}

/**
 * Navigates to the contacts list page and waits for network idle.
 */
export async function navigateToContactsPage(context: LayoutBehaviorContext): Promise<void> {
  await context.page.goto('/contacts', { waitUntil: 'networkidle' });
}

/**
 * Navigates to the accounts list page and waits for network idle.
 */
export async function navigateToAccountsPage(context: LayoutBehaviorContext): Promise<void> {
  await context.page.goto('/accounts', { waitUntil: 'networkidle' });
}

/**
 * Navigates to the leads list page and waits for network idle.
 */
export async function navigateToLeadsPage(context: LayoutBehaviorContext): Promise<void> {
  await context.page.goto('/leads', { waitUntil: 'networkidle' });
}

/**
 * Navigates to the tasks list page and waits for network idle.
 */
export async function navigateToTasksPage(context: LayoutBehaviorContext): Promise<void> {
  await context.page.goto('/tasks', { waitUntil: 'networkidle' });
}

/**
 * Navigates to a page by path and waits for network idle.
 */
export async function navigateToPath(path: string, context: LayoutBehaviorContext): Promise<void> {
  await context.page.goto(path, { waitUntil: 'networkidle' });
}

// ---------------------------------------------------------------------------
// Locator helpers for visual-regression spec — keep page.locate() out of spec
// files for one-off ready-check locators. (MINCRM-418)
// ---------------------------------------------------------------------------

/**
 * Resolves the dashboard stat cards element — used as a page-ready anchor.
 */
export async function getDashboardStatCardsLocator(context: LayoutBehaviorContext) {
  return context.page
    .locate(
      [
        { type: 'testId', value: 'dashboard-stat-cards' },
        { type: 'role', value: 'region' },
      ],
      { intent: 'dashboard KPI stat cards grid' },
    )
    .resolve();
}

/**
 * Resolves the "my tasks" page heading — used as a ready anchor on the tasks list.
 */
export async function getMyTasksHeadingLocator(context: LayoutBehaviorContext) {
  return context.page
    .locate(
      [
        { type: 'testId', value: 'my-tasks-heading' },
        { type: 'role', value: 'heading', options: { level: 1 } },
      ],
      { intent: 'my tasks page heading confirming the tasks list is ready' },
    )
    .resolve();
}

/**
 * Resolves the "new contact" button — used as a ready anchor on the contacts list.
 */
export async function getNewContactButtonLocator(context: LayoutBehaviorContext) {
  return context.page
    .locate(
      [
        { type: 'testId', value: 'new-contact-button' },
        { type: 'role', value: 'button', options: { name: /new contact/i } },
      ],
      { intent: 'new contact button confirming the contacts list is ready' },
    )
    .resolve();
}

/**
 * Resolves the "new account" button — used as a ready anchor on the accounts list.
 */
export async function getNewAccountButtonLocator(context: LayoutBehaviorContext) {
  return context.page
    .locate(
      [
        { type: 'testId', value: 'new-account-button' },
        { type: 'role', value: 'button', options: { name: /new account/i } },
      ],
      { intent: 'new account button confirming the accounts list is ready' },
    )
    .resolve();
}

/**
 * Resolves the "new lead" button — used as a ready anchor on the leads list.
 */
export async function getNewLeadButtonLocator(context: LayoutBehaviorContext) {
  return context.page
    .locate(
      [
        { type: 'testId', value: 'new-lead-button' },
        { type: 'role', value: 'button', options: { name: /new lead/i } },
      ],
      { intent: 'new lead button confirming the leads list is ready' },
    )
    .resolve();
}

/**
 * Resolves the account name heading — used as a ready anchor on account detail.
 */
export async function getAccountNameHeadingLocator(context: LayoutBehaviorContext) {
  return context.page
    .locate(
      [
        { type: 'testId', value: 'account-name' },
        { type: 'role', value: 'heading', options: { level: 1 } },
      ],
      { intent: 'account name heading confirming the account detail page has loaded' },
    )
    .resolve();
}

// ---------------------------------------------------------------------------
// Visual-regression timestamp mask helper (MINCRM-418)
// ---------------------------------------------------------------------------

/** Silently resolves a locator; returns null when not found (StrategyExhaustedError). */
async function tryResolve(page: PageFacadeShape, ...args: Parameters<PageFacadeShape['locate']>) {
  try {
    return await page.locate(...args).resolve();
  } catch (err) {
    if (err instanceof StrategyExhaustedError) return null;
    throw err;
  }
}

/**
 * Resolves all dynamic timestamp / date locators on the current page.
 * Each candidate is silently dropped when absent (StrategyExhaustedError).
 * Pass the returned array as the `mask` option to `page.checkScreenshot()`.
 */
export async function resolveTimestampMasks(
  context: LayoutBehaviorContext,
): Promise<SafeLocator[]> {
  const { page } = context;
  const candidates = await Promise.all([
    tryResolve(page, [{ type: 'css', value: '[data-testid^="recent-activity-time-"]' }], {
      intent: 'dashboard recent activity relative timestamp cells',
    }),
    tryResolve(page, [{ type: 'css', value: '[data-testid^="activity-meta-"]' }], {
      intent: 'activity timeline metadata timestamp cells',
    }),
    tryResolve(page, [{ type: 'testId', value: 'detail-created' }], {
      intent: 'detail page created-at timestamp field',
    }),
    tryResolve(page, [{ type: 'css', value: '[data-testid^="lead-created-"]' }], {
      intent: 'leads list created-at timestamp cells',
    }),
    tryResolve(page, [{ type: 'css', value: '[data-testid^="task-due-date-"]' }], {
      intent: 'tasks list due date cells',
    }),
    tryResolve(page, [{ type: 'css', value: '[data-testid^="user-joined-"]' }], {
      intent: 'user management table joined date cells',
    }),
  ]);
  return candidates.filter((c): c is SafeLocator => c !== null);
}

// ---------------------------------------------------------------------------
// Dashboard-specific locator helpers (MINCRM-418)
// ---------------------------------------------------------------------------

/**
 * Resolves the recent activity feed element on the dashboard.
 */
export async function getRecentActivityFeedLocator(context: LayoutBehaviorContext) {
  return context.page
    .locate(
      [
        { type: 'testId', value: 'recent-activity-feed' },
        { type: 'role', value: 'region', options: { name: /recent activity/i } },
      ],
      { intent: 'recent activity feed section on the dashboard page' },
    )
    .resolve();
}

/**
 * Resolves a stat card by testId suffix (e.g. 'pipeline-value', 'overdue-tasks').
 */
export async function getDashboardStatCardLocator(statKey: string, context: LayoutBehaviorContext) {
  return context.page
    .locate(
      [
        { type: 'testId', value: `stat-${statKey}` },
        { type: 'css', value: `[data-testid="stat-${statKey}"]` },
      ],
      { intent: `${statKey} stat card on the dashboard` },
    )
    .resolve();
}

/**
 * Resolves the value element inside a stat card by key.
 */
export async function getDashboardStatCardValueLocator(
  statKey: string,
  context: LayoutBehaviorContext,
) {
  return context.page
    .locate(
      [
        { type: 'testId', value: `stat-${statKey}-value` },
        { type: 'css', value: `[data-testid="stat-${statKey}-value"]` },
      ],
      { intent: `numeric value inside the ${statKey} stat card` },
    )
    .resolve();
}

/**
 * Resolves a recent-activity entry by its activity ID.
 * eslint-disable-next-line local/require-locator-fallback -- dynamic UUID-keyed; no stable role fallback
 */
export async function getRecentActivityEntryLocator(
  activityId: string,
  context: LayoutBehaviorContext,
) {
  // eslint-disable-next-line local/require-locator-fallback -- dynamic UUID-keyed activity row has no stable role fallback
  return context.page
    .locate([{ type: 'testId', value: `recent-activity-${activityId}` }])
    .resolve();
}

/**
 * Counts elements matching the given strategies. Returns the count.
 */
export async function countElements(
  strategies: Parameters<LayoutBehaviorContext['page']['locate']>[0],
  intent: string,
  context: LayoutBehaviorContext,
): Promise<number> {
  return context.page.count(strategies, { intent });
}
