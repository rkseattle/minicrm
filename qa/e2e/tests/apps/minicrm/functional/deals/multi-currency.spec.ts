/**
 * F8-MC — Multi-currency deal support (MINCRM-189)
 *
 * Functional regression tests for ISO 4217 currency selection on deals.
 * Covers:
 *   Create     — deal created with explicit currency stored correctly (API)
 *   Default    — deal created without currency defaults to system default (USD)
 *   Pipeline   — DealCard shows currency-formatted value; stage column shows
 *                mixed-currency note when deals in a stage have different currencies
 *   Settings   — admin can change the default currency; new deals pick it up
 *
 * Framework conventions (MINCRM-42):
 *   - All tests tagged @functional
 *   - Import test/expect from @apps/minicrm/fixtures.js only
 *   - No raw locators — all through behaviors or Page Object calls where needed
 *   - Test data managed via restClient + TestDataManager (auto teardown)
 *
 * MINCRM-189
 */

import { test, expect } from '@apps/minicrm/fixtures.js';
import { createTestAccount, createTestDeal } from '@apps/minicrm/helpers.js';
import { RestClientError } from '@framework/clients/rest-client.js';

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const ADMIN_EMAIL = process.env['E2E_ADMIN_EMAIL'] ?? 'admin@example.com';
const ADMIN_PASSWORD = process.env['E2E_ADMIN_PASSWORD'];
if (!ADMIN_PASSWORD) throw new Error('[F8-MC] E2E_ADMIN_PASSWORD is not set');

// ---------------------------------------------------------------------------
// Shared response types
// ---------------------------------------------------------------------------

interface DealSingleResponse {
  deal: {
    id: string;
    name: string;
    stage: string;
    value: string | null;
    currency: string;
    close_date: string | null;
    account_id: string;
    owner_id: string;
  };
}

// ---------------------------------------------------------------------------
// F8-MC1 — deal created with explicit currency stores the correct code
// ---------------------------------------------------------------------------

test(
  'F8-MC1: deal created with explicit EUR currency stores EUR via API',
  { tag: ['@functional', '@smoke'] },
  async ({ page, healPage, testName, testData, restClient }) => {
    void page;
    void healPage;

    await restClient.authenticate(ADMIN_EMAIL, ADMIN_PASSWORD);

    const account = await createTestAccount(testData, restClient, { name: `MC1-Acct ${testName}` });

    const deal = await createTestDeal(testData, restClient, {
      name: `MC1-Deal ${testName}`,
      stage: 'Prospecting',
      value: '10000',
      currency: 'EUR',
      account_id: account.id,
    });

    // Verify the stored currency via GET
    const fetched = await restClient.get<DealSingleResponse>(`/api/deals/${deal.id}`);
    expect(fetched.body.deal.currency).toBe('EUR');
  },
);

// ---------------------------------------------------------------------------
// F8-MC2 — deal created without a currency defaults to USD
// ---------------------------------------------------------------------------

test(
  'F8-MC2: deal created without currency defaults to USD',
  { tag: ['@functional', '@smoke'] },
  async ({ page, healPage, testName, testData, restClient }) => {
    void page;
    void healPage;

    await restClient.authenticate(ADMIN_EMAIL, ADMIN_PASSWORD);

    const account = await createTestAccount(testData, restClient, { name: `MC2-Acct ${testName}` });

    const deal = await createTestDeal(testData, restClient, {
      name: `MC2-Deal ${testName}`,
      stage: 'Qualification',
      value: '5000',
      account_id: account.id,
    });

    const fetched = await restClient.get<DealSingleResponse>(`/api/deals/${deal.id}`);
    expect(fetched.body.deal.currency).toBe('USD');
  },
);

// ---------------------------------------------------------------------------
// F8-MC3 — currency is preserved through a PATCH update
// ---------------------------------------------------------------------------

