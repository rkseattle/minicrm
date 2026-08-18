/**
 * Layout behaviors for MiniCRM.
 *
 * Behaviors that verify layout-level properties of the UI — viewport fill,
 * container sizing, responsive structure — shared across multiple page domains.
 *
 * Behaviors do NOT contain assertions (no expect() calls). They return typed
 * result objects that test specs assert against.
 *
 *
 */

import type { PageFacade, SafeLocator } from '@framework/fixtures/index.js';
import { gotoAndSettle } from '@apps/minicrm/helpers.js';
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
   * Rendered height in pixels (via getBoundingClientRect) of the nearest
   * overflow-auto ancestor of the empty-state element. Zero means the ancestor
   * was not found or its flex layout had not resolved within the polling window.
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
  // ancestor that PagedListLayout applies to the list container, then measure
  // its rendered height. Use getBoundingClientRect().height rather than
  // clientHeight because mobile Chrome's flex-1+min-h-0 layout can resolve
  // correctly in the render tree while clientHeight still reports 0 (the
  // scrollport size is derived from the containing block, not the scroll
  // container itself, in certain Chromium mobile rendering paths).
  const getHeight = `(() => {
    const el = document.querySelector('[data-testid="${emptyStateTestId}"]');
    if (!el) return 0;
    let node = el.parentElement;
    while (node) {
      if (node.classList.contains('overflow-auto') || node.classList.contains('overflow-hidden')) {
        return node.getBoundingClientRect().height;
      }
      node = node.parentElement;
    }
    return 0;
  })()`;

  // Poll until the flex chain has resolved and the container has a positive
  // rendered height. Use an explicit 15 s timeout — the mobile flex chain can
  // take longer to settle under CI load than the default expect.timeout (5 s).
  // Falls through with 0 on timeout so the spec assertion produces a clear
  // failure message rather than a generic waitForFunction timeout error.
  await page.waitForFunction(getHeight + ' > 0', undefined, { timeout: 15_000 }).catch(() => {});

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
// pages that don't have a dedicated behavior module.
// ---------------------------------------------------------------------------

/**
 * Navigates to a contact detail page by ID and waits for network idle.
 */
export async function navigateToContactDetailPage(
  contactId: string,
  context: LayoutBehaviorContext,
): Promise<void> {
  // Register before goto so a fast server response isn't missed.
  // networkidle can resolve before React Query renders the contact data;
  // waiting for the GET response ensures data is in the cache before callers assert.
  const contactLoaded = context.page.waitForResponse(
    (res) => res.url().includes(`/api/v1/contacts/${contactId}`) && res.status() === 200,
    { timeout: 15_000 },
  );
  await gotoAndSettle(context.page, `/contacts/${contactId}`);
  await contactLoaded;
}

/**
 * Navigates to a deal detail page by ID and waits for network idle.
 */
export async function navigateToDealDetailPage(
  dealId: string,
  context: LayoutBehaviorContext,
): Promise<void> {
  await gotoAndSettle(context.page, `/deals/${dealId}`);
}

/**
 * Navigates to an account detail page by ID and waits for network idle.
 */
export async function navigateToAccountDetailPage(
  accountId: string,
  context: LayoutBehaviorContext,
): Promise<void> {
  await gotoAndSettle(context.page, `/accounts/${accountId}`);
}

/**
 * Navigates to the contacts list page and waits for network idle.
 */
export async function navigateToContactsPage(context: LayoutBehaviorContext): Promise<void> {
  await gotoAndSettle(context.page, '/contacts');
}

/**
 * Navigates to the accounts list page and waits for network idle.
 */
export async function navigateToAccountsPage(context: LayoutBehaviorContext): Promise<void> {
  await gotoAndSettle(context.page, '/accounts');
}

/**
 * Navigates to the leads list page and waits for network idle.
 */
export async function navigateToLeadsPage(context: LayoutBehaviorContext): Promise<void> {
  await gotoAndSettle(context.page, '/leads');
}

