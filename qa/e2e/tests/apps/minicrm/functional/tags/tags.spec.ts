/**
 * F8-TG — Tags / label system
 *
 * Functional E2E coverage for the global tag management and entity-level
 * tag attachment workflows.
 *
 * Tests are structured as:
 *   Admin tag management — navigate, rename, delete (admin-only operations)
 *   Entity tagging       — attach/detach a tag on a contact via the TagInput widget
 *   Cross-entity         — tag persists on a deal via API verification
 *
 * Framework conventions:
 *   - All UI interactions go through behaviors → Page Objects → HealingLocator
 *   - No raw locators in this file
 *   - Test data managed via createTestTag / createTestContact helpers (auto-teardown)
 *   - Import test/expect from @apps/minicrm/fixtures.js only
 *
 *
 */

import { test, expect } from '@apps/minicrm/fixtures.js';
import {
  createTestTag,
  createTestContact,
  createTestAccount,
  createTestDeal,
  createTestAdmin,
  withFlags,
} from '@apps/minicrm/helpers.js';
import { loginAsAdmin, loginViaBrowser } from '@behaviors/minicrm/auth.behaviors.js';
import {
  navigateToAdminTags,
  renameTagViaUI,
  deleteTagViaUI,
  attachTagViaUI,
  detachTagViaUI,
  getTagById,
  getContactTags,
  attachTagToContact,
  getDealTags,
} from '@behaviors/minicrm/index.js';
import { expectAdminTagsPaginationVisible } from '@behaviors/minicrm/tags.behaviors.js';
import {
  navigateToContactDetailPage,
  navigateToDealDetailPage,
} from '@behaviors/minicrm/layout.behaviors.js';

test.use({ storageState: { cookies: [], origins: [] } });

// ---------------------------------------------------------------------------
// Local types for 4xx/5xx error-path assertions (exempt from behavior refactor)
// ---------------------------------------------------------------------------

/** Response shape for GET /api/v1/tags/:id — used only in the delete-then-404 assertion. */
interface TagSingleResponse {
  tag: {
    id: string;
    name: string;
  };
}

test.beforeEach(async ({ restClient, page }) => {
  await loginAsAdmin(restClient);
  await withFlags(page, { tags: true });
});

// ---------------------------------------------------------------------------
// F8-TG1 — Admin tags page loads
// ---------------------------------------------------------------------------

test(
  'F8-TG1: admin tags page loads with heading visible',
  { tag: ['@functional', '@smoke'] },
  async ({ page, testData, restClient }) => {
    void testData;

    const admin = await createTestAdmin(testData, restClient);
    await loginViaBrowser(admin.email, admin.password, { page });

    const result = await navigateToAdminTags({ page });

    expect(result.loaded).toBe(true);
    // Tags section is now embedded in the Pipelines & Fields tab
    expect(result.finalUrl).toContain('/admin/settings');
  },
);

// ---------------------------------------------------------------------------
// F8-TG1b — Pagination controls always visible on admin tags page
// ---------------------------------------------------------------------------

