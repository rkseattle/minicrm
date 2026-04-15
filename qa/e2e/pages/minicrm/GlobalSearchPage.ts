/**
 * GlobalSearchPage — Page Object for the MiniCRM global search widget.
 *
 * The global search input is embedded in the navigation header across all
 * layout variants. On NavTop mobile the input is hidden behind a drawer —
 * this Page Object handles that branching internally so behaviors and specs
 * never need to know about the layout.
 *
 * Every interactive element uses a HealingLocator with at least 2 strategies.
 * The mobile drawer container uses a raw page.locator() because it is
 * conditionally rendered and must be referenced before being opened.
 *
 * Page Objects interact with UI only — no business logic, no API calls,
 * no assertions.
 *
 * MINCRM-192
 */

import type { Page, Locator } from '@playwright/test';
import type { HealPage } from '@framework/fixtures/heal-page.fixture.js';

// ---------------------------------------------------------------------------
// Fixture context
// ---------------------------------------------------------------------------

/** Subset of Playwright fixtures required by GlobalSearchPage. */
export interface GlobalSearchPageContext {
  page: Page;
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
  private readonly page: Page;
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
   * The global-search-input is resolved via HealingLocator. The mobile drawer
   * container (#mobile-nav-drawer) uses a raw page.locator() reference because
   * it is conditionally rendered — only mounted when open — so HealingLocator
   * would throw StrategyExhaustedError before the toggle has been clicked.
   * The drawer is a structural scoping container, not an interactive element,
   * so raw locator usage is appropriate here.
   */
  private async openInput(): Promise<Locator> {
    // Resolve the header input through the healing framework.
    const headerInput = await this.healPage
      .locate([
        { type: 'testId', value: 'global-search-input' },
        { type: 'css', value: '[data-testid="global-search-input"]' },
      ])
      .resolve(this.testName);

    const isHeaderVisible = await headerInput
      .first()
      .isVisible()
      .catch(() => false);

    if (!isHeaderVisible) {
      // NavTop mobile: open the drawer which contains its own search input instance.
      // Use page.locator() for the drawer container — it is conditionally rendered
      // (only mounted when mobileMenuOpen is true), so HealingLocator.resolve()
      // would exhaust all strategies before the toggle has been clicked to open it.
      const drawer = this.page.locator('#mobile-nav-drawer');
      const drawerVisible = await drawer.isVisible().catch(() => false);
      if (!drawerVisible) {
        await this.healPage.click([
          { type: 'testId', value: 'nav-menu-toggle' },
          { type: 'role', value: 'button', options: { name: 'Menu', exact: false } },
        ]);
        await drawer.waitFor({ state: 'visible', timeout: 5_000 });
      }
      // Scope the input lookup to the drawer to avoid resolving to the header
      // input, which is hidden on mobile but still attached to the DOM.
      const drawerInput = drawer.getByTestId('global-search-input');
      await drawerInput.waitFor({ state: 'visible', timeout: 5_000 });
      return drawerInput;
    }

    return headerInput.first();
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
