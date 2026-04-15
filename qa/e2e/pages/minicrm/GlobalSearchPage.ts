/**
 * GlobalSearchPage — Page Object for the MiniCRM global search widget.
 *
 * The global search input is embedded in the navigation header across all
 * layout variants. On NavTop mobile the input is hidden behind a drawer —
 * this Page Object handles that branching internally so behaviors and specs
 * never need to know about the layout.
 *
 * Every element uses a HealingLocator with at least 2 strategies.
 *
 * Page Objects interact with UI only — no business logic, no API calls,
 * no assertions.
 *
 * MINCRM-192
 */

import type { Locator } from '@playwright/test';
import type { SafePage } from '@framework/fixtures/index.js';
import type { HealPage } from '@framework/fixtures/heal-page.fixture.js';

// ---------------------------------------------------------------------------
// Fixture context
// ---------------------------------------------------------------------------

/** Subset of Playwright fixtures required by GlobalSearchPage. */
export interface GlobalSearchPageContext {
  page: SafePage;
  healPage: HealPage;
  /** Current test name, passed to HealingLocator.resolve() for heal audit records. */
  testName: string;
}

// ---------------------------------------------------------------------------
// GlobalSearchPage
// ---------------------------------------------------------------------------

/**
 * Page Object for the MiniCRM global search widget.
 *
 * Usage:
 * ```ts
 * const searchPage = new GlobalSearchPage({ page, healPage, testName });
 * await searchPage.typeQuery('Alice');
 * const visible = await searchPage.resultIsVisible('contact', contactId);
 * ```
 */
export class GlobalSearchPage {
  private readonly page: SafePage;
  private readonly healPage: HealPage;
  private readonly testName: string;

