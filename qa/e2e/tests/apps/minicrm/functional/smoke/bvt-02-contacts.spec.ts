/**
 * BVT-02 — Contact Lifecycle
 *
 * Smoke-tests the contact lifecycle:
 *   1. Create contact via API
 *   2. Navigate to contacts list → contact appears
 *   3. Edit contact → changes are reflected
 *   4. Teardown via TestDataManager (surgical — pre-existing count unchanged)
 *
 * Tagged @bvt @smoke @functional — runs in the merged functional suite.
 * Can still be targeted in isolation: npx playwright test --grep @bvt
 *
 * MINCRM-110, MINCRM-193
 */

import { test, expect } from '@apps/minicrm/fixtures.js';
import { login } from '@behaviors/minicrm/auth.behaviors.js';
import { navigateToContacts, editContact } from '@behaviors/minicrm/contacts.behaviors.js';
import { createTestContact } from '@apps/minicrm/helpers.js';

const ADMIN_EMAIL = process.env['E2E_ADMIN_EMAIL'] ?? 'admin@example.com';
const ADMIN_PASSWORD = process.env['E2E_ADMIN_PASSWORD'];
if (!ADMIN_PASSWORD) throw new Error('[BVT-02] E2E_ADMIN_PASSWORD is not set');

interface ContactListResponse {
  data: unknown[];
  total: number;
}

test('@bvt @smoke @functional BVT-02: contact lifecycle — create, list, edit, teardown', async ({
  page,
  healPage,
  restClient,
  testData,
}) => {
  const testName = test.info().title;

  // ── Setup: authenticate REST client ──────────────────────────────────────
  await restClient.post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

  // Capture pre-existing count for teardown assertion (AC6).
  const before = await restClient.get<ContactListResponse>('/api/contacts');
  const countBefore = before.body.total;

  // Create the test contact via API and register for teardown immediately.
  const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const contact = await createTestContact(testData, restClient, {
    first_name: 'BVT2',
    last_name: `Contact-${uniqueSuffix}`,
  });

  // ── Login ─────────────────────────────────────────────────────────────────
  await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }, { page, healPage, testName });

  // ── 1. Navigate to contacts list → contact appears ────────────────────────
  const navResult = await navigateToContacts({ page, healPage, testName });

  expect(navResult.loaded, 'contacts page should load').toBe(true);
  expect(navResult.finalUrl).toContain('/contacts');

  // Verify the contact is queryable by unique last name.
  const search = await restClient.get<ContactListResponse>(
    `/api/contacts?search=${encodeURIComponent(contact.last_name)}`,
  );
  expect(search.body.total, 'created contact should be findable').toBe(1);

  // ── 2. Edit contact → changes are reflected ───────────────────────────────
  const updatedLastName = `Edited-${uniqueSuffix}`;
  const editResult = await editContact(
    contact.id,
    { last_name: updatedLastName },
    { page, healPage, testName },
  );

  expect(editResult.saved, 'contact edit should save successfully').toBe(true);

  // Confirm change persisted via API.
  const updated = await restClient.get<ContactListResponse>(
    `/api/contacts?search=${encodeURIComponent(updatedLastName)}`,
  );
  expect(updated.body.total, 'edited name should be searchable').toBe(1);

  // ── Teardown + count assertion (AC6) ─────────────────────────────────────
  const teardownResults = await testData.teardown(restClient);
  expect(teardownResults.filter((r) => !r.success)).toHaveLength(0);

  const after = await restClient.get<ContactListResponse>('/api/contacts');
  expect(after.body.total, 'contact count should return to baseline').toBe(countBefore);
});
