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

import type { PageFacade } from '@framework/fixtures/index.js';

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
  // its clientHeight.
  const containerHeight = (await page.evaluate(
    `(() => {
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
    })()`,
  )) as number;

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