/**
 * Navigates to the tasks list page and waits for network idle.
 */
export async function navigateToTasksPage(context: LayoutBehaviorContext): Promise<void> {
  await gotoAndSettle(context.page, '/tasks');
}

/**
 * Navigates to a page by path and waits for network idle.
 */
export async function navigateToPath(path: string, context: LayoutBehaviorContext): Promise<void> {
  await gotoAndSettle(context.page, path);
}

// ---------------------------------------------------------------------------
// Locator helpers for visual-regression spec — keep page.locate() out of spec
// files for one-off ready-check locators.
// ---------------------------------------------------------------------------

/** Waits for the dashboard stat cards to become visible — page-ready anchor. */
export async function waitForDashboardStatCards(context: LayoutBehaviorContext): Promise<void> {
  const locator = await context.page
    .locate(
      [
        { type: 'testId', value: 'dashboard-stat-cards' },
        { type: 'role', value: 'region' },
      ],
      { intent: 'dashboard KPI stat cards grid' },
    )
    .resolve();
  await locator.waitFor({ state: 'visible' });
}

/** Waits for the "my tasks" page heading to become visible — page-ready anchor. */
export async function waitForMyTasksHeading(context: LayoutBehaviorContext): Promise<void> {
  const locator = await context.page
    .locate(
      [
        { type: 'testId', value: 'my-tasks-heading' },
        { type: 'role', value: 'heading', options: { level: 1 } },
      ],
      { intent: 'my tasks page heading confirming the tasks list is ready' },
    )
    .resolve();
  await locator.waitFor({ state: 'visible' });
}

/** Waits for the "new contact" button to become visible — page-ready anchor. */
export async function waitForNewContactButton(context: LayoutBehaviorContext): Promise<void> {
  const locator = await context.page
    .locate(
      [
        { type: 'testId', value: 'new-contact-button' },
        { type: 'role', value: 'button', options: { name: /new contact/i } },
      ],
      { intent: 'new contact button confirming the contacts list is ready' },
    )
    .resolve();
  await locator.waitFor({ state: 'visible' });
}

/** Waits for the "new account" button to become visible — page-ready anchor. */
export async function waitForNewAccountButton(context: LayoutBehaviorContext): Promise<void> {
  const locator = await context.page
    .locate(
      [
        { type: 'testId', value: 'new-account-button' },
        { type: 'role', value: 'button', options: { name: /new account/i } },
      ],
      { intent: 'new account button confirming the accounts list is ready' },
    )
    .resolve();
  await locator.waitFor({ state: 'visible' });
}

/** Waits for the "new lead" button to become visible — page-ready anchor. */
export async function waitForNewLeadButton(context: LayoutBehaviorContext): Promise<void> {
  const locator = await context.page
    .locate(
      [
        { type: 'testId', value: 'new-lead-button' },
        { type: 'role', value: 'button', options: { name: /new lead/i } },
      ],
      { intent: 'new lead button confirming the leads list is ready' },
    )
    .resolve();
  await locator.waitFor({ state: 'visible' });
}

/** Waits for the account name heading to become visible — page-ready anchor on account detail. */
export async function waitForAccountNameHeading(context: LayoutBehaviorContext): Promise<void> {
  const locator = await context.page
    .locate(
      [
        { type: 'testId', value: 'account-name' },
        { type: 'role', value: 'heading', options: { level: 1 } },
      ],
      { intent: 'account name heading confirming the account detail page has loaded' },
    )
    .resolve();
  await locator.waitFor({ state: 'visible' });
}

