/**
 * Search behaviors for MiniCRM.
 *
 * Behaviors are named, reusable async functions that encapsulate multi-step
 * user journeys. They compose Page Objects internally — callers never touch
 * raw locators or Page Object methods directly.
 *
 * Behaviors do NOT contain assertions (no expect() calls). They return typed
 * result objects that test specs assert against.
 *
 * MINCRM-145, MINCRM-168, MINCRM-192
 */

import type { SafePage } from '@framework/fixtures/index.js';
import type { HealPage } from '@framework/fixtures/heal-page.fixture.js';
import { GlobalSearchPage } from '@pages/minicrm/GlobalSearchPage.js';

// ---------------------------------------------------------------------------
// Fixture context
// ---------------------------------------------------------------------------

/** Fixtures required by search behaviors. */
export interface SearchBehaviorContext {
  page: SafePage;
  healPage: HealPage;
  /** Current test name forwarded to Page Object constructors for heal audit records. */
  testName: string;
}

// ---------------------------------------------------------------------------
// typeSearchQuery()
// ---------------------------------------------------------------------------

/** Result returned by typeSearchQuery. */
export interface TypeSearchQueryResult {
  /** True when the results panel became visible after typing. */
  panelVisible: boolean;
}

/**
 * Types a search query into the global search input and waits for the results
 * panel to appear. Handles the NavTop mobile drawer automatically.
 *
 * @param query - The query string to type.
 * @param context - Playwright fixture context.
 * @param timeout - Maximum ms to wait for the results panel.
 * @returns TypeSearchQueryResult.
 */
export async function typeSearchQuery(
  query: string,
  context: SearchBehaviorContext,
  timeout = 10_000,
): Promise<TypeSearchQueryResult> {
  const searchPage = new GlobalSearchPage(context);
  await searchPage.typeQuery(query, timeout);
  const panelVisible = await searchPage.panelIsVisible();
  return { panelVisible };
}

// ---------------------------------------------------------------------------
// typeSearchQueryRaw()
// ---------------------------------------------------------------------------

/**
 * Fills the raw search input without waiting for the results panel.
 * Used for edge cases (e.g. single-char queries that should NOT trigger the panel).
 *
 * @param query - The query string to type.
 * @param context - Playwright fixture context.
 */
export async function typeSearchQueryRaw(
  query: string,
  context: SearchBehaviorContext,
): Promise<void> {
  const searchPage = new GlobalSearchPage(context);
  await searchPage.typeQueryRaw(query);
}

// ---------------------------------------------------------------------------
// getSearchResult()
// ---------------------------------------------------------------------------

/** Result returned by getSearchResult. */
export interface GetSearchResultResult {
  /** True when the result link for the entity is visible. */
  visible: boolean;
}

/**
 * Types a query and checks whether the result for the given entity is visible.
 *
 * @param query - The query string to type.
 * @param entity - Entity type: 'contact', 'account', or 'deal'.
 * @param id - Entity UUID.
 * @param context - Playwright fixture context.
 * @returns GetSearchResultResult.
 */
export async function getSearchResult(
  query: string,
  entity: 'contact' | 'account' | 'deal',
  id: string,
  context: SearchBehaviorContext,
): Promise<GetSearchResultResult> {
  const searchPage = new GlobalSearchPage(context);
  await searchPage.typeQuery(query);
  const visible = await searchPage.resultIsVisible(entity, id);
  return { visible };
}

// ---------------------------------------------------------------------------
// clickSearchResult()
// ---------------------------------------------------------------------------

/** Result returned by clickSearchResult. */
export interface ClickSearchResultResult {
  /** The URL the browser settled on after clicking the result. */
  finalUrl: string;
}

/**
 * Types a query, waits for the result for the given entity to appear, then clicks it.
 *
 * @param query - The query string to type.
 * @param entity - Entity type: 'contact', 'account', or 'deal'.
 * @param id - Entity UUID.
 * @param context - Playwright fixture context.
 * @returns ClickSearchResultResult.
 */
export async function clickSearchResult(
  query: string,
  entity: 'contact' | 'account' | 'deal',
  id: string,
  context: SearchBehaviorContext,
): Promise<ClickSearchResultResult> {
  const searchPage = new GlobalSearchPage(context);
  await searchPage.typeQuery(query);
  await searchPage.clickResult(entity, id);

  await context.page.waitForLoadState('networkidle');
  return { finalUrl: context.page.url() };
}

// ---------------------------------------------------------------------------
// getSearchEmptyState()
// ---------------------------------------------------------------------------

/** Result returned by getSearchEmptyState. */
export interface GetSearchEmptyStateResult {
  /** True when the results panel is visible. */
  panelVisible: boolean;
  /** True when the empty-state message is visible. */
  emptyStateVisible: boolean;
  /** The text content of the empty-state element, or null if not visible. */
  emptyStateText: string | null;
  /** True when no spinner is shown inside the results panel. */
  noSpinner: boolean;
  /** True when no error alert is visible on the page. */
  noErrorAlert: boolean;
}

/**
 * Types a query expected to yield no results and captures the empty state.
 *
 * @param query - The query string (should be unique/random to guarantee no results).
 * @param context - Playwright fixture context.
 * @returns GetSearchEmptyStateResult.
 */
