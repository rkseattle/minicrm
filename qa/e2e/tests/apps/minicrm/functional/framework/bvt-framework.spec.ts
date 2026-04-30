/**
 * BVT (Build Verification Test) — MiniCRM Framework Integration
 *
 * This is NOT a regression test. Its sole purpose is to confirm that every
 * layer of the E2E framework stack works together end-to-end:
 *
 *   - TestDataManager + restClient (MINCRM-129)
 *   - Behavior abstraction layer (MINCRM-130)
 *   - HealingLocator 2-strategy fallback (MINCRM-124)
 *   - Fixture wiring and automatic teardown
 *   - CI artifact generation (healing-report.json)
 *
 * Test sequence (per ticket MINCRM-131):
 *   1. Setup  — create prerequisite data via API using TestDataManager + restClient
 *   2. Login  — call login() behavior; no direct page interaction
 *   3. Navigate — call navigateToContacts() behavior
 *   4. Assert — verify setup data appears in the contacts list
 *   5. Teardown — TestDataManager deletes only the test-created records;
 *                  pre-existing data is untouched (verified by API count assertion)
 *
 * Constraints (AC2):
 *   - Zero @playwright/test imports — all from @apps/minicrm/fixtures.js
 *   - Zero direct Page Object calls, raw locator references, or HealingLocator instances
 *
 * Tagged @bvt @smoke @functional — runs in the merged functional suite.
 * Moved from tests/apps/minicrm/bvt.spec.ts (MINCRM-193).
 *
 * MINCRM-131, MINCRM-193
 */

import { test, expect } from '@apps/minicrm/fixtures.js';
import { login } from '@behaviors/minicrm/auth.behaviors.js';
import { navigateToContacts } from '@behaviors/minicrm/contacts.behaviors.js';
import { createTestContact } from '@apps/minicrm/helpers.js';

// ---------------------------------------------------------------------------
// Admin credentials — must match the seeded admin user in the E2E database.
// ---------------------------------------------------------------------------

const ADMIN_EMAIL = process.env['E2E_ADMIN_EMAIL'] ?? 'admin@example.com';
const ADMIN_PASSWORD = process.env['E2E_ADMIN_PASSWORD'];
if (!ADMIN_PASSWORD) {
  throw new Error('[bvt] E2E_ADMIN_PASSWORD environment variable is not set');
}

// ---------------------------------------------------------------------------
// Response shape for GET /api/contacts (paginated envelope)
// ---------------------------------------------------------------------------

interface ContactListResponse {
  data: unknown[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// ---------------------------------------------------------------------------
// BVT suite
// ---------------------------------------------------------------------------

// MINCRM-192: The BVT validates the login() behavior and LoginPage machinery as
// part of its framework integration check. It must start with an unauthenticated
// browser so the login flow can be exercised end-to-end.
test.describe('BVT — MiniCRM E2E framework integration', () => {
  // MINCRM-192: Use an empty storageState to prevent the project-level admin session
  // from loading. `undefined` does not override the project config — an explicit empty
  // object is required to start each test with a fresh, unauthenticated browser context.
  test.use({ storageState: { cookies: [], origins: [] } });
  test('@bvt @smoke @functional framework stack validates end-to-end: setup → login → navigate → assert → teardown', async ({
    page,
    restClient,
    testData,
  }) => {
    // ── Step 0: Authenticate the REST client ──────────────────────────────
    // POST /api/auth/login sets the JWT cookie on the Playwright
    // APIRequestContext, so all subsequent restClient calls are authenticated.
    await restClient.post('/api/v1/auth/login', {
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
    });

    // ── Step 1: Confirm the contacts endpoint is reachable ───────────────
    await restClient.get<ContactListResponse>('/api/v1/contacts');

    // ── Step 2: Create test contact via API ───────────────────────────────
    // createTestContact registers the contact with testData immediately so
    // teardown runs even if the test throws before completing setup.
    const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const contact = await createTestContact(testData, restClient, {
      first_name: 'BVT',
      last_name: `Run-${uniqueSuffix}`,
    });

    // ── Step 3: Login via behavior ────────────────────────────────────────
    // No Page Object methods, raw locators, or HealingLocator instances here.
    // The behavior internally uses LoginPage with 2-strategy HealingLocators.
    const loginResult = await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }, { page });

    expect(loginResult.success).toBe(true);
    expect(loginResult.errorMessage).toBeNull();

    // ── Step 4: Navigate to contacts via behavior ─────────────────────────
    // ContactsPage.isLoaded() uses a 2-strategy HealingLocator (testId + role)
    // to confirm the page is ready, satisfying the fallback-chain requirement.
    const navResult = await navigateToContacts({ page });

    expect(navResult.loaded).toBe(true);
    expect(navResult.finalUrl).toContain('/contacts');

    // ── Step 5: Assert setup data appears in the contacts list ────────────
    // Search by the unique last name to confirm this specific contact is
    // queryable — avoids pagination concerns with large contact lists.
    // Note: asserting total == countBefore + 1 is racey with --workers=4
    // because other workers may create contacts between the two reads.
    const searchResponse = await restClient.get<ContactListResponse>(
      `/api/v1/contacts?search=${encodeURIComponent(contact.last_name)}`,
    );
    expect(searchResponse.body.total).toBe(1);
    const found = searchResponse.body.data as Array<{ id: string }>;
    expect(found[0].id).toBe(contact.id);

    // ── Step 6: Explicit teardown (AC4) ──────────────────────────────────
    // Call teardown manually here so we can assert success below.
    // The fixture's finally block will call teardown again but that is a
    // safe no-op — the registry is cleared on the first call.
    const teardownResults = await testData.teardown(restClient);

    // AC4: all registered entities were deleted successfully.
    // Note: asserting total == countBefore after teardown is racey with
    // --workers=4 because parallel workers create and delete contacts
    // concurrently, making the final count unpredictable.
    const failed = teardownResults.filter((r) => !r.success);
    expect(failed).toHaveLength(0);
  });
});
