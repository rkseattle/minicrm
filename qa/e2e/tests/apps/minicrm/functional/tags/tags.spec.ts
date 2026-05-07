/**
 * F8-TG — Tags / label system (MINCRM-186)
 *
 * Functional E2E coverage for the global tag management and entity-level
 * tag attachment workflows.
 *
 * Tests are structured as:
 *   Admin tag management — navigate, rename, delete (admin-only operations)
 *   Entity tagging       — attach/detach a tag on a contact via the TagInput widget
 *   Cross-entity         — tag persists on a deal via API verification
 *
 * Framework conventions (MINCRM-42):
 *   - All UI interactions go through behaviors → Page Objects → HealingLocator
 *   - No raw locators in this file
 *   - Test data managed via createTestTag / createTestContact helpers (auto-teardown)
 *   - Import test/expect from @apps/minicrm/fixtures.js only
 *
 * MINCRM-186
 */

import { test, expect } from '@apps/minicrm/fixtures.js';
import {
  createTestTag,
  createTestContact,
  createTestAccount,
  createTestDeal,
} from '@apps/minicrm/helpers.js';
import {
  navigateToAdminTags,
  renameTagViaUI,
  deleteTagViaUI,
  attachTagViaUI,
  detachTagViaUI,
} from '@behaviors/minicrm/index.js';
import { AdminTagsPage } from '@pages/minicrm/AdminTagsPage.js';

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const ADMIN_EMAIL = process.env['E2E_ADMIN_EMAIL'] ?? 'admin@example.com';
const ADMIN_PASSWORD = process.env['E2E_ADMIN_PASSWORD'];
if (!ADMIN_PASSWORD) throw new Error('[F8-TG] E2E_ADMIN_PASSWORD is not set');

// ---------------------------------------------------------------------------
// Response types for API verification
// ---------------------------------------------------------------------------

interface TagSingleResponse {
  tag: {
    id: string;
    name: string;
  };
}

interface ContactTagsResponse {
  tags: Array<{ id: string; name: string }>;
}

interface DealTagsResponse {
  tags: Array<{ id: string; name: string }>;
}

// ---------------------------------------------------------------------------
// F8-TG1 — Admin tags page loads
// ---------------------------------------------------------------------------

