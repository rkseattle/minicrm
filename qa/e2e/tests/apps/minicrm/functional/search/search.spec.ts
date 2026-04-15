/**
 * F9 — Global Search
 *
 * Functional regression tests for global cross-entity search — result
 * relevance, entity coverage, empty states, and result link correctness.
 *
 * Test groups:
 *   Result Coverage  — contact, account, and deal results returned by name
 *   Result Accuracy  — only matching records returned, case-insensitive, partial match
 *   Empty State      — explicit no-results message shown (no spinner / blank)
 *   Result Nav       — clicking result links navigates to the correct detail page
 *   Edge Cases       — short queries, special characters, very long query
 *
 * Framework conventions (MINCRM-42):
 *   - All tests tagged @functional and @search
 *   - Import test/expect from @apps/minicrm/fixtures.js only
 *   - No raw locators or Page Object calls — direct data-testid selectors only
 *   - All test data seeded via restClient + TestDataManager (UUID-suffixed names)
 *   - Result counts verified against restClient API queries (AC2)
 *   - Tests pass with --workers=4 (no shared mutable state)
 *
 * UI testids used (GlobalSearch.tsx, MINCRM-168):
 *   global-search-input        — the search input (NavHeader for all layouts on desktop and
 *                                left/hamburger mobile; NavTop mobile drawer for NavTop mobile)
 *   search-results-panel       — the results dropdown
 *   search-min-length-hint     — shown when query < 2 chars
 *   search-empty-state         — shown when query >= 2 chars and no results
 *   search-result-contact-{id} — individual contact result link
 *   search-result-account-{id} — individual account result link
 *   search-result-deal-{id}    — individual deal result link
 *
 * Notes:
 *   GlobalSearch debounces the query before firing — after typing we wait
 *   for the results panel or relevant sub-element to become visible rather
 *   than using fixed timeouts.
 *   The dropdown only renders when open && query.trim().length > 0. Typing
 *   into the input sets open=true automatically.
 *
 * MINCRM-145
 */

import type { Locator, Page } from '@playwright/test';
import { test, expect } from '@apps/minicrm/fixtures.js';
import { createTestContact, createTestAccount, createTestDeal } from '@apps/minicrm/helpers.js';
import { RestClientError } from '@framework/clients/rest-client.js';

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const ADMIN_EMAIL = process.env['E2E_ADMIN_EMAIL'] ?? 'admin@example.com';
const ADMIN_PASSWORD = process.env['E2E_ADMIN_PASSWORD'];
if (!ADMIN_PASSWORD) throw new Error('[F9-search] E2E_ADMIN_PASSWORD is not set');

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

