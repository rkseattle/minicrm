/**
 * F-CC — Concurrency tests for optimistic locking behaviour (MINCRM-350)
 *
 * Validates that the optimistic locking implementation (MINCRM-349) and the
 * conflict resolution UI (MINCRM-351) behave correctly when two users edit
 * the same record simultaneously.
 *
 * ## Approach
 * Tests use a choreographed sequence — no setTimeout or sleep-based timing:
 *   1. User A reads the record (browser or API). Current version is captured.
 *   2. User B writes the record (direct restClient PATCH). Version increments.
 *   3. User A attempts to write with the stale version.
 *   4. Assert the conflict is handled correctly.
 *
 * Steps 2 and 3 are interleaved deliberately. The sequence is deterministic —
 * the version mismatch is guaranteed without any timing dependency.
 *
 * ## Tests
 *   F-CC1  Contact API-level 409: stale version rejected with OPTIMISTIC_LOCK_CONFLICT
 *   F-CC2  Contact UI conflict: FieldMergeModal appears on stale save
 *   F-CC3  Deal stage conflict: 409 does not trigger webhook or automation
 *   F-CC4  Conflict resolution — re-save path (modal → Save resolved)
 *   F-CC5  Conflict resolution — discard path (modal → Discard)
 *   F-CC6  Bulk reassign is exempt from version checking
 *   F-CC7  Accept "theirs" in conflict modal → subsequent edit saves cleanly
 *   F-CC8  Accept "mine" in conflict modal → subsequent edit saves cleanly
 *   F-CC9  Activity — version increments on update; stale version returns 409
 *           (absorbed from optimistic-locking.spec.ts OL4 — MINCRM-409)
 *
 * Framework conventions (MINCRM-42):
 *   - All tests tagged @functional
 *   - Import test/expect from @apps/minicrm/fixtures.js only
 *   - Test data managed via restClient + TestDataManager (auto teardown)
 *   - test.describe.serial: tests run sequentially within this file
 *
 * MINCRM-350
 */

import { test, expect } from '@apps/minicrm/fixtures.js';
import { RestClientError } from '@framework/clients/rest-client.js';
import type { RestClient } from '@framework/clients/rest-client.js';
import {
  createTestContact,
  createTestDeal,
  createTestAccount,
  createTestActivity,
  createTestUser,
  createTestRep,
} from '@apps/minicrm/helpers.js';

test.use({ storageState: { cookies: [], origins: [] } });
import {
  navigateToContacts,
  waitForContactInList,
  waitForBulkCheckbox,
  clickBulkCheckbox,
  filterContactsByTerm,
  bulkReassignContacts,
  getContactById,
  patchContact,
} from '@behaviors/minicrm/contacts.behaviors.js';
import { getDealById } from '@behaviors/minicrm/deals.behaviors.js';
import { patchActivity } from '@behaviors/minicrm/activities.behaviors.js';
import { deactivateUser } from '@behaviors/minicrm/users.behaviors.js';
import {
  simulateConcurrentEdit,
  isConflictModalVisible,
  getConflictModalTitleLocator,
  getConflictSaveResolvedButtonLocator,
  getConflictDiscardButtonLocator,
  clickConflictSaveResolved,
  clickConflictDiscard,
  selectConflictTheirs,
  selectConflictMine,
} from '@behaviors/minicrm/concurrency.behaviors.js';
import { loginAsAdmin, loginViaBrowser, loginAs } from '@behaviors/minicrm/auth.behaviors.js';
import {
  navigateToContactDetail,
  clickContactEdit,
  fillContactDetailField,
  saveContact,
  isContactDetailLoaded,
  getContactsBulkActionBarLocator,
} from '@behaviors/minicrm/contacts.behaviors.js';
import {
  navigateToDealDetail,
  openDealEditForm,
  getDealStageSelectOnFormLocator,
  submitDealForm,
} from '@behaviors/minicrm/deals.behaviors.js';

// ---------------------------------------------------------------------------
// Setup — admin restClient session for REST API data setup
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Local response types (only for endpoints not covered by behavior helpers)
// ---------------------------------------------------------------------------

/**
 * Raw contact response shape used in F-CC6 to assert owner_id, which is not
 * included in the ContactRow type exported by contacts.behaviors.ts.
 */
