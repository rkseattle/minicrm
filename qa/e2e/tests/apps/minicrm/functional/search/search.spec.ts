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
 *   - All UI interactions via behaviors — no raw locators in this file
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
 * MINCRM-145, MINCRM-192
 */

import { test, expect } from '@apps/minicrm/fixtures.js';
import { createTestContact, createTestAccount, createTestDeal } from '@apps/minicrm/helpers.js';
import { RestClientError } from '@framework/clients/rest-client.js';
import {
  typeSearchQuery,
  getSearchResult,
  clickSearchResult,
  getSearchEmptyState,
  getMinLengthHint,
  checkNoResultsForQuery,
  typeSearchQueryAndCheckPanel,
} from '@behaviors/minicrm/index.js';

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
// Result Coverage tests
// ---------------------------------------------------------------------------

test('@functional @search F9-RC1: search by contact name returns matching contact result', async ({
  page,
  healPage,
  restClient,
  testData,
}) => {
  const testName = test.info().title;
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  await restClient.post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

  const contact = await createTestContact(testData, restClient, {
    first_name: 'F9RC1',
    last_name: `ContactSearch-${suffix}`,
  });

  await page.goto('/', { waitUntil: 'networkidle' });

  const result = await getSearchResult(`ContactSearch-${suffix}`, 'contact', contact.id, {
    page,
    healPage,
    testName,
  });
  expect(result.visible, 'contact result should appear in search dropdown').toBe(true);

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
  healPage,
  restClient,
  testData,
}) => {
  const testName = test.info().title;
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  await restClient.post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

  const account = await createTestAccount(testData, restClient, {
    name: `F9RC2 AccountSearch-${suffix}`,
  });

  await page.goto('/', { waitUntil: 'networkidle' });

  const result = await getSearchResult(`AccountSearch-${suffix}`, 'account', account.id, {
    page,
    healPage,
    testName,
  });
  expect(result.visible, 'account result should appear in search dropdown').toBe(true);

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
  healPage,
  restClient,
  testData,
}) => {
  const testName = test.info().title;
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

  const result = await getSearchResult(`DealSearch-${suffix}`, 'deal', deal.id, {
    page,
    healPage,
    testName,
  });
  expect(result.visible, 'deal result should appear in search dropdown').toBe(true);

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
  healPage,
  restClient,
  testData,
}) => {
  const testName = test.info().title;
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

  // Type the query once then check all three result links.
  await typeSearchQuery(prefix, { page, healPage, testName });

  const contactResult = await getSearchResult(prefix, 'contact', contact.id, {
    page,
    healPage,
    testName,
  });
  expect(contactResult.visible, 'cross-type search should include contact result').toBe(true);

  const accountResult = await getSearchResult(prefix, 'account', account.id, {
    page,
    healPage,
    testName,
  });
  expect(accountResult.visible, 'cross-type search should include account result').toBe(true);

  const dealResult = await getSearchResult(prefix, 'deal', deal.id, { page, healPage, testName });
  expect(dealResult.visible, 'cross-type search should include deal result').toBe(true);
});

// ---------------------------------------------------------------------------
// Result Accuracy tests
// ---------------------------------------------------------------------------

test('@functional @search F9-RA1: unrelated records are not returned in results', async ({
  page,
  healPage,
  restClient,
  testData,
}) => {
  const testName = test.info().title;
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  await restClient.post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

  // Create a contact with a very unique name that the search term will NOT match.
  const unrelated = await createTestContact(testData, restClient, {
    first_name: 'Unrelated',
    last_name: `Xyzzy-${suffix}`,
  });

  await page.goto('/', { waitUntil: 'networkidle' });

  // Search for a term that should only match a different set of records.
  const result = await checkNoResultsForQuery(`F9RA1-no-match-${suffix}`, 'contact', unrelated.id, {
    page,
    healPage,
    testName,
  });
  expect(
    result.entityNotVisible,
    'unrelated contact must not appear in results for non-matching query',
  ).toBe(true);

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
  healPage,
  restClient,
  testData,
}) => {
  const testName = test.info().title;
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  await restClient.post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

  // Create the contact with a mixed-case last name.
  const contact = await createTestContact(testData, restClient, {
    first_name: 'F9RA2',
    last_name: `CaseSensitive-${suffix}`,
  });

  await page.goto('/', { waitUntil: 'networkidle' });

  // Search using UPPERCASE variant.
  const uppercaseQuery = `CASESENSITIVE-${suffix}`.toUpperCase();
  const result = await getSearchResult(uppercaseQuery, 'contact', contact.id, {
    page,
    healPage,
    testName,
  });
  expect(result.visible, 'uppercase query should still return the contact').toBe(true);

  // API cross-check with uppercase term.
  const apiResult = await restClient.get<SearchApiResponse>(
    `/api/search?q=${encodeURIComponent(uppercaseQuery)}`,
  );
  expect(
    apiResult.body.contacts.some((c) => c.id === contact.id),
    'API should return the contact for uppercase query (case-insensitive)',
  ).toBe(true);
});

