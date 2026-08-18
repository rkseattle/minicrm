/**
 * F-HYGIENE — AI data hygiene assistant
 *
 * Functional regression tests for the personal hygiene queue (/hygiene), the
 * org-wide admin queue (/admin/hygiene), dismissing a finding with a required
 * reason, and triggering a manual "run now" scan from AI Settings.
 *
 * Test groups:
 *   F-HYGIENE1 — A rep views their personal queue and dismisses a finding,
 *                which requires a reason and removes it from the list
 *   F-HYGIENE2 — An admin views the org-wide queue and sees findings from
 *                other users' records
 *   F-HYGIENE3 — An admin triggers a manual scan from AI Settings and sees
 *                the run-accepted confirmation
 *
 * Notes:
 *   - Does not mutate data_hygiene_scoring_config. That was once given as the
 *     reason no @serial tag was needed, which was wrong: it reasoned about the
 *     scoring config while overlooking F-HYGIENE3's setAiEnabled() call, which
 *     writes the shared ai_configuration_enabled singleton that eleven other
 *     @serial specs conflict on. F-HYGIENE3 is now @serial and registered, and
 *     the afterEach below restores defaults.
 *   - contact_missing_contact_info is used as the deterministic finding
 *     signal: createTestContact() never sets a phone number, and the
 *     contact_missing_contact_info gatherer flags any contact missing either
 *     email or phone — no DNS/website-reachability check involved, unlike
 *     contact_unresolvable_email_domain or account_website_unreachable, so
 *     this finding is reliable in an offline/CI network environment.
 *   - The manual "run now" endpoint (POST /api/v1/admin/ai/data-hygiene/run)
 *     returns 202 and scans fire-and-forget — tests poll
 *     GET /api/v1/data-hygiene/findings via expect(...).toPass() until the
 *     new finding is reflected, rather than waiting a fixed duration.
 */

import { test, expect } from '@apps/minicrm/fixtures.js';
import type { RestClient } from '@framework/clients/rest-client.js';
import { createTestAdmin, createTestRep, createTestContact } from '@apps/minicrm/helpers.js';
import { loginAsAdmin, loginViaBrowser, loginAs } from '@behaviors/minicrm/auth.behaviors.js';
import {
  navigateToMyDataHygieneQueue,
  navigateToAdminDataHygieneQueue,
  waitForDataHygieneHeading,
  hasAtLeastOneHygieneFinding,
  dismissHygieneFindingViaUI,
} from '@behaviors/minicrm/data-hygiene.behaviors.js';
import {
  navigateToAdminSettings,
  expectAiSettingsSubPanelVisible,
  setAiEnabled,
  restoreAiDefaultsAfterTest,
  clickDataHygieneRunNowAndAwaitResponse,
  expectDataHygieneRunAcceptedVisible,
  ensureSystemDefaults,
} from '@behaviors/minicrm/settings.behaviors.js';

test.use({ storageState: { cookies: [], origins: [] } });

// F-HYGIENE3 enables the AI master toggle so the data-hygiene sub-panel's
// run-now button is clickable, and previously never restored it — leaving
// ai_configuration_enabled on for whatever ran next. That row is written by
// eleven other @serial specs, so the leak was a live cross-file hazard rather
// than untidiness.
//
// Scoped to F-HYGIENE3's own describe.serial block rather than the file, and
// this is load-bearing: F-HYGIENE1 and F-HYGIENE2 are plain @functional and run
// in the PARALLEL shard matrix. A file-level afterEach would have them resetting
// nav_layout, default_language, visibility, sso, currencies, branding and
// mfa_required — nine shared settings — while other shards were relying on them,
// turning a cleanup fix into a much wider race than the one being closed.
// The block itself is at the bottom of this file, wrapping F-HYGIENE3.

/** Finding shape returned by GET /api/v1/data-hygiene/findings — only the fields this spec needs. */
interface HygieneFindingShape {
  id: string;
  entity_type: string;
  entity_id: string;
  issue_type: string;
}

interface HygieneFindingsResponseShape {
  findings: HygieneFindingShape[];
  total: number;
}