  /**
   * @param context - Playwright fixture context containing page, healPage, and testName.
   */
  constructor(context: GlobalSearchPageContext) {
    this.page = context.page;
    this.healPage = context.healPage;
    this.testName = context.testName;
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  /**
   * Returns the actionable global search input, opening the NavTop mobile drawer
   * first if the header input is hidden behind it.
   *
   * NavLeft and NavHamburger always render the input visibly. NavTop on desktop
   * also renders it visibly. Only NavTop on mobile hides it behind `hidden lg:block`.
   *
   * All element interactions go through HealingLocator. The drawer container is
   * never resolved as a locator — the toggle is clicked first, after which the
   * drawer input is resolved using a scoped CSS primary strategy that only
   * matches within #mobile-nav-drawer (which is now mounted and visible).
   */
  private async openInput(): Promise<Locator> {
    // Try to resolve the first visible global-search-input. On NavLeft /
    // NavHamburger / NavTop desktop this will succeed immediately.
    // The testId strategy matches all instances (including the hidden header
    // input on NavTop mobile), so we check isVisible() on the result.
    const anyInput = await this.healPage
      .locate([
        { type: 'testId', value: 'global-search-input' },
        { type: 'css', value: '[data-testid="global-search-input"]' },
      ])
      .resolve(this.testName);

    const isVisible = await anyInput
      .first()
      .isVisible()
      .catch(() => false);

    if (isVisible) {
      return anyInput.first();
    }

    // NavTop mobile: the header input is hidden behind `hidden lg:block`.
    // Before clicking the toggle, check whether the drawer is already open —
    // if a prior call in the same test already opened it, clicking the toggle
    // again would close it (it is a toggle, not an open-only button).
    //
    // Use `within: 'mobile-nav-drawer'` to scope both strategies to the drawer
    // container. This is safe to probe even when the drawer is closed — the
    // container is not mounted yet, so probeLocator times out and resolves to
    // false, falling through to the toggle-click path below.
    const drawerInputAlreadyVisible = await this.healPage
      .locate([
        { type: 'testId', value: 'global-search-input', within: 'mobile-nav-drawer' },
        { type: 'css', value: '[data-testid="global-search-input"]', within: 'mobile-nav-drawer' },
      ])
      .resolve(this.testName)
      .then((el) => el.isVisible().catch(() => false))
      .catch(() => false);

    if (drawerInputAlreadyVisible) {
      return this.healPage
        .locate([
          { type: 'testId', value: 'global-search-input', within: 'mobile-nav-drawer' },
          {
            type: 'css',
            value: '[data-testid="global-search-input"]',
            within: 'mobile-nav-drawer',
          },
        ])
        .resolve(this.testName);
    }

    // Drawer is not open — click the menu toggle to mount and reveal it,
    // then resolve the input scoped to the drawer via `within`.
    await this.healPage.click([
      { type: 'testId', value: 'nav-menu-toggle' },
      { type: 'role', value: 'button', options: { name: 'Menu', exact: false } },
    ]);

    return this.healPage
      .locate([
        { type: 'testId', value: 'global-search-input', within: 'mobile-nav-drawer' },
        { type: 'css', value: '[data-testid="global-search-input"]', within: 'mobile-nav-drawer' },
      ])
      .resolve(this.testName);
  }

  // ---------------------------------------------------------------------------
  // Interactions
  // ---------------------------------------------------------------------------

  /**
   * Types a search query into the global search input and waits for the results
   * panel to appear (or settle). Handles the NavTop mobile drawer automatically.
   *
   * The GlobalSearch component debounces the query before firing, so the method
   * waits for the panel to become visible rather than using a fixed timeout.
   *
   * @param query - The search query to type.
   * @param timeout - Maximum ms to wait for the results panel.
   */
  async typeQuery(query: string, timeout = 10_000): Promise<void> {
    const input = await this.openInput();
    await input.click();
    await input.fill(query);

    // Wait for the dropdown to appear before returning.
    // Callers that require specific results must assert visibility separately.
    // Use panelIsVisible() so the wait goes through HealingLocator, not raw page.*.
    await this.panelIsVisible(timeout);
  }

  /**
   * Fills the raw search input without waiting for the panel.
   * Used for edge cases (e.g. single-char queries that should NOT trigger the panel).
   *
   * @param query - The query string to type.
   */
  async typeQueryRaw(query: string): Promise<void> {
    const input = await this.openInput();
    await input.click();
    await input.fill(query);
  }

  /**
   * Clicks the search result link for the given entity type and ID.
   *
   * @param entity - Entity type: 'contact', 'account', or 'deal'.
   * @param id - Entity UUID.
   */
  async clickResult(entity: 'contact' | 'account' | 'deal', id: string): Promise<void> {
    await this.healPage.click([
      { type: 'testId', value: `search-result-${entity}-${id}` },
      { type: 'css', value: `[data-testid="search-result-${entity}-${id}"]` },
    ]);
  }

  // ---------------------------------------------------------------------------
  // State queries
  // ---------------------------------------------------------------------------

  /**
   * Returns true when the results panel is visible.
   *
   * @param timeout - Maximum ms to wait for visibility.
   */
  async panelIsVisible(timeout = 5_000): Promise<boolean> {
    try {
      const resolved = await this.healPage
        .locate([
          { type: 'testId', value: 'search-results-panel' },
          { type: 'css', value: '[data-testid="search-results-panel"]' },
        ])
        .resolve(this.testName);
      await resolved.waitFor({ state: 'visible', timeout });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Returns true when the result link for the given entity type and ID is visible.
   *
   * @param entity - Entity type: 'contact', 'account', or 'deal'.
   * @param id - Entity UUID.
   * @param timeout - Maximum ms to wait for visibility.
   */
  async resultIsVisible(
    entity: 'contact' | 'account' | 'deal',
    id: string,
    timeout = 10_000,
  ): Promise<boolean> {
    try {
      const resolved = await this.healPage
        .locate([
          { type: 'testId', value: `search-result-${entity}-${id}` },
          { type: 'css', value: `[data-testid="search-result-${entity}-${id}"]` },
        ])
        .resolve(this.testName);
      await resolved.waitFor({ state: 'visible', timeout });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Returns true when the empty-state message is visible.
   *
   * @param timeout - Maximum ms to wait for visibility.
   */
  async emptyStateIsVisible(timeout = 10_000): Promise<boolean> {
    try {
      const resolved = await this.healPage
        .locate([
          { type: 'testId', value: 'search-empty-state' },
          { type: 'css', value: '[data-testid="search-empty-state"]' },
        ])
        .resolve(this.testName);
      await resolved.waitFor({ state: 'visible', timeout });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Returns the text content of the empty-state element, or null if not visible.
   */
  async emptyStateText(): Promise<string | null> {
    try {
      const resolved = await this.healPage
        .locate([
          { type: 'testId', value: 'search-empty-state' },
          { type: 'css', value: '[data-testid="search-empty-state"]' },
        ])
        .resolve(this.testName);
      return resolved.textContent();
    } catch {
      return null;
    }
  }

  /**
   * Returns true when the minimum-length hint (< 2 chars) is visible.
   */
  async minLengthHintIsVisible(): Promise<boolean> {
    try {
      const resolved = await this.healPage
        .locate([
          { type: 'testId', value: 'search-min-length-hint' },
          { type: 'css', value: '[data-testid="search-min-length-hint"]' },
        ])
        .resolve(this.testName);
      return resolved.isVisible();
    } catch {
      return false;
    }
  }

  /**
   * Waits for the minimum-length hint to become hidden (i.e. the debounce has
   * fired and the component has settled for a query >= 2 chars).
   *
   * Resolves silently if the hint was never present or does not hide within
   * the timeout — callers check `minLengthHintIsVisible()` for the final state.
   *
   * @param timeout - Maximum ms to wait. Defaults to 5 000.
   */
  async waitForMinLengthHintHidden(timeout = 5_000): Promise<void> {
    try {
      const resolved = await this.healPage
        .locate([
          { type: 'testId', value: 'search-min-length-hint' },
          { type: 'css', value: '[data-testid="search-min-length-hint"]' },
        ])
        .resolve(this.testName);
      await resolved.waitFor({ state: 'hidden', timeout });
    } catch {
      // Element absent or timed out — treat as already hidden.
    }
  }

  /**
   * Returns true when there is no error alert visible on the page.
   */
  async noErrorAlertVisible(): Promise<boolean> {
    try {
      const resolved = await this.healPage
        .locate([
          { type: 'role', value: 'alert' },
          { type: 'css', value: '[role="alert"]' },
        ])
        .resolve(this.testName);
      return !(await resolved.isVisible().catch(() => false));
    } catch {
      // No alert element found — treat as no error visible.
      return true;
    }
  }

  /**
   * Returns true when no spinner (role=progressbar or aria-busy) is visible
   * inside the results panel.
   */
  async noSpinnerInPanel(): Promise<boolean> {
    try {
      const panel = await this.healPage
        .locate([
          { type: 'testId', value: 'search-results-panel' },
          { type: 'css', value: '[data-testid="search-results-panel"]' },
        ])
        .resolve(this.testName);
      const spinner = panel.locator('[role="progressbar"], [aria-busy="true"]');
      return !(await spinner.isVisible().catch(() => false));
    } catch {
      // Panel not found — no spinner possible.
      return true;
    }
  }
}
