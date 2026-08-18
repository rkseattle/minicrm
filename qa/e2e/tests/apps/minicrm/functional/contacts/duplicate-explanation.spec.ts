/**
 * F-DE — AI duplicate detection explanation
 *
 * Functional regression test for the "Explain" action on the contact
 * duplicate-email warning banner.
 *
 * Stub note:
 *   The E2E server runs with E2E=true, so explainDuplicateMatch bypasses the
 *   Anthropic SDK and returns a deterministic stub explanation.
 */

import { test, expect } from '@apps/minicrm/fixtures.js';
import { createTestContact, createTestRep } from '@apps/minicrm/helpers.js';
import { loginAsAdmin, loginViaBrowser, loginAs } from '@behaviors/minicrm/auth.behaviors.js';
import {
  createContactViaUI,
  explainContactDuplicate,
  getContactDuplicateExplanationText,
} from '@behaviors/minicrm/contacts.behaviors.js';

test.use({ storageState: { cookies: [], origins: [] } });

test.beforeEach(async ({ restClient, testData, page }) => {
  await loginAsAdmin(restClient);
  const rep = await createTestRep(testData, restClient);
  await loginViaBrowser(rep.email, rep.password, { page });
  await loginAs(restClient, rep.email, rep.password);
});

test(
  'F-DE1: clicking Explain on a duplicate-email warning shows an inline AI explanation',
  { tag: ['@functional'] },
  async ({ testData, restClient, page }) => {
    const existing = await createTestContact(testData, restClient, {
      first_name: 'DE1',
      last_name: `Existing ${Date.now()}`,
    });

    await createContactViaUI(
      { first_name: 'Duplicate', last_name: 'Attempt', email: existing.email },
      { page },
    );

    const result = await explainContactDuplicate({ page });
    expect(result.status).toBe(200);

    await expect(async () => {
      const text = await getContactDuplicateExplanationText({ page });
      expect(text.length).toBeGreaterThan(0);
    }).toPass({ timeout: 10_000 });
  },
);