interface SearchApiResponse {
  contacts: Array<{ id: string; first_name: string; last_name: string; email: string }>;
  accounts: Array<{ id: string; name: string }>;
  deals: Array<{ id: string; name: string; stage: string }>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns the actionable GlobalSearch input.
 *
 * NavLeft and NavHamburger always render the search input visibly in the
 * persistent header. NavTop on desktop also renders it visibly. Only
 * NavTop on mobile hides it behind `hidden lg:block` — in that case the
 * input lives inside the mobile drawer (`#mobile-nav-drawer`) and the
 * drawer must be opened first.
 *
 * Detection: check whether the header input is already visible. If not,
 * open the NavTop mobile drawer and return the input scoped to it.
 *
 * @param page - Playwright Page.
 * @returns A Locator for the visible search input.
 */
async function openSearchInput(page: Page): Promise<Locator> {
  const headerInput = page.getByTestId('global-search-input').first();
  const isHeaderInputVisible = await headerInput.isVisible().catch(() => false);

  if (!isHeaderInputVisible) {
    // NavTop mobile: the header input is hidden (hidden lg:block wrapper).
    // Open the mobile drawer which contains its own search input instance.
    const drawer = page.locator('#mobile-nav-drawer');
    const drawerVisible = await drawer.isVisible().catch(() => false);
    if (!drawerVisible) {
      await page.getByTestId('nav-menu-toggle').click();
      await drawer.waitFor({ state: 'visible', timeout: 5_000 });
    }
    const input = drawer.getByTestId('global-search-input');
    await input.waitFor({ state: 'visible', timeout: 5_000 });
    return input;
  }

  return headerInput;
}

/**
 * Types a query into the global search input and waits for the results panel
 * to appear. The GlobalSearch component debounces the query, so we wait for
 * the panel to become visible rather than relying on a fixed timeout.
 *
 * @param page - Playwright Page.
 * @param query - The string to type into the search input.
 * @param timeout - Maximum ms to wait for the panel to appear.
 */
async function typeSearchQuery(page: Page, query: string, timeout = 10_000): Promise<void> {
  const input = await openSearchInput(page);
  await input.click();
  await input.fill(query);

  // Wait for the dropdown to appear before returning.
  // The panel may legitimately be absent for below-threshold queries (e.g. F9-EC1).
  // Callers that require results must assert visibility separately.
  await page
    .getByTestId('search-results-panel')
    .waitFor({ state: 'visible', timeout })
    .catch(() => null);
}

// ---------------------------------------------------------------------------
// Result Coverage tests
// ---------------------------------------------------------------------------

test('@functional @search F9-RC1: search by contact name returns matching contact result', async ({
  page,
  restClient,
  testData,
}) => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  await restClient.post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

  const contact = await createTestContact(testData, restClient, {
    first_name: 'F9RC1',
    last_name: `ContactSearch-${suffix}`,
  });

  await page.goto('/', { waitUntil: 'networkidle' });

  // Type enough characters to trigger a search (min 2) using the unique last name.
  await typeSearchQuery(page, `ContactSearch-${suffix}`);

  // The contact result link must be present.
  const resultLink = page.getByTestId(`search-result-contact-${contact.id}`);
  await expect(resultLink, 'contact result should appear in search dropdown').toBeVisible({
    timeout: 10_000,
  });

  // AC2: verify API returns the same record.
  const apiResult = await restClient.get<SearchApiResponse>(
    `/api/search?q=${encodeURIComponent(`ContactSearch-${suffix}`)}`,
  );
  expect(
    apiResult.body.contacts.some((c) => c.id === contact.id),
    'API should also return the matching contact',
  ).toBe(true);
});

test('@functional @search F9-RC2: search by account name returns matching account result', async ({
  page,
  restClient,
  testData,
}) => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  await restClient.post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

  const account = await createTestAccount(testData, restClient, {
    name: `F9RC2 AccountSearch-${suffix}`,
  });

  await page.goto('/', { waitUntil: 'networkidle' });

  await typeSearchQuery(page, `AccountSearch-${suffix}`);

  const resultLink = page.getByTestId(`search-result-account-${account.id}`);
  await expect(resultLink, 'account result should appear in search dropdown').toBeVisible({
    timeout: 10_000,
  });

  // AC2: API cross-check.
  const apiResult = await restClient.get<SearchApiResponse>(
    `/api/search?q=${encodeURIComponent(`AccountSearch-${suffix}`)}`,
  );
  expect(
    apiResult.body.accounts.some((a) => a.id === account.id),
    'API should also return the matching account',
  ).toBe(true);
});

test('@functional @search F9-RC3: search by deal name returns matching deal result', async ({
  page,
  restClient,
  testData,
}) => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  await restClient.post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

  const account = await createTestAccount(testData, restClient, {
    name: `F9RC3 Account ${suffix}`,
  });
  const deal = await createTestDeal(testData, restClient, {
    name: `F9RC3 DealSearch-${suffix}`,
    account_id: account.id,
  });

  await page.goto('/', { waitUntil: 'networkidle' });

  await typeSearchQuery(page, `DealSearch-${suffix}`);

  const resultLink = page.getByTestId(`search-result-deal-${deal.id}`);
  await expect(resultLink, 'deal result should appear in search dropdown').toBeVisible({
    timeout: 10_000,
  });

  // AC2: API cross-check.
  const apiResult = await restClient.get<SearchApiResponse>(
    `/api/search?q=${encodeURIComponent(`DealSearch-${suffix}`)}`,
  );
  expect(
    apiResult.body.deals.some((d) => d.id === deal.id),
    'API should also return the matching deal',
  ).toBe(true);
});