// ---------------------------------------------------------------------------
// Visual-regression timestamp mask helper
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
    // Not timestamps, but resolved here rather than as a separate mask
    // function since every visual-regression call site already spreads
    // this same array — E2E admin fixtures mint a randomized display name
    // per test run (e.g. "VR Admin 1785118878095-..."), so any element
    // that renders it is inherently non-deterministic across any two
    // captures, the same class of problem every other mask in this list
    // solves. Two independent elements render this name — the top-nav
    // header (NavHeader.tsx, had no data-testid at all until this fix) and
    // the dashboard's own welcome heading (DashboardPage.tsx, already
    // carried dashboard-heading) — found via a real visual-regression run:
    // after regenerating stale baselines, captures still failed by small
    // pixel counts that looked like noise but traced to these two
    // unmasked elements.
    tryResolve(page, [{ type: 'testId', value: 'nav-user-name' }], {
      intent: 'top-nav user display name (randomized per E2E fixture run)',
    }),
    tryResolve(page, [{ type: 'testId', value: 'dashboard-heading' }], {
      intent: 'dashboard welcome heading, embeds the same randomized user display name',
    }),
    // Also not a timestamp — contacts-list rows render each contact's
    // email, and createTestContact's default email carries the same
    // Date.now()-based suffix as above when a call site doesn't override
    // it (V7's contacts-list visual test intentionally doesn't, to stay
    // collision-safe across the desktop/mobile-web projects running it in
    // parallel). Matched by attribute prefix, not a fixed id, since each
    // seeded contact's id is generated server-side.
    tryResolve(page, [{ type: 'css', value: '[data-testid^="contact-email-"]' }], {
      intent: 'contacts list row email cells (randomized per E2E fixture run)',
    }),
  ]);
  return candidates.filter((c): c is SafeLocator => c !== null);
}

// ---------------------------------------------------------------------------
// Dashboard-specific locator helpers
// ---------------------------------------------------------------------------

/** Asserts the recent activity feed section is visible on the dashboard, with an optional timeout (ms). */
export async function expectRecentActivityFeedVisible(
  context: LayoutBehaviorContext,
  timeout?: number,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const locator = await context.page
    .locate(
      [
        { type: 'testId', value: 'recent-activity-feed' },
        { type: 'role', value: 'region', options: { name: /recent activity/i } },
      ],
      { intent: 'recent activity feed section on the dashboard page' },
    )
    .resolve();
  await expect(locator).toBeVisible(timeout !== undefined ? { timeout } : undefined);
}

/** Asserts a stat card by key is visible on the dashboard, with an optional timeout (ms). */
export async function expectDashboardStatCardVisible(
  statKey: string,
  context: LayoutBehaviorContext,
  timeout?: number,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const locator = await context.page
    .locate(
      [
        { type: 'testId', value: `stat-${statKey}` },
        { type: 'css', value: `[data-testid="stat-${statKey}"]` },
      ],
      { intent: `${statKey} stat card on the dashboard` },
    )
    .resolve();
  await expect(locator).toBeVisible(timeout !== undefined ? { timeout } : undefined);
}

/** Returns the text content of a stat card's value element by key. */
export async function getDashboardStatCardValue(
  statKey: string,
  context: LayoutBehaviorContext,
): Promise<string | null> {
  const locator = await context.page
    .locate(
      [
        { type: 'testId', value: `stat-${statKey}-value` },
        { type: 'css', value: `[data-testid="stat-${statKey}-value"]` },
      ],
      { intent: `numeric value inside the ${statKey} stat card` },
    )
    .resolve();
  return locator.textContent();
}

/**
 * Returns true when the recent-activity entry for the given ID is visible on the dashboard.
 * eslint-disable-next-line local/require-locator-fallback -- dynamic UUID-keyed; no stable role fallback
 */
export async function isRecentActivityEntryVisible(
  activityId: string,
  context: LayoutBehaviorContext,
): Promise<boolean> {
  // eslint-disable-next-line local/require-locator-fallback -- dynamic UUID-keyed activity row has no stable role fallback
  const locator = await context.page
    .locate([{ type: 'testId', value: `recent-activity-${activityId}` }])
    .resolve();
  return locator.isVisible().catch(() => false);
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