test('@functional @search F9-RA3: partial-word match returns relevant results', async ({
  page,
  healPage,
  restClient,
  testData,
}) => {
  const testName = test.info().title;
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  await restClient.post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

  // Account name contains a unique suffix — search for just the suffix portion
  // to verify partial-word matching while still isolating from other test runs.
  const account = await createTestAccount(testData, restClient, {
    name: `F9RA3Corp-${suffix}`,
  });

  await page.goto('/', { waitUntil: 'networkidle' });

  // Search for the unique suffix only (not the full name) to exercise partial matching.
  const result = await getSearchResult(suffix, 'account', account.id, { page, healPage, testName });
  expect(result.visible, 'partial suffix search should return the matching account').toBe(true);

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
  healPage,
  restClient,
  testData,
}) => {
  const testName = test.info().title;
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  await restClient.post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

  const contact = await createTestContact(testData, restClient, {
    first_name: 'F9RA4Exact',
    last_name: `ExactMatch-${suffix}`,
  });

  await page.goto('/', { waitUntil: 'networkidle' });

  // Use the full last name as the exact search term.
  const result = await getSearchResult(`ExactMatch-${suffix}`, 'contact', contact.id, {
    page,
    healPage,
    testName,
  });
  expect(result.visible, 'exact-match contact should appear in results').toBe(true);

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
  healPage,
  restClient,
  testData,
}) => {
  const testName = test.info().title;
  await restClient.post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

  await page.goto('/', { waitUntil: 'networkidle' });

  // A term that extremely unlikely matches any real record.
  const result = await getSearchEmptyState('zzzF9ES1NoMatchXyzzy99999', {
    page,
    healPage,
    testName,
  });

  expect(result.panelVisible, 'results panel must be visible').toBe(true);
  expect(result.emptyStateVisible, 'empty state message must be visible for no results').toBe(true);
  expect(result.noSpinner, 'spinner must not be shown in empty state').toBe(true);

  void testData;
});

test('@functional @search F9-ES2: empty state is not a blank area — it contains text', async ({
  page,
  healPage,
  restClient,
  testData,
}) => {
  const testName = test.info().title;
  await restClient.post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

  await page.goto('/', { waitUntil: 'networkidle' });

  const result = await getSearchEmptyState('zzzF9ES2NothingHereAtAll', {
    page,
    healPage,
    testName,
  });

  expect(result.emptyStateVisible, 'empty state element must be visible').toBe(true);
  expect(
    result.emptyStateText?.trim().length ?? 0,
    'empty state element must contain text',
  ).toBeGreaterThan(0);

  void testData;
});

// ---------------------------------------------------------------------------
// Result Navigation tests
// ---------------------------------------------------------------------------

test('@functional @search F9-RN1: clicking a contact result navigates to the correct contact detail view', async ({
  page,
  healPage,
  restClient,
  testData,
}) => {
  const testName = test.info().title;
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  await restClient.post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

  const contact = await createTestContact(testData, restClient, {
    first_name: 'F9RN1',
    last_name: `NavContact-${suffix}`,
  });

  await page.goto('/', { waitUntil: 'networkidle' });

  const result = await clickSearchResult(`NavContact-${suffix}`, 'contact', contact.id, {
    page,
    healPage,
    testName,
  });
  const finalPath = new URL(result.finalUrl).pathname;
  expect(finalPath, 'clicking contact result should navigate to /contacts/:id').toBe(
    `/contacts/${contact.id}`,
  );
});

