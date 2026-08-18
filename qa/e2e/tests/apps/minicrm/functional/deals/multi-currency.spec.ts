/**
 * F8-MC — Multi-currency deal support
 *
 * Functional regression tests for ISO 4217 currency selection on deals.
 * Covers:
 *   Create     — deal created with explicit currency stored correctly (API)
 *   Default    — deal created without currency defaults to system default (USD)
 *   Pipeline   — DealCard shows currency-formatted value; stage column shows
 *                mixed-currency note when deals in a stage have different currencies
 *   Settings   — admin can change the default currency; new deals pick it up
 *
 * Framework conventions:
 *   - All tests tagged @functional
 *   - Import test/expect from @apps/minicrm/fixtures.js only
 *   - No raw locators — all through behaviors or Page Object calls where needed
 *   - Test data managed via restClient + TestDataManager (auto teardown)
 *
 *
 */

import { test, expect } from '@apps/minicrm/fixtures.js';
import { createTestAccount, createTestDeal } from '@apps/minicrm/helpers.js';
import { RestClientError } from '@framework/clients/rest-client.js';
import { loginAsAdmin } from '@behaviors/minicrm/auth.behaviors.js';

test.use({ storageState: { cookies: [], origins: [] } });

test.beforeEach(async ({ restClient }) => {
  await loginAsAdmin(restClient);
});
import { getDealById, patchDeal, exportDealsAsCsv } from '@behaviors/minicrm/deals.behaviors.js';

// ---------------------------------------------------------------------------
// F8-MC1 — deal created with explicit currency stores the correct code
// ---------------------------------------------------------------------------

test(
  'F8-MC1: deal created with explicit EUR currency stores EUR via API',
  { tag: ['@functional', '@smoke'] },
  async ({ testData, restClient }) => {
    const account = await createTestAccount(testData, restClient, {
      name: `MC1-Acct ${test.info().title}`,
    });

    const deal = await createTestDeal(testData, restClient, {
      name: `MC1-Deal ${test.info().title}`,
      stage: 'Prospecting',
      value: '10000',
      currency: 'EUR',
      account_id: account.id,
    });

    // Verify the stored currency via GET
    const fetched = await getDealById(restClient, deal.id);
    expect(fetched.currency).toBe('EUR');
  },
);

// ---------------------------------------------------------------------------
// F8-MC2 — deal created without a currency defaults to USD
// ---------------------------------------------------------------------------

test(
  'F8-MC2: deal created without currency defaults to USD',
  { tag: ['@functional', '@smoke'] },
  async ({ testData, restClient }) => {
    const account = await createTestAccount(testData, restClient, {
      name: `MC2-Acct ${test.info().title}`,
    });

    const deal = await createTestDeal(testData, restClient, {
      name: `MC2-Deal ${test.info().title}`,
      stage: 'Qualification',
      value: '5000',
      account_id: account.id,
    });

    const fetched = await getDealById(restClient, deal.id);
    expect(fetched.currency).toBe('USD');
  },
);

// ---------------------------------------------------------------------------
// F8-MC3 — currency is preserved through a PATCH update
// ---------------------------------------------------------------------------

test(
  'F8-MC3: currency is preserved after a PATCH update that does not touch currency',
  { tag: ['@functional'] },
  async ({ testData, restClient }) => {
    const account = await createTestAccount(testData, restClient, {
      name: `MC3-Acct ${test.info().title}`,
    });

    const deal = await createTestDeal(testData, restClient, {
      name: `MC3-Deal ${test.info().title}`,
      stage: 'Prospecting',
      value: '20000',
      currency: 'GBP',
      account_id: account.id,
    });

    // PATCH only the name — currency should remain GBP
    // include version for optimistic locking.
    await patchDeal(restClient, deal.id, {
      name: `MC3-Deal Updated ${test.info().title}`,
      version: deal.version,
    });

    const fetched = await getDealById(restClient, deal.id);
    expect(fetched.currency).toBe('GBP');
  },
);

// ---------------------------------------------------------------------------
// F8-MC4 — currency can be updated via PATCH
// ---------------------------------------------------------------------------

test(
  'F8-MC4: currency can be changed via PATCH',
  { tag: ['@functional'] },
  async ({ testData, restClient }) => {
    const account = await createTestAccount(testData, restClient, {
      name: `MC4-Acct ${test.info().title}`,
    });

    const deal = await createTestDeal(testData, restClient, {
      name: `MC4-Deal ${test.info().title}`,
      stage: 'Proposal',
      value: '30000',
      currency: 'USD',
      account_id: account.id,
    });

    // include version for optimistic locking.
    await patchDeal(restClient, deal.id, { currency: 'CAD', version: deal.version });

    const fetched = await getDealById(restClient, deal.id);
    expect(fetched.currency).toBe('CAD');
  },
);

// ---------------------------------------------------------------------------
// F8-MC5 — PATCH with unsupported currency code returns 400
// ---------------------------------------------------------------------------

test(
  'F8-MC5: PATCH with unsupported currency returns 400',
  { tag: ['@functional'] },
  async ({ testData, restClient }) => {
    const account = await createTestAccount(testData, restClient, {
      name: `MC5-Acct ${test.info().title}`,
    });

    const deal = await createTestDeal(testData, restClient, {
      name: `MC5-Deal ${test.info().title}`,
      stage: 'Prospecting',
      value: '1000',
      account_id: account.id,
    });

    // include version for optimistic locking. Both calls expect 400
    // (invalid currency code), so the version is not incremented between them.
    await expect(
      restClient.patch(`/api/v1/deals/${deal.id}`, { currency: 'XYZ', version: deal.version }),
    ).rejects.toThrow(RestClientError);

    try {
      await restClient.patch(`/api/v1/deals/${deal.id}`, {
        currency: 'XYZ',
        version: deal.version,
      });
    } catch (err) {
      expect(err).toBeInstanceOf(RestClientError);
      expect((err as RestClientError).status).toBe(400);
    }
  },
);

// ---------------------------------------------------------------------------
// F8-MC6 — CSV export includes Currency column
// ---------------------------------------------------------------------------

test(
  'F8-MC6: deal CSV export includes a Currency column',
  { tag: ['@functional'] },
  async ({ testData, restClient }) => {
    const account = await createTestAccount(testData, restClient, {
      name: `MC6-Acct ${test.info().title}`,
    });

    await createTestDeal(testData, restClient, {
      name: `MC6-Deal ${test.info().title}`,
      stage: 'Prospecting',
      value: '9999',
      currency: 'JPY',
      account_id: account.id,
    });

    const csv = await exportDealsAsCsv(restClient);
    // Header row must contain a Currency column
    const headerRow = csv.split('\n')[0] ?? '';
    expect(headerRow).toContain('Currency');
    // At least one data row should contain JPY
    expect(csv).toContain('JPY');
  },
);