test(
  'F8-TG1: admin tags page loads with heading visible',
  { tag: ['@functional', '@smoke'] },
  async ({ page, testData, restClient }) => {
    void testData;

    await restClient.post('/api/v1/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

    const result = await navigateToAdminTags({ page });

    expect(result.loaded).toBe(true);
    expect(result.finalUrl).toContain('/admin/tags');
  },
);

// ---------------------------------------------------------------------------
// F8-TG1b — Pagination controls always visible on admin tags page (MINCRM-345)
// ---------------------------------------------------------------------------

test(
  'F8-TG1b: admin tags page — pagination controls always visible',
  { tag: ['@functional'] },
  async ({ page, testData, restClient }) => {
    void testData;

    await restClient.post('/api/v1/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

    await navigateToAdminTags({ page });

    const adminTagsPage = new AdminTagsPage({ page });
    const pagination = await adminTagsPage.paginationLocator();
    await expect(pagination!).toBeVisible({ timeout: 10_000 });
  },
);

// ---------------------------------------------------------------------------
// F8-TG2 — Admin can rename a tag and the new name is persisted
// ---------------------------------------------------------------------------

test(
  'F8-TG2: admin renames a tag via UI and new name is persisted via API',
  { tag: ['@functional', '@smoke'] },
  async ({ page, testData, restClient }) => {
    await restClient.post('/api/v1/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

    const tag = await createTestTag(testData, restClient, { name: `tg2-original-${Date.now()}` });

    const navResult = await navigateToAdminTags({ page });
    expect(navResult.loaded).toBe(true);

    const newName = `tg2-renamed-${Date.now()}`;
    const renameResult = await renameTagViaUI(tag.id, newName, { page });
    expect(renameResult.saved).toBe(true);

    // Verify via API that the name was persisted server-side.
    const fetched = await restClient.get<TagSingleResponse>(`/api/v1/tags/${tag.id}`);
    expect(fetched.body.tag.name).toBe(newName);
  },
);

// ---------------------------------------------------------------------------
// F8-TG3 — Admin can delete a tag and it no longer exists
// ---------------------------------------------------------------------------

test(
  'F8-TG3: admin deletes a tag via UI and tag is removed from API',
  { tag: ['@functional', '@smoke'] },
  async ({ page, testData, restClient }) => {
    await restClient.post('/api/v1/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

    // Create the tag but unregister it from TestDataManager after we delete it
    // in the test — otherwise teardown will attempt a DELETE on an already-gone
    // resource and log a spurious error.
    const tag = await createTestTag(testData, restClient, { name: `tg3-delete-${Date.now()}` });

    const navResult = await navigateToAdminTags({ page });
    expect(navResult.loaded).toBe(true);

    const deleteResult = await deleteTagViaUI(tag.id, { page });
    expect(deleteResult.deleted).toBe(true);

    // The row disappeared from the UI; verify the API also returns 404.
    const fetched = await restClient
      .get<TagSingleResponse>(`/api/v1/tags/${tag.id}`)
      .catch((err: { status?: number }) => err);
    expect((fetched as { status?: number }).status).toBe(404);
  },
);

// ---------------------------------------------------------------------------
// F8-TG4 — Attach a tag to a contact via TagInput widget; badge appears
// ---------------------------------------------------------------------------

test(
  'F8-TG4: tag attached to a contact via TagInput widget badge appears and API confirms',
  { tag: ['@functional', '@smoke'] },
  async ({ page, testData, restClient }) => {
    await restClient.post('/api/v1/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

    const tag = await createTestTag(testData, restClient, { name: `tg4-attach-${Date.now()}` });
    const contact = await createTestContact(testData, restClient, {
      first_name: 'TG4',
      last_name: 'Contact',
    });

    // Navigate to the contact detail page (assumes the app uses /contacts/:id).
    await page.goto(`/contacts/${contact.id}`);
    await page.waitForLoadState('networkidle');

    const attachResult = await attachTagViaUI(contact.id, tag.id, tag.name, { page });
    expect(attachResult.badgeVisible).toBe(true);

    // Verify via API that the tag is recorded on the contact.
    const fetched = await restClient.get<ContactTagsResponse>(
      `/api/v1/contacts/${contact.id}/tags`,
    );
    const tagIds = fetched.body.tags.map((t) => t.id);
    expect(tagIds).toContain(tag.id);
  },
);

// ---------------------------------------------------------------------------
// F8-TG5 — Detach a tag from a contact; badge disappears and API confirms
// ---------------------------------------------------------------------------

test(
  'F8-TG5: tag detached from a contact via TagInput remove button disappears from UI and API',
  { tag: ['@functional'] },
  async ({ page, testData, restClient }) => {
    await restClient.post('/api/v1/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

    const tag = await createTestTag(testData, restClient, { name: `tg5-detach-${Date.now()}` });
    const contact = await createTestContact(testData, restClient, {
      first_name: 'TG5',
      last_name: 'Contact',
    });

    // Attach via API so the badge is visible when we load the page.
    await restClient.post(`/api/v1/contacts/${contact.id}/tags`, { name: tag.name });

    await page.goto(`/contacts/${contact.id}`);
    await page.waitForLoadState('networkidle');

    const detachResult = await detachTagViaUI(contact.id, tag.id, { page });
    expect(detachResult.badgeGone).toBe(true);

    // Verify via API that the tag is no longer on the contact.
    const fetched = await restClient.get<ContactTagsResponse>(
      `/api/v1/contacts/${contact.id}/tags`,
    );
    const tagIds = fetched.body.tags.map((t) => t.id);
    expect(tagIds).not.toContain(tag.id);
  },
);

// ---------------------------------------------------------------------------
// F8-TG6 — Tag persists on a deal (cross-entity coverage)
// ---------------------------------------------------------------------------

test(
  'F8-TG6: tag attached to a deal via TagInput widget persists via API',
  { tag: ['@functional'] },
  async ({ page, testData, restClient }) => {
    await restClient.post('/api/v1/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

    const tag = await createTestTag(testData, restClient, { name: `tg6-deal-${Date.now()}` });
    const account = await createTestAccount(testData, restClient, {
      name: `TG6 Account ${Date.now()}`,
    });
    const deal = await createTestDeal(testData, restClient, {
      name: `TG6 Deal ${Date.now()}`,
      stage: 'Prospecting',
      account_id: account.id,
    });

    // Navigate to the deal detail page.
    await page.goto(`/deals/${deal.id}`);
    await page.waitForLoadState('networkidle');

    const attachResult = await attachTagViaUI(deal.id, tag.id, tag.name, { page });
    expect(attachResult.badgeVisible).toBe(true);

    // Verify via API that the tag is recorded on the deal.
    const fetched = await restClient.get<DealTagsResponse>(`/api/v1/deals/${deal.id}/tags`);
    const tagIds = fetched.body.tags.map((t) => t.id);
    expect(tagIds).toContain(tag.id);
  },
);