test(
  'F8-TG1b: admin tags page — pagination controls always visible',
  { tag: ['@functional'] },
  async ({ page, testData, restClient }) => {
    const admin = await createTestAdmin(testData, restClient);
    await loginViaBrowser(admin.email, admin.password, { page });

    // Own at least one tag rather than relying on ambient tags created by
    // concurrent tests in this file (F8-TG3/F8-TG4 etc. mutate the same
    // global tags list under fullyParallel). Pagination renders as soon as
    // the tags query resolves regardless of count, but without an owned tag
    // this test has no guarantee the list isn't momentarily empty mid-race.
    await createTestTag(testData, restClient, {
      name: `tg1b-pagination-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    });

    const navResult = await navigateToAdminTags({ page });
    // Root cause of the prior "testId(pagination) exhausted" flake:
    // AdminTagsPage.isLoaded() used to return a false positive while the page
    // was still on the feature-flag-loading skeleton (no admin-tags-loading,
    // no admin-tags-list, no pagination in the DOM yet) — this assertion is
    // the guard that catches that class of bug; F8-TG1/F8-TG2 already had it,
    // F8-TG1b did not. isLoaded() now waits for a positive presence signal
    // (admin-tags-list or admin-tags-empty-state) instead of an absence check.
    expect(navResult.loaded).toBe(true);

    await expectAdminTagsPaginationVisible({ page });
  },
);

// ---------------------------------------------------------------------------
// F8-TG2 — Admin can rename a tag and the new name is persisted
// ---------------------------------------------------------------------------

test(
  'F8-TG2: admin renames a tag via UI and new name is persisted via API',
  { tag: ['@functional', '@smoke'] },
  async ({ page, testData, restClient }) => {
    const admin = await createTestAdmin(testData, restClient);
    await loginViaBrowser(admin.email, admin.password, { page });

    const tag = await createTestTag(testData, restClient, {
      name: `tg2-original-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    });

    const navResult = await navigateToAdminTags({ page });
    expect(navResult.loaded).toBe(true);

    const newName = `tg2-renamed-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const renameResult = await renameTagViaUI(tag.id, newName, { page });
    expect(renameResult.saved).toBe(true);

    // Verify via API that the name was persisted server-side.
    const fetchedTag = await getTagById(restClient, tag.id);
    expect(fetchedTag.name).toBe(newName);
  },
);

// ---------------------------------------------------------------------------
// F8-TG3 — Admin can delete a tag and it no longer exists
// ---------------------------------------------------------------------------

test(
  'F8-TG3: admin deletes a tag via UI and tag is removed from API',
  { tag: ['@functional', '@smoke'] },
  async ({ page, testData, restClient }) => {
    const admin = await createTestAdmin(testData, restClient);
    await loginViaBrowser(admin.email, admin.password, { page });

    // Create the tag but unregister it from TestDataManager after we delete it
    // in the test — otherwise teardown will attempt a DELETE on an already-gone
    // resource and log a spurious error.
    const tag = await createTestTag(testData, restClient, {
      name: `tg3-delete-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    });

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
    const admin = await createTestAdmin(testData, restClient);
    await loginViaBrowser(admin.email, admin.password, { page });

    // Random suffix, not a bare timestamp: POST /tags upserts ON CONFLICT (name) and
    // returns 201 with the EXISTING row's id, so two workers landing in the same
    // millisecond share one tag — and whichever tears down first deletes it under the
    // other, whose badge then never appears.
    const tag = await createTestTag(testData, restClient, {
      name: `tg4-attach-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    });
    const contact = await createTestContact(testData, restClient, {
      first_name: 'TG4',
      last_name: 'Contact',
    });

    // Navigate to the contact detail page (assumes the app uses /contacts/:id).
    await navigateToContactDetailPage(contact.id, { page });

    const attachResult = await attachTagViaUI(contact.id, tag.id, tag.name, { page });
    expect(attachResult.badgeVisible).toBe(true);

    // Verify via API that the tag is recorded on the contact.
    const contactTags = await getContactTags(restClient, contact.id);
    const tagIds = contactTags.map((t) => t.id);
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
    const admin = await createTestAdmin(testData, restClient);
    await loginViaBrowser(admin.email, admin.password, { page });

    const tag = await createTestTag(testData, restClient, {
      name: `tg5-detach-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    });
    const contact = await createTestContact(testData, restClient, {
      first_name: 'TG5',
      last_name: 'Contact',
    });

    // Attach via API so the badge is visible when we load the page.
    await attachTagToContact(restClient, contact.id, tag.name);

    await navigateToContactDetailPage(contact.id, { page });

    const detachResult = await detachTagViaUI(contact.id, tag.id, { page });
    expect(detachResult.badgeGone).toBe(true);

    // Verify via API that the tag is no longer on the contact.
    const contactTags = await getContactTags(restClient, contact.id);
    const tagIds = contactTags.map((t) => t.id);
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
    const admin = await createTestAdmin(testData, restClient);
    await loginViaBrowser(admin.email, admin.password, { page });

    const tag = await createTestTag(testData, restClient, {
      name: `tg6-deal-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    });
    const account = await createTestAccount(testData, restClient, {
      name: `TG6 Account ${Date.now()}`,
    });
    const deal = await createTestDeal(testData, restClient, {
      name: `TG6 Deal ${Date.now()}`,
      stage: 'Prospecting',
      account_id: account.id,
    });

    // Navigate to the deal detail page.
    await navigateToDealDetailPage(deal.id, { page });

    const attachResult = await attachTagViaUI(deal.id, tag.id, tag.name, { page });
    expect(attachResult.badgeVisible).toBe(true);

    // Verify via API that the tag is recorded on the deal.
    const dealTags = await getDealTags(restClient, deal.id);
    const tagIds = dealTags.map((t) => t.id);
    expect(tagIds).toContain(tag.id);
  },
);