test('@functional @search F9-RC4: query matching across entity types shows results from all matching types', async ({
  page,
  restClient,
  testData,
}) => {
  // Use a shared prefix that will be part of the contact name, account name, and deal name.
  const prefix = `F9RC4Cross-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  await restClient.post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

  const contact = await createTestContact(testData, restClient, {
    first_name: prefix,
    last_name: 'Contact',
  });
  const account = await createTestAccount(testData, restClient, {
    name: `${prefix} Account`,
  });
  const deal = await createTestDeal(testData, restClient, {
    name: `${prefix} Deal`,
    account_id: account.id,
  });

  await page.goto('/', { waitUntil: 'networkidle' });

  await typeSearchQuery(page, prefix);

  // All three entity results should appear.
  await expect(
    page.getByTestId(`search-result-contact-${contact.id}`),
    'cross-type search should include contact result',
  ).toBeVisible({ timeout: 10_000 });
  await expect(
    page.getByTestId(`search-result-account-${account.id}`),
    'cross-type search should include account result',
  ).toBeVisible({ timeout: 10_000 });
  await expect(
    page.getByTestId(`search-result-deal-${deal.id}`),
    'cross-type search should include deal result',
  ).toBeVisible({ timeout: 10_000 });
});

// ---------------------------------------------------------------------------
// Result Accuracy tests
// ---------------------------------------------------------------------------

test('@functional @search F9-RA1: unrelated records are not returned in results', async ({
  page,
  restClient,
  testData,
}) => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  await restClient.post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

  // Create a contact with a very unique name that the search term will NOT match.
  const unrelated = await createTestContact(testData, restClient, {
    first_name: 'Unrelated',
    last_name: `Xyzzy-${suffix}`,
  });

  await page.goto('/', { waitUntil: 'networkidle' });

  // Search for a term that should only match a different set of records.
  await typeSearchQuery(page, `F9RA1-no-match-${suffix}`);

  // The panel may show empty state, or have no results — either way the
  // unrelated contact should NOT appear.
  const unrelatedResult = page.getByTestId(`search-result-contact-${unrelated.id}`);
  await expect(
    unrelatedResult,
    'unrelated contact must not appear in results for non-matching query',
  ).not.toBeVisible();

  // API confirms the term returns nothing for contacts.
  const apiResult = await restClient.get<SearchApiResponse>(
    `/api/search?q=${encodeURIComponent(`F9RA1-no-match-${suffix}`)}`,
  );
  expect(
    apiResult.body.contacts.some((c) => c.id === unrelated.id),
    'API must not return the unrelated contact',
  ).toBe(false);
});

test('@functional @search F9-RA2: search is case-insensitive', async ({
  page,
  restClient,
  testData,
}) => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  await restClient.post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

  // Create the contact with a mixed-case last name.
  const contact = await createTestContact(testData, restClient, {
    first_name: 'F9RA2',
    last_name: `CaseSensitive-${suffix}`,
  });

  await page.goto('/', { waitUntil: 'networkidle' });

  // Search using UPPERCASE variant.
  await typeSearchQuery(page, `CASESENSITIVE-${suffix}`.toUpperCase());

  const resultLink = page.getByTestId(`search-result-contact-${contact.id}`);
  await expect(resultLink, 'uppercase query should still return the contact').toBeVisible({
    timeout: 10_000,
  });

  // API cross-check with uppercase term.
  const apiResult = await restClient.get<SearchApiResponse>(
    `/api/search?q=${encodeURIComponent(`CASESENSITIVE-${suffix}`.toUpperCase())}`,
  );
  expect(
    apiResult.body.contacts.some((c) => c.id === contact.id),
    'API should return the contact for uppercase query (case-insensitive)',
  ).toBe(true);
});

test('@functional @search F9-RA3: partial-word match returns relevant results', async ({
  page,
  restClient,
  testData,
}) => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  await restClient.post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

  // Account name contains a unique suffix — search for just the suffix portion
  // to verify partial-word matching while still isolating from other test runs.
  const account = await createTestAccount(testData, restClient, {
    name: `F9RA3Corp-${suffix}`,
  });

  await page.goto('/', { waitUntil: 'networkidle' });

  // Search for the unique suffix only (not the full name) to exercise partial matching.
  await typeSearchQuery(page, suffix);

  const resultLink = page.getByTestId(`search-result-account-${account.id}`);
  await expect(resultLink, 'partial suffix search should return the matching account').toBeVisible({
    timeout: 10_000,
  });

  // AC2: API also returns the record.
  const apiResult = await restClient.get<SearchApiResponse>(
    `/api/search?q=${encodeURIComponent(suffix)}`,
  );
  expect(
    apiResult.body.accounts.some((a) => a.id === account.id),
    'API should return the matching account for partial query',
  ).toBe(true);
});

test('@functional @search F9-RA4: exact-match search returns the correct record prominently', async ({
  page,
  restClient,
  testData,
}) => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  await restClient.post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

  const contact = await createTestContact(testData, restClient, {
    first_name: 'F9RA4Exact',
    last_name: `ExactMatch-${suffix}`,
  });

  await page.goto('/', { waitUntil: 'networkidle' });

  // Use the full last name as the exact search term.
  await typeSearchQuery(page, `ExactMatch-${suffix}`);

  const resultLink = page.getByTestId(`search-result-contact-${contact.id}`);
  await expect(resultLink, 'exact-match contact should appear in results').toBeVisible({
    timeout: 10_000,
  });

  // AC2: API returns at least 1 contact match and the seeded contact is included.
  const apiResult = await restClient.get<SearchApiResponse>(
    `/api/search?q=${encodeURIComponent(`ExactMatch-${suffix}`)}`,
  );
  expect(
    apiResult.body.contacts.length,
    'API should return at least 1 contact for exact match',
  ).toBeGreaterThanOrEqual(1);
  expect(
    apiResult.body.contacts.some((c) => c.id === contact.id),
    'API result should include the exact contact',
  ).toBe(true);
});

// ---------------------------------------------------------------------------
// Empty State tests
// ---------------------------------------------------------------------------

test('@functional @search F9-ES1: query with no matching records shows explicit empty state message', async ({
  page,
  restClient,
  testData,
}) => {
  await restClient.post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

  await page.goto('/', { waitUntil: 'networkidle' });

  // A term that extremely unlikely matches any real record.
  await typeSearchQuery(page, 'zzzF9ES1NoMatchXyzzy99999');

  const panel = page.getByTestId('search-results-panel');
  await expect(panel).toBeVisible({ timeout: 10_000 });

  // The empty-state message must be present.
  const emptyState = page.getByTestId('search-empty-state');
  await expect(emptyState, 'empty state message must be visible for no results').toBeVisible({
    timeout: 10_000,
  });

  // Must NOT show a spinner — no role="progressbar" or aria-busy elements.
  const spinner = panel.locator('[role="progressbar"], [aria-busy="true"]');
  await expect(spinner, 'spinner must not be shown in empty state').not.toBeVisible();

  void testData;
});

test('@functional @search F9-ES2: empty state is not a blank area — it contains text', async ({
  page,
  restClient,
  testData,
}) => {
  await restClient.post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

  await page.goto('/', { waitUntil: 'networkidle' });

  await typeSearchQuery(page, 'zzzF9ES2NothingHereAtAll');

  const emptyState = page.getByTestId('search-empty-state');
  await expect(emptyState).toBeVisible({ timeout: 10_000 });

  // The element must have non-empty text content.
  const text = await emptyState.textContent();
  expect(text?.trim().length ?? 0, 'empty state element must contain text').toBeGreaterThan(0);

  void testData;
});

// ---------------------------------------------------------------------------
// Result Navigation tests
// ---------------------------------------------------------------------------

test('@functional @search F9-RN1: clicking a contact result navigates to the correct contact detail view', async ({
  page,
  restClient,
  testData,
}) => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  await restClient.post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

  const contact = await createTestContact(testData, restClient, {
    first_name: 'F9RN1',
    last_name: `NavContact-${suffix}`,
  });

  await page.goto('/', { waitUntil: 'networkidle' });

  await typeSearchQuery(page, `NavContact-${suffix}`);

  const resultLink = page.getByTestId(`search-result-contact-${contact.id}`);
  await expect(resultLink).toBeVisible({ timeout: 10_000 });
  await resultLink.click();

  // Wait for navigation to settle on the contact detail page.
  await page.waitForLoadState('networkidle');
  const finalPath = new URL(page.url()).pathname;
  expect(finalPath, 'clicking contact result should navigate to /contacts/:id').toBe(
    `/contacts/${contact.id}`,
  );
});

test('@functional @search F9-RN2: clicking an account result navigates to the correct account detail view', async ({
  page,
  restClient,
  testData,
}) => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  await restClient.post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

  const account = await createTestAccount(testData, restClient, {
    name: `F9RN2 NavAccount-${suffix}`,
  });

  await page.goto('/', { waitUntil: 'networkidle' });

  await typeSearchQuery(page, `NavAccount-${suffix}`);

  const resultLink = page.getByTestId(`search-result-account-${account.id}`);
  await expect(resultLink).toBeVisible({ timeout: 10_000 });
  await resultLink.click();

  await page.waitForLoadState('networkidle');
  const finalPath = new URL(page.url()).pathname;
  expect(finalPath, 'clicking account result should navigate to /accounts/:id').toBe(
    `/accounts/${account.id}`,
  );
});

test('@functional @search F9-RN3: clicking a deal result navigates to the correct deal detail view', async ({
  page,
  restClient,
  testData,
}) => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  await restClient.post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

  const account = await createTestAccount(testData, restClient, {
    name: `F9RN3 Account ${suffix}`,
  });
  const deal = await createTestDeal(testData, restClient, {
    name: `F9RN3 NavDeal-${suffix}`,
    account_id: account.id,
  });

  await page.goto('/', { waitUntil: 'networkidle' });

  await typeSearchQuery(page, `NavDeal-${suffix}`);

  const resultLink = page.getByTestId(`search-result-deal-${deal.id}`);
  await expect(resultLink).toBeVisible({ timeout: 10_000 });
  await resultLink.click();

  await page.waitForLoadState('networkidle');
  const finalPath = new URL(page.url()).pathname;
  expect(finalPath, 'clicking deal result should navigate to /deals/:id').toBe(`/deals/${deal.id}`);
});

test('@functional @search F9-RN4: browser back after clicking a result returns to the previous page', async ({
  page,
  restClient,
  testData,
}) => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  await restClient.post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

  const contact = await createTestContact(testData, restClient, {
    first_name: 'F9RN4',
    last_name: `BackNav-${suffix}`,
  });

  // Navigate to the contacts list page first so back leads somewhere meaningful.
  await page.goto('/contacts', { waitUntil: 'networkidle' });
  const priorPath = new URL(page.url()).pathname;

  // Search and click a result.
  await typeSearchQuery(page, `BackNav-${suffix}`);
  const resultLink = page.getByTestId(`search-result-contact-${contact.id}`);
  await expect(resultLink).toBeVisible({ timeout: 10_000 });
  await resultLink.click();
  await page.waitForLoadState('networkidle');

  // Confirm we navigated to the detail page.
  expect(new URL(page.url()).pathname, 'should have navigated to contact detail').toBe(
    `/contacts/${contact.id}`,
  );

  // Press browser back.
  await page.goBack({ waitUntil: 'networkidle' });
  const backPath = new URL(page.url()).pathname;
  expect(backPath, 'browser back should return to the prior page').toBe(priorPath);
});

// ---------------------------------------------------------------------------
// Edge Case tests
// ---------------------------------------------------------------------------

test('@functional @search F9-EC1: single-character query shows minimum-length hint, no error', async ({
  page,
  restClient,
  testData,
}) => {
  await restClient.post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

  await page.goto('/', { waitUntil: 'networkidle' });

  // Type a single character — below the 2-char minimum.
  const input = await openSearchInput(page);
  await input.click();
  await input.fill('a');

  // The panel renders immediately for any non-empty query (open=true after typing).
  const panel = page.getByTestId('search-results-panel');
  await expect(panel).toBeVisible({ timeout: 5_000 });

  // The min-length hint must be shown instead of results or an error.
  const hint = page.getByTestId('search-min-length-hint');
  await expect(hint, 'minimum-length hint should appear for 1-char query').toBeVisible();

  // There must be no error alert or 500-level indication.
  const errorAlert = page.getByRole('alert');
  await expect(errorAlert, 'no error alert should appear for short query').not.toBeVisible();

  void testData;
});

test('@functional @search F9-EC2: two-character query is accepted — results or empty state shown, no error', async ({
  page,
  restClient,
  testData,
}) => {
  await restClient.post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

  await page.goto('/', { waitUntil: 'networkidle' });

  // Two characters is at the minimum threshold — should be accepted and trigger a search.
  await typeSearchQuery(page, 'zq');

  const panel = page.getByTestId('search-results-panel');
  await expect(panel).toBeVisible({ timeout: 10_000 });

  // Must NOT show the min-length hint (since 2 chars meets the minimum).
  const hint = page.getByTestId('search-min-length-hint');
  await expect(hint, 'min-length hint must not appear for 2-char query').not.toBeVisible();

  // No error alert.
  const errorAlert = page.getByRole('alert');
  await expect(errorAlert, 'no error alert should appear for 2-char query').not.toBeVisible();

  void testData;
});

test('@functional @search F9-EC3: query with special characters is handled gracefully', async ({
  page,
  restClient,
  testData,
}) => {
  await restClient.post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

  await page.goto('/', { waitUntil: 'networkidle' });

  // Special-character queries that have historically caused issues.
  const specialQueries = ["O'Brien", 'Smith & Co'];

  // Get the actionable input once (drawer is opened on first call and stays open).
  const searchInput = await openSearchInput(page);

  for (const query of specialQueries) {
    await searchInput.click();
    await searchInput.fill('');
    await searchInput.fill(query);

    // Wait briefly for the panel to appear or settle.
    await page
      .getByTestId('search-results-panel')
      .waitFor({ state: 'visible', timeout: 10_000 })
      .catch(() => null);

    // No error alert should appear.
    const errorAlert = page.getByRole('alert');
    await expect(
      errorAlert,
      `no error alert should appear for special-char query "${query}"`,
    ).not.toBeVisible();

    // Also verify via API — must not return a 500 (4xx is acceptable for validation).
    try {
      const apiResult = await restClient.get<SearchApiResponse>(
        `/api/search?q=${encodeURIComponent(query)}`,
      );
      expect(apiResult.status, `API must not 500 for special-char query "${query}"`).toBeLessThan(
        500,
      );
    } catch (err: unknown) {
      if (err instanceof RestClientError) {
        expect(err.status, `API must not 500 for special-char query "${query}"`).toBeLessThan(500);
      } else {
        throw err;
      }
    }
  }

  void testData;
});

test('@functional @search F9-EC4: very long query string is handled gracefully', async ({
  page,
  restClient,
  testData,
}) => {
  await restClient.post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

  await page.goto('/', { waitUntil: 'networkidle' });

  // 500-character query — well beyond any realistic search term.
  const longQuery = 'a'.repeat(500);
  const input = await openSearchInput(page);
  await input.click();
  await input.fill(longQuery);

  // Wait for panel to settle.
  await page
    .getByTestId('search-results-panel')
    .waitFor({ state: 'visible', timeout: 10_000 })
    .catch(() => null);

  // No error alert.
  const errorAlert = page.getByRole('alert');
  await expect(errorAlert, 'no error alert for very long query').not.toBeVisible();

  // API must also handle gracefully (4xx is fine — 500 is not).
  try {
    const apiResult = await restClient.get<SearchApiResponse>(
      `/api/search?q=${encodeURIComponent(longQuery)}`,
    );
    expect(apiResult.status, 'API must not 500 for very long query').toBeLessThan(500);
  } catch (err: unknown) {
    if (err instanceof RestClientError) {
      expect(err.status, 'API must not 500 for very long query').toBeLessThan(500);
    } else {
      throw err;
    }
  }

  void testData;
});