test('@functional @search F9-RN2: clicking an account result navigates to the correct account detail view', async ({
  page,
  healPage,
  restClient,
  testData,
}) => {
  const testName = test.info().title;
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  await restClient.post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

  const account = await createTestAccount(testData, restClient, {
    name: `F9RN2 NavAccount-${suffix}`,
  });

  await page.goto('/', { waitUntil: 'networkidle' });

  const result = await clickSearchResult(`NavAccount-${suffix}`, 'account', account.id, {
    page,
    healPage,
    testName,
  });
  const finalPath = new URL(result.finalUrl).pathname;
  expect(finalPath, 'clicking account result should navigate to /accounts/:id').toBe(
    `/accounts/${account.id}`,
  );
});

test('@functional @search F9-RN3: clicking a deal result navigates to the correct deal detail view', async ({
  page,
  healPage,
  restClient,
  testData,
}) => {
  const testName = test.info().title;
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

  const result = await clickSearchResult(`NavDeal-${suffix}`, 'deal', deal.id, {
    page,
    healPage,
    testName,
  });
  const finalPath = new URL(result.finalUrl).pathname;
  expect(finalPath, 'clicking deal result should navigate to /deals/:id').toBe(`/deals/${deal.id}`);
});

test('@functional @search F9-RN4: browser back after clicking a result returns to the previous page', async ({
  page,
  healPage,
  restClient,
  testData,
}) => {
  const testName = test.info().title;
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
  const navResult = await clickSearchResult(`BackNav-${suffix}`, 'contact', contact.id, {
    page,
    healPage,
    testName,
  });
  expect(new URL(navResult.finalUrl).pathname, 'should have navigated to contact detail').toBe(
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
  healPage,
  restClient,
  testData,
}) => {
  const testName = test.info().title;
  await restClient.post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

  await page.goto('/', { waitUntil: 'networkidle' });

  // Type a single character — below the 2-char minimum.
  const result = await getMinLengthHint('a', { page, healPage, testName });

  expect(result.panelVisible, 'results panel should appear for any non-empty query').toBe(true);
  expect(result.hintVisible, 'minimum-length hint should appear for 1-char query').toBe(true);
  expect(result.noErrorAlert, 'no error alert should appear for short query').toBe(true);

  void testData;
});

test('@functional @search F9-EC2: two-character query is accepted — results or empty state shown, no error', async ({
  page,
  healPage,
  restClient,
  testData,
}) => {
  const testName = test.info().title;
  await restClient.post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

  await page.goto('/', { waitUntil: 'networkidle' });

  // Two characters is at the minimum threshold — should be accepted and trigger a search.
  const result = await typeSearchQueryAndCheckPanel('zq', { page, healPage, testName });

  expect(result.panelVisible, 'results panel should be visible for 2-char query').toBe(true);
  expect(result.noMinLengthHint, 'min-length hint must not appear for 2-char query').toBe(true);
  expect(result.noErrorAlert, 'no error alert should appear for 2-char query').toBe(true);

  void testData;
});

test('@functional @search F9-EC3: query with special characters is handled gracefully', async ({
  page,
  healPage,
  restClient,
  testData,
}) => {
  const testName = test.info().title;
  await restClient.post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

  await page.goto('/', { waitUntil: 'networkidle' });

  // Special-character queries that have historically caused issues.
  const specialQueries = ["O'Brien", 'Smith & Co'];

  for (const query of specialQueries) {
    const panelResult = await typeSearchQueryAndCheckPanel(query, { page, healPage, testName });
    expect(
      panelResult.noErrorAlert,
      `no error alert should appear for special-char query "${query}"`,
    ).toBe(true);

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
  healPage,
  restClient,
  testData,
}) => {
  const testName = test.info().title;
  await restClient.post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

  await page.goto('/', { waitUntil: 'networkidle' });

  // 500-character query — well beyond any realistic search term.
  const longQuery = 'a'.repeat(500);
  const result = await typeSearchQueryAndCheckPanel(longQuery, { page, healPage, testName });
  expect(result.noErrorAlert, 'no error alert for very long query').toBe(true);

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