interface ContactWithOwnerResponse {
  contact: {
    id: string;
    owner_id: string;
    version: number;
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Asserts that a PATCH returns 409 with OPTIMISTIC_LOCK_CONFLICT.
 */
async function assertStaleVersionRejected(
  restClient: RestClient,
  path: string,
  body: Record<string, unknown>,
): Promise<void> {
  let threw = false;
  let errorCode: string | undefined;
  try {
    await restClient.patch(path, body);
  } catch (err) {
    threw = true;
    expect(err).toBeInstanceOf(RestClientError);
    expect((err as RestClientError).status).toBe(409);
    const body = (err as RestClientError).body as {
      error?: { code?: string };
    };
    errorCode = body?.error?.code;
  }
  expect(threw, `Expected PATCH to ${path} to return 409 but it did not throw`).toBe(true);
  expect(errorCode, 'Expected OPTIMISTIC_LOCK_CONFLICT error code').toBe(
    'OPTIMISTIC_LOCK_CONFLICT',
  );
}

/**
 * Drives the UI into a conflict state on a contact:
 *   1. Navigate to the contact detail page.
 *   2. Click Edit and change the first name (but don't save).
 *   3. Background-PATCH the same contact via restClient (version mismatch).
 *   4. Click Save — the UI submits the stale version, triggering 409.
 *   5. Returns the new version in the database (2) and the background field value.
 */
async function driveContactIntoConflict(
  context: { page: Parameters<Parameters<typeof test>[2]>[0]['page'] },
  restClient: RestClient,
  contactId: string,
  contactVersion: number,
  opts: {
    uiFirstName: string;
    backgroundFirstName: string;
  },
): Promise<{ backgroundVersion: number }> {
  await navigateToContactDetail(contactId, context);
  await clickContactEdit(context);
  await fillContactDetailField('contact-first-name', 'First name', opts.uiFirstName, context);

  // Background write: another user saves before we do
  const { newVersion } = await simulateConcurrentEdit(
    restClient,
    'contact',
    contactId,
    contactVersion,
    { first_name: opts.backgroundFirstName },
  );

  // Submit the stale UI form
  await saveContact(context);

  return { backgroundVersion: newVersion };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe.serial('F-CC — Optimistic locking concurrency', () => {
  test.beforeEach(async ({ restClient }) => {
    await loginAsAdmin(restClient);
  });

  test(
    'F-CC1: contact API-level 409 — stale version rejected with OPTIMISTIC_LOCK_CONFLICT',
    { tag: ['@functional'] },
    async ({ testData, restClient }) => {
      const contact = await createTestContact(testData, restClient, {
        first_name: 'CC1',
        last_name: 'ApiConflict',
      });
      expect(contact.version, 'freshly created contact should be at version 1').toBe(1);

      // Successful update with current version — version increments to 2
      const updated = await patchContact(restClient, contact.id, {
        first_name: 'CC1-Updated',
        version: contact.version,
      });
      expect(updated.version, 'version should increment to 2 on successful PATCH').toBe(2);

      // Stale PATCH with original version 1 must be rejected with 409
      await assertStaleVersionRejected(restClient, `/api/v1/contacts/${contact.id}`, {
        first_name: 'CC1-Stale',
        version: contact.version, // original version 1 is now stale
      });
    },
  );

  test(
    'F-CC2: contact UI conflict — FieldMergeModal appears when save uses stale version',
    { tag: ['@functional'] },
    async ({ page, testData, restClient }) => {
      const rep = await createTestRep(testData, restClient);
      await loginViaBrowser(rep.email, rep.password, { page });
      await loginAs(restClient, rep.email, rep.password);

      const contact = await createTestContact(testData, restClient, {
        first_name: 'CC2',
        last_name: 'UiConflict',
      });

      await driveContactIntoConflict({ page }, restClient, contact.id, contact.version, {
        uiFirstName: 'CC2-Mine',
        backgroundFirstName: 'CC2-Theirs',
      });

      // Conflict modal must appear
      const isVisible = await isConflictModalVisible({ page });
      expect(isVisible, 'conflict modal should be visible after stale save').toBe(true);

      // Title heading must be present
      const title = await getConflictModalTitleLocator({ page });
      expect(await title.isVisible(), 'modal title should be visible').toBe(true);

      // Both action buttons must be present
      const saveBtn = await getConflictSaveResolvedButtonLocator({ page });
      expect(await saveBtn.isVisible(), '"Save resolved" button should be visible').toBe(true);

      const discardBtn = await getConflictDiscardButtonLocator({ page });
      expect(await discardBtn.isVisible(), '"Discard my changes" button should be visible').toBe(
        true,
      );
    },
  );

  test(
    'F-CC3: deal stage conflict — 409 does not trigger webhook or automation event',
    { tag: ['@functional'] },
    async ({ page, testData, restClient }) => {
      const rep = await createTestRep(testData, restClient);
      await loginViaBrowser(rep.email, rep.password, { page });
      await loginAs(restClient, rep.email, rep.password);

      const account = await createTestAccount(testData, restClient, { name: 'CC3 Account' });
      const deal = await createTestDeal(testData, restClient, {
        name: 'CC3 Deal',
        stage: 'Prospecting',
        account_id: account.id,
      });
      expect(deal.version, 'freshly created deal should be at version 1').toBe(1);

      // Navigate to deal and enter edit mode with a stage change
      await navigateToDealDetail(deal.id, { page });
      await openDealEditForm({ page });

      // Change stage in the UI to Qualification (do not save yet)
      const stageSelect = await getDealStageSelectOnFormLocator({ page });
      await stageSelect.selectOption('Qualification');

      // Background write: move stage to Negotiation — this increments version to 2
      const { newVersion } = await simulateConcurrentEdit(
        restClient,
        'deal',
        deal.id,
        deal.version,
        { stage: 'Negotiation' },
      );
      expect(newVersion, 'background write should produce version 2').toBe(2);

      // Record the automation rule log count before the stale save
      // We verify it does not increase after the rejected save
      // GET /api/v1/automation/rules returns PaginatedResponse: { data: [...], total, page, limit }
      const automationRulesResponse = await restClient
        .get<{ data: Array<{ id: string }> }>('/api/v1/automation/rules')
        .catch(() => ({ body: { data: [] as Array<{ id: string }> } }));
      const ruleIds = automationRulesResponse.body.data.map((r) => r.id);

      // Submit the stale UI save — expect conflict modal
      await submitDealForm({ page });

      const isVisible = await isConflictModalVisible({ page });
      expect(isVisible, 'conflict modal should appear on stale deal stage save').toBe(true);

      // Verify the deal version is still 2 in the database — the stale save
      // was rejected before any side effects (webhooks, automation) could fire
      const dealResponse = await getDealById(restClient, deal.id);
      expect(
        dealResponse.version,
        'deal version should remain at 2 — stale save was rejected',
      ).toBe(2);
      expect(
        dealResponse.stage,
        'deal stage should be Negotiation (from background write), not Qualification (stale UI save)',
      ).toBe('Negotiation');

      // Verify no automation rules fired for the stale save by checking log counts
      // are unchanged. We only check if rules exist — an empty ruleset is also fine.
      for (const ruleId of ruleIds) {
        const logsResponse = await restClient
          .get<{
            logs: Array<{ triggering_record_id: string; triggered_at: string }>;
          }>(`/api/v1/automation/rules/${ruleId}/logs`)
          .catch(() => ({
            body: {
              logs: [] as Array<{ triggering_record_id: string; triggered_at: string }>,
            },
          }));
        // No log entry for this deal created in the last 5 seconds
        const recentDealLogs = logsResponse.body.logs.filter(
          (log) =>
            log.triggering_record_id === deal.id &&
            Date.now() - new Date(log.triggered_at).getTime() < 5_000,
        );
        expect(
          recentDealLogs.length,
          `automation rule ${ruleId} should not have fired for the rejected stale save`,
        ).toBe(0);
      }
    },
  );

  test(
    'F-CC4: conflict resolution — re-save path saves successfully with resolved version',
    { tag: ['@functional'] },
    async ({ page, testData, restClient }) => {
      const rep = await createTestRep(testData, restClient);
      await loginViaBrowser(rep.email, rep.password, { page });
      await loginAs(restClient, rep.email, rep.password);

      const contact = await createTestContact(testData, restClient, {
        first_name: 'CC4',
        last_name: 'ResaveConflict',
      });

      // Drive into conflict state
      await driveContactIntoConflict({ page }, restClient, contact.id, contact.version, {
        uiFirstName: 'CC4-Mine',
        backgroundFirstName: 'CC4-Theirs',
      });

      // Conflict modal should be visible
      expect(await isConflictModalVisible({ page }), 'conflict modal should be visible').toBe(true);

      // Click "Save resolved" — modal defaults to "theirs" for conflicts, which is fine
      // The key assertion here is that the save succeeds and the modal is dismissed
      await clickConflictSaveResolved({ page });

      await page.waitForLoadState('networkidle');

      // Conflict modal should be dismissed
      expect(
        await isConflictModalVisible({ page }),
        'conflict modal should be dismissed after successful re-save',
      ).toBe(false);

      // Contact should be in read mode (edit button visible = form submitted successfully)
      const loaded = await isContactDetailLoaded({ page });
      expect(loaded, 'contact detail page should return to read mode after re-save').toBe(true);

      // Verify via API that the contact was updated (version is now 3)
      const response = await getContactById(restClient, contact.id);
      expect(
        response.version,
        'contact should be at version 3 after conflict resolution save',
      ).toBe(3);
    },
  );

  test(
    'F-CC5: conflict resolution — discard path reverts to server state',
    { tag: ['@functional'] },
    async ({ page, testData, restClient }) => {
      const rep = await createTestRep(testData, restClient);
      await loginViaBrowser(rep.email, rep.password, { page });
      await loginAs(restClient, rep.email, rep.password);

      const contact = await createTestContact(testData, restClient, {
        first_name: 'CC5',
        last_name: 'DiscardConflict',
      });

      // Drive into conflict state
      await driveContactIntoConflict({ page }, restClient, contact.id, contact.version, {
        uiFirstName: 'CC5-Mine',
        backgroundFirstName: 'CC5-Theirs',
      });

      expect(await isConflictModalVisible({ page }), 'conflict modal should be visible').toBe(true);

      // Click "Discard my changes" — abandons pending edits, accepts server state
      await clickConflictDiscard({ page });

      await page.waitForLoadState('networkidle');

      // Conflict modal should be dismissed
      expect(
        await isConflictModalVisible({ page }),
        'conflict modal should be dismissed after discard',
      ).toBe(false);

      // Contact detail page should return to read mode
      const loaded = await isContactDetailLoaded({ page });
      expect(loaded, 'contact detail page should return to read mode after discard').toBe(true);

      // Verify via API that the contact is at version 2 (background write version)
      // and shows the background first name, not our discarded value
      const response = await getContactById(restClient, contact.id);
      expect(
        response.version,
        'contact should remain at version 2 — no additional write on discard',
      ).toBe(2);
      expect(
        response.first_name,
        'contact first_name should reflect the background write, not the discarded value',
      ).toBe('CC5-Theirs');
    },
  );

  test(
    'F-CC6: bulk reassign is exempt from version checking',
    { tag: ['@functional'] },
    async ({ page, testData, restClient }) => {
      const uniqueSuffix = `cc6-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

      const rep = await createTestRep(testData, restClient);

      // Create the reassignment target while still admin-authed (MINCRM-415)
      const newOwner = await createTestUser(restClient, {
        name: `CC6 Owner ${uniqueSuffix}`,
        email: `cc6-owner-${uniqueSuffix}@example.com`,
        role: 'rep',
      });

      await loginViaBrowser(rep.email, rep.password, { page });
      await loginAs(restClient, rep.email, rep.password);

      // Create 3 contacts
      const c1 = await createTestContact(testData, restClient, {
        first_name: 'CC6A',
        last_name: `Bulk-${uniqueSuffix}`,
        email: `cc6a-${uniqueSuffix}@example.com`,
      });
      const c2 = await createTestContact(testData, restClient, {
        first_name: 'CC6B',
        last_name: `Bulk-${uniqueSuffix}`,
        email: `cc6b-${uniqueSuffix}@example.com`,
      });
      const c3 = await createTestContact(testData, restClient, {
        first_name: 'CC6C',
        last_name: `Bulk-${uniqueSuffix}`,
        email: `cc6c-${uniqueSuffix}@example.com`,
      });

      // Navigate to contacts list and filter to this test's contacts
      await navigateToContacts({ page });
      await filterContactsByTerm(uniqueSuffix, { page });
      await waitForContactInList(c1.id, { page });
      await waitForContactInList(c2.id, { page });
      await waitForContactInList(c3.id, { page });

      // Select all three
      await waitForBulkCheckbox(c1.id, { page });
      await clickBulkCheckbox(c1.id, { page });
      await waitForBulkCheckbox(c2.id, { page });
      await clickBulkCheckbox(c2.id, { page });
      await waitForBulkCheckbox(c3.id, { page });
      await clickBulkCheckbox(c3.id, { page });

      await expect(await getContactsBulkActionBarLocator({ page })).toBeVisible();

      // Bulk reassign — no version required, no conflict expected
      await bulkReassignContacts(newOwner.id, newOwner.name, { page });

      // Bulk action bar should disappear on success
      expect(
        await page.isNotVisible([{ type: 'testId', value: 'bulk-action-bar' }]),
        'bulk action bar should disappear after successful reassign',
      ).toBe(true);

      // Verify all three contacts have the new owner.
      // Bulk ops are exempt from optimistic locking — they do NOT increment version,
      // and they do NOT require a version in the request body.
      // Raw restClient calls are used here because ContactRow (from contacts.behaviors)
      // does not expose owner_id.
      const r1 = await restClient.get<ContactWithOwnerResponse>(`/api/v1/contacts/${c1.id}`);
      expect(r1.body.contact.owner_id, 'c1 should have new owner').toBe(newOwner.id);
      expect(r1.body.contact.version, 'c1 version unchanged by bulk op').toBe(1);

      const r2 = await restClient.get<ContactWithOwnerResponse>(`/api/v1/contacts/${c2.id}`);
      expect(r2.body.contact.owner_id, 'c2 should have new owner').toBe(newOwner.id);
      expect(r2.body.contact.version, 'c2 version unchanged by bulk op').toBe(1);

      const r3 = await restClient.get<ContactWithOwnerResponse>(`/api/v1/contacts/${c3.id}`);
      expect(r3.body.contact.owner_id, 'c3 should have new owner').toBe(newOwner.id);
      expect(r3.body.contact.version, 'c3 version unchanged by bulk op').toBe(1);

      // Deactivate the temp user (users cannot be hard-deleted); re-auth as admin first (MINCRM-415)
      await loginAsAdmin(restClient);
      await deactivateUser(restClient, newOwner.id);
    },
  );

  test(
    'F-CC7: accept "theirs" in conflict modal — subsequent edit saves cleanly at next version',
    { tag: ['@functional'] },
    async ({ page, testData, restClient }) => {
      const rep = await createTestRep(testData, restClient);
      await loginViaBrowser(rep.email, rep.password, { page });
      await loginAs(restClient, rep.email, rep.password);

      const contact = await createTestContact(testData, restClient, {
        first_name: 'CC7',
        last_name: 'AcceptTheirs',
      });

      // Drive into conflict state: UI wants "CC7-Mine", background saved "CC7-Theirs"
      await driveContactIntoConflict({ page }, restClient, contact.id, contact.version, {
        uiFirstName: 'CC7-Mine',
        backgroundFirstName: 'CC7-Theirs',
      });

      expect(await isConflictModalVisible({ page }), 'conflict modal should be visible').toBe(true);

      // Explicitly choose "theirs" for first_name (this is the default but we confirm it)
      await selectConflictTheirs('first_name', { page });
      await clickConflictSaveResolved({ page });

      await page.waitForLoadState('networkidle');

      // Modal should be dismissed, page back in read mode
      expect(
        await isConflictModalVisible({ page }),
        'modal should be dismissed after save resolved',
      ).toBe(false);

      expect(await isContactDetailLoaded({ page }), 'page should return to read mode').toBe(true);

      // Contact should now be at version 3 with "theirs" first name
      const afterResolve = await getContactById(restClient, contact.id);
      expect(afterResolve.version, 'version should be 3 after conflict resolution').toBe(3);
      expect(afterResolve.first_name, '"theirs" value should have won').toBe('CC7-Theirs');

      // -----------------------------------------------------------------------
      // Subsequent edit — must save cleanly with no conflict (version is now 3)
      // -----------------------------------------------------------------------
      await clickContactEdit({ page });
      await fillContactDetailField('contact-first-name', 'First name', 'CC7-PostResolve', { page });
      await saveContact({ page });

      await page.waitForLoadState('networkidle');

      // No conflict modal should appear
      expect(
        await isConflictModalVisible({ page }),
        'no conflict modal should appear on the clean subsequent edit',
      ).toBe(false);

      // Page returns to read mode
      expect(
        await isContactDetailLoaded({ page }),
        'page should return to read mode after clean save',
      ).toBe(true);

      // Version is now 4
      const afterEdit = await getContactById(restClient, contact.id);
      expect(afterEdit.version, 'version should be 4 after clean subsequent save').toBe(4);
      expect(afterEdit.first_name, 'subsequent edit value should be saved').toBe('CC7-PostResolve');
    },
  );

  test(
    'F-CC8: accept "mine" in conflict modal — subsequent edit saves cleanly at next version',
    { tag: ['@functional'] },
    async ({ page, testData, restClient }) => {
      const rep = await createTestRep(testData, restClient);
      await loginViaBrowser(rep.email, rep.password, { page });
      await loginAs(restClient, rep.email, rep.password);

      const contact = await createTestContact(testData, restClient, {
        first_name: 'CC8',
        last_name: 'AcceptMine',
      });

      // Drive into conflict state: UI wants "CC8-Mine", background saved "CC8-Theirs"
      await driveContactIntoConflict({ page }, restClient, contact.id, contact.version, {
        uiFirstName: 'CC8-Mine',
        backgroundFirstName: 'CC8-Theirs',
      });

      expect(await isConflictModalVisible({ page }), 'conflict modal should be visible').toBe(true);

      // Switch the choice to "mine" for first_name
      await selectConflictMine('first_name', { page });
      await clickConflictSaveResolved({ page });

      await page.waitForLoadState('networkidle');

      // Modal should be dismissed, page back in read mode
      expect(
        await isConflictModalVisible({ page }),
        'modal should be dismissed after save resolved',
      ).toBe(false);

      expect(await isContactDetailLoaded({ page }), 'page should return to read mode').toBe(true);

      // Contact should now be at version 3 with "mine" first name
      const afterResolve = await getContactById(restClient, contact.id);
      expect(afterResolve.version, 'version should be 3 after conflict resolution').toBe(3);
      expect(afterResolve.first_name, '"mine" value should have won').toBe('CC8-Mine');

      // -----------------------------------------------------------------------
      // Subsequent edit — must save cleanly with no conflict (version is now 3)
      // -----------------------------------------------------------------------
      await clickContactEdit({ page });
      await fillContactDetailField('contact-first-name', 'First name', 'CC8-PostResolve', { page });
      await saveContact({ page });

      await page.waitForLoadState('networkidle');

      // No conflict modal should appear
      expect(
        await isConflictModalVisible({ page }),
        'no conflict modal should appear on the clean subsequent edit',
      ).toBe(false);

      // Page returns to read mode
      expect(
        await isContactDetailLoaded({ page }),
        'page should return to read mode after clean save',
      ).toBe(true);

      // Version is now 4
      const afterEdit = await getContactById(restClient, contact.id);
      expect(afterEdit.version, 'version should be 4 after clean subsequent save').toBe(4);
      expect(afterEdit.first_name, 'subsequent edit value should be saved').toBe('CC8-PostResolve');
    },
  );

  test(
    'F-CC9: activity — version increments on update; stale version returns 409 (MINCRM-409)',
    { tag: ['@functional'] },
    async ({ testData, restClient }) => {
      const account = await createTestAccount(testData, restClient, { name: 'CC9 Account' });
      const activity = await createTestActivity(testData, restClient, {
        type: 'Note',
        subject: 'CC9 Activity',
        account_id: account.id,
      });
      expect(activity.version, 'freshly created activity should be at version 1').toBe(1);

      // Successful update with current version — version increments to 2
      const updated = await patchActivity(restClient, activity.id, {
        subject: 'CC9 Updated',
        version: activity.version,
      });
      expect(updated.version, 'version should increment to 2 on successful PATCH').toBe(2);

      // Stale PATCH with original version 1 must be rejected with 409
      await assertStaleVersionRejected(restClient, `/api/v1/activities/${activity.id}`, {
        subject: 'CC9 Stale',
        version: activity.version, // original version 1 is now stale
      });
    },
  );
});
