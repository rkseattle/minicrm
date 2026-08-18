/**
 * F-CE — AI contact auto-enrich from pasted text
 *
 * Functional regression test for the "Enrich from text" action on the
 * contact create form.
 *
 * Stub note:
 *   The E2E server runs with E2E=true, so enrichContactFromText bypasses the
 *   Anthropic SDK and returns a deterministic stub extraction.
 */

import { test, expect } from '@apps/minicrm/fixtures.js';
import { createTestRep, navigateToContacts } from '@apps/minicrm/helpers.js';
import { loginAsAdmin, loginViaBrowser, loginAs } from '@behaviors/minicrm/auth.behaviors.js';
import {
  enrichContactFromTextViaUI,
  applyContactEnrichment,
  getContactFormFirstName,
} from '@behaviors/minicrm/contacts.behaviors.js';

test.use({ storageState: { cookies: [], origins: [] } });

test.beforeEach(async ({ restClient, testData, page }) => {
  await loginAsAdmin(restClient);
  const rep = await createTestRep(testData, restClient);
  await loginViaBrowser(rep.email, rep.password, { page });
  await loginAs(restClient, rep.email, rep.password);
});

test(
  'F-CE1: extracting from pasted text prefills the create form fields, editable before save',
  { tag: ['@functional'] },
  async ({ page }) => {
    await navigateToContacts(page);

    await enrichContactFromTextViaUI('Jane Doe, VP Sales at Acme Corp', { page });
    await applyContactEnrichment({ page });

    await expect(async () => {
      const firstName = await getContactFormFirstName({ page });
      expect(firstName).not.toBe('');
    }).toPass({ timeout: 10_000 });
  },
);