/** Triggers the manual hygiene scan and polls scope=all until the given contact's finding appears. */
async function triggerManualScanAndWaitForContactFinding(
  restClient: RestClient,
  contactId: string,
): Promise<HygieneFindingShape> {
  const runResponse = await restClient.post<{ accepted: boolean }>(
    '/api/v1/admin/ai/data-hygiene/run',
  );
  expect(runResponse.status).toBe(202);

  let found: HygieneFindingShape | undefined;
  await expect(async () => {
    const result = await restClient.get<HygieneFindingsResponseShape>(
      '/api/v1/data-hygiene/findings?scope=all',
    );
    found = result.body.findings.find(
      (f) => f.entity_type === 'contact' && f.entity_id === contactId,
    );
    expect(found).toBeDefined();
  }).toPass({ timeout: 20_000 });

  // Safe: the toPass() block above only resolves once `found` is defined.
  return found!;
}

test('@functional F-HYGIENE1: a rep views their personal hygiene queue and dismisses a finding with a required reason', async ({
  page,
  testData,
  restClient,
}) => {
  await loginAsAdmin(restClient);
  const rep = await createTestRep(testData, restClient);

  // Create the contact while authenticated as the rep so it is owned by
  // them (createContactHandler always uses req.user.id as owner_id, never
  // a body field) — required for the personal (scope=mine) queue to show it.
  await loginAs(restClient, rep.email, rep.password);
  const contact = await createTestContact(testData, restClient, {
    first_name: 'F-HYGIENE1',
    last_name: `Contact ${Date.now()}`,
    // No phone override — createTestContact never sets one, which alone
    // satisfies contact_missing_contact_info's OR condition.
  });

  await loginAsAdmin(restClient);
  const finding = await triggerManualScanAndWaitForContactFinding(restClient, contact.id);

  await loginViaBrowser(rep.email, rep.password, { page });
  await navigateToMyDataHygieneQueue({ page });
  await waitForDataHygieneHeading({ page }, 10_000);

  const hasFinding = await hasAtLeastOneHygieneFinding({ page }, 10_000);
  expect(hasFinding).toBe(true);

  await dismissHygieneFindingViaUI(finding.id, 'Verified with the customer directly', { page });
});

test("@functional F-HYGIENE2: an admin views the org-wide hygiene queue and sees a finding from another user's record", async ({
  page,
  testData,
  restClient,
}) => {
  await loginAsAdmin(restClient);
  const admin = await createTestAdmin(testData, restClient);
  const rep = await createTestRep(testData, restClient);

  await loginAs(restClient, rep.email, rep.password);
  const contact = await createTestContact(testData, restClient, {
    first_name: 'F-HYGIENE2',
    last_name: `Contact ${Date.now()}`,
  });

  await loginAsAdmin(restClient);
  await triggerManualScanAndWaitForContactFinding(restClient, contact.id);

  await loginViaBrowser(admin.email, admin.password, { page });
  await navigateToAdminDataHygieneQueue({ page });
  await waitForDataHygieneHeading({ page }, 10_000);

  const hasFinding = await hasAtLeastOneHygieneFinding({ page }, 10_000);
  expect(hasFinding).toBe(true);
});

test.describe.serial('F-HYGIENE3 — AI-enabling scan trigger', () => {
  // Scoped to this block, not the file — see the note at the top. F-HYGIENE1 and
  // F-HYGIENE2 are plain @functional and run in the parallel shard matrix; a
  // file-level reset of nine shared settings would race the other shards.
  test.afterEach(async ({ restClient }) => {
    await loginAsAdmin(restClient);
    // ensureSystemDefaults does NOT touch the AI master toggle (see
    // settings.behaviors.ts:414-447), so restoring it takes its own call —
    // otherwise setAiEnabled(true) below outlives this file and the next
    // sequential conflict group starts with AI unexpectedly enabled.
    await restoreAiDefaultsAfterTest(restClient);
    await ensureSystemDefaults(restClient);
  });

  test('@functional @serial F-HYGIENE3: an admin triggers a manual data hygiene scan from AI Settings and sees the run-accepted confirmation', async ({
    page,
    testData,
    restClient,
  }) => {
    await loginAsAdmin(restClient);
    const admin = await createTestAdmin(testData, restClient);

    // The data-hygiene sub-panel's run-now button lives inside the fieldset
    // that AiSettings disables whenever ai_features is off (everything
    // except the master toggle itself) — enable AI first so it's clickable.
    await setAiEnabled(restClient, true);

    await loginViaBrowser(admin.email, admin.password, { page });
    await navigateToAdminSettings({ page }, 'ai', 'data-hygiene');
    await expectAiSettingsSubPanelVisible('data-hygiene', { page }, 10_000);

    const result = await clickDataHygieneRunNowAndAwaitResponse({ page });
    expect(result.status).toBe(202);

    await expectDataHygieneRunAcceptedVisible({ page }, 5_000);
  });
});