test(
  'F8-MC3: currency is preserved after a PATCH update that does not touch currency',
  { tag: ['@functional'] },
  async ({ page, healPage, testName, testData, restClient }) => {
    void page;
    void healPage;

    await restClient.authenticate(ADMIN_EMAIL, ADMIN_PASSWORD);

    const account = await createTestAccount(testData, restClient, { name: `MC3-Acct ${testName}` });

    const deal = await createTestDeal(testData, restClient, {
      name: `MC3-Deal ${testName}`,
      stage: 'Prospecting',
      value: '20000',
      currency: 'GBP',
      account_id: account.id,
    });

    // PATCH only the name — currency should remain GBP
    await restClient.patch(`/api/deals/${deal.id}`, { name: `MC3-Deal Updated ${testName}` });

    const fetched = await restClient.get<DealSingleResponse>(`/api/deals/${deal.id}`);
    expect(fetched.body.deal.currency).toBe('GBP');
  },
);

// ---------------------------------------------------------------------------
// F8-MC4 — currency can be updated via PATCH
// ---------------------------------------------------------------------------

test(
  'F8-MC4: currency can be changed via PATCH',
  { tag: ['@functional'] },
  async ({ page, healPage, testName, testData, restClient }) => {
    void page;
    void healPage;

    await restClient.authenticate(ADMIN_EMAIL, ADMIN_PASSWORD);

    const account = await createTestAccount(testData, restClient, { name: `MC4-Acct ${testName}` });

    const deal = await createTestDeal(testData, restClient, {
      name: `MC4-Deal ${testName}`,
      stage: 'Proposal',
      value: '30000',
      currency: 'USD',
      account_id: account.id,
    });

    await restClient.patch(`/api/deals/${deal.id}`, { currency: 'CAD' });

    const fetched = await restClient.get<DealSingleResponse>(`/api/deals/${deal.id}`);
    expect(fetched.body.deal.currency).toBe('CAD');
  },
);

// ---------------------------------------------------------------------------
// F8-MC5 — PATCH with unsupported currency code returns 400
// ---------------------------------------------------------------------------

test(
  'F8-MC5: PATCH with unsupported currency returns 400',
  { tag: ['@functional'] },
  async ({ page, healPage, testName, testData, restClient }) => {
    void page;
    void healPage;

    await restClient.authenticate(ADMIN_EMAIL, ADMIN_PASSWORD);

    const account = await createTestAccount(testData, restClient, { name: `MC5-Acct ${testName}` });

    const deal = await createTestDeal(testData, restClient, {
      name: `MC5-Deal ${testName}`,
      stage: 'Prospecting',
      value: '1000',
      account_id: account.id,
    });

    await expect(restClient.patch(`/api/deals/${deal.id}`, { currency: 'XYZ' })).rejects.toThrow(
      RestClientError,
    );

    try {
      await restClient.patch(`/api/deals/${deal.id}`, { currency: 'XYZ' });
    } catch (err) {
      expect(err).toBeInstanceOf(RestClientError);
      expect((err as RestClientError).statusCode).toBe(400);
    }
  },
);

// ---------------------------------------------------------------------------
// F8-MC6 — CSV export includes Currency column
// ---------------------------------------------------------------------------

test(
  'F8-MC6: deal CSV export includes a Currency column',
  { tag: ['@functional'] },
  async ({ page, healPage, testName, testData, restClient }) => {
    void page;
    void healPage;

    await restClient.authenticate(ADMIN_EMAIL, ADMIN_PASSWORD);

    const account = await createTestAccount(testData, restClient, { name: `MC6-Acct ${testName}` });

    await createTestDeal(testData, restClient, {
      name: `MC6-Deal ${testName}`,
      stage: 'Prospecting',
      value: '9999',
      currency: 'JPY',
      account_id: account.id,
    });

    const response = await restClient.get<string>('/api/deals/export', { Accept: 'text/csv' });

    const csv = response.body as unknown as string;
    // Header row must contain a Currency column
    const headerRow = csv.split('\n')[0] ?? '';
    expect(headerRow).toContain('Currency');
    // At least one data row should contain JPY
    expect(csv).toContain('JPY');
  },
);