export async function getSearchEmptyState(
  query: string,
  context: SearchBehaviorContext,
): Promise<GetSearchEmptyStateResult> {
  const searchPage = new GlobalSearchPage(context);
  await searchPage.typeQuery(query);

  const panelVisible = await searchPage.panelIsVisible();
  const emptyStateVisible = await searchPage.emptyStateIsVisible();
  const emptyStateText = await searchPage.emptyStateText();
  const noSpinner = await searchPage.noSpinnerInPanel();
  const noErrorAlert = await searchPage.noErrorAlertVisible();

  return { panelVisible, emptyStateVisible, emptyStateText, noSpinner, noErrorAlert };
}

// ---------------------------------------------------------------------------
// getMinLengthHint()
// ---------------------------------------------------------------------------

/** Result returned by getMinLengthHint. */
export interface GetMinLengthHintResult {
  /** True when the minimum-length hint is visible (< 2 chars query). */
  hintVisible: boolean;
  /** True when the results panel is visible. */
  panelVisible: boolean;
  /** True when no error alert is visible on the page. */
  noErrorAlert: boolean;
}

/**
 * Types a single character into the search input and checks for the
 * minimum-length hint.
 *
 * @param query - A single-character query string.
 * @param context - Playwright fixture context.
 * @returns GetMinLengthHintResult.
 */
export async function getMinLengthHint(
  query: string,
  context: SearchBehaviorContext,
): Promise<GetMinLengthHintResult> {
  const searchPage = new GlobalSearchPage(context);
  await searchPage.typeQueryRaw(query);

  // Wait briefly for the panel to appear (it renders immediately for any non-empty query).
  await context.healPage
    .locate([
      { type: 'testId', value: 'search-results-panel' },
      { type: 'css', value: '[data-testid="search-results-panel"]' },
    ])
    .resolve(context.testName)
    .then((el) => el.waitFor({ state: 'visible', timeout: 5_000 }))
    .catch(() => null);

  const panelVisible = await searchPage.panelIsVisible(5_000);
  const hintVisible = await searchPage.minLengthHintIsVisible();
  const noErrorAlert = await searchPage.noErrorAlertVisible();

  return { hintVisible, panelVisible, noErrorAlert };
}

// ---------------------------------------------------------------------------
// checkNoResultsForQuery()
// ---------------------------------------------------------------------------

/** Result returned by checkNoResultsForQuery. */
export interface CheckNoResultsForQueryResult {
  /** True when the specified entity result is NOT visible. */
  entityNotVisible: boolean;
  /** True when no error alert is visible. */
  noErrorAlert: boolean;
}

/**
 * Types a query and verifies that the specified entity result does NOT appear.
 *
 * @param query - The query string.
 * @param entity - Entity type to check absence of.
 * @param id - Entity UUID.
 * @param context - Playwright fixture context.
 * @returns CheckNoResultsForQueryResult.
 */
export async function checkNoResultsForQuery(
  query: string,
  entity: 'contact' | 'account' | 'deal',
  id: string,
  context: SearchBehaviorContext,
): Promise<CheckNoResultsForQueryResult> {
  const searchPage = new GlobalSearchPage(context);
  await searchPage.typeQuery(query);

  const visible = await searchPage.resultIsVisible(entity, id, 3_000);
  const noErrorAlert = await searchPage.noErrorAlertVisible();

  return { entityNotVisible: !visible, noErrorAlert };
}

// ---------------------------------------------------------------------------
// typeSearchQueryAndCheckPanel()
// ---------------------------------------------------------------------------

/** Result returned by typeSearchQueryAndCheckPanel. */
export interface TypeSearchQueryAndCheckPanelResult {
  /** True when the results panel is visible. */
  panelVisible: boolean;
  /** True when the minimum-length hint is NOT visible (query is above threshold). */
  noMinLengthHint: boolean;
  /** True when no error alert is visible. */
  noErrorAlert: boolean;
}

/**
 * Types a query and verifies that the results panel is visible without
 * the min-length hint or error alert.
 *
 * @param query - The query string (should be >= 2 chars).
 * @param context - Playwright fixture context.
 * @param panelTimeout - Maximum ms to wait for the results panel (default 10 000).
 * @returns TypeSearchQueryAndCheckPanelResult.
 */
export async function typeSearchQueryAndCheckPanel(
  query: string,
  context: SearchBehaviorContext,
  panelTimeout = 10_000,
): Promise<TypeSearchQueryAndCheckPanelResult> {
  const searchPage = new GlobalSearchPage(context);
  await searchPage.typeQuery(query, panelTimeout);

  const panelVisible = await searchPage.panelIsVisible(panelTimeout);

  // After the panel appears, the debounce may still be in-flight. Wait for the
  // min-length hint to disappear (it's absent for queries >= 2 chars once the
  // component settles), then snapshot the final state.
  await searchPage.waitForMinLengthHintHidden();

  const minLengthHintVisible = await searchPage.minLengthHintIsVisible();
  const noErrorAlert = await searchPage.noErrorAlertVisible();

  return { panelVisible, noMinLengthHint: !minLengthHintVisible, noErrorAlert };
}

/**
 * Clears the global search input and waits for the results panel to close.
 * Call between successive typeSearchQueryAndCheckPanel calls to ensure each
 * query starts from a clean panel state.
 *
 * @param context - Playwright fixture context.
 */
export async function clearSearchQuery(context: SearchBehaviorContext): Promise<void> {
  const searchPage = new GlobalSearchPage(context);
  await searchPage.clearQuery();
}
