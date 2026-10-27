/**
 * Admin Email Sync panel — org excluded domains and backfill window
 *
 * Covers the panel as assembled in a real browser: shown disabled while email sync is off
 * org-wide, and saving both settings through it once it is on, read back through the API.
 *
 * Mail itself is out of reach here: a mailbox cannot be created in an E2E run, because
 * assertHostnameIsSafe blocks GreenMail's private address, so sync-time exclusion and the
 * thread privacy toggle are covered by emailSyncService.test.ts, emailPrivacy.test.ts and
 * EmailsSection.test.tsx instead.
 *
 * The flag is set in the browser with withAdminFlagList(): the panel reads the org-level
 * value from the admin flag list, and the settings endpoints are not behind the flag.
 *
 * @serial because it writes two system_settings rows every caller of
 * ensureSystemDefaults() resets.
 *
 * Framework conventions:
 *   - All tests tagged @functional
 *   - Import test/expect from @apps/minicrm/fixtures.js only
 *   - No raw locators in this file — all through @behaviors/* imports
 */

import { test, expect } from '@apps/minicrm/fixtures.js';
import { createTestAdmin, withAdminFlagList } from '@apps/minicrm/helpers.js';
import { loginAsAdmin, loginViaBrowser } from '@behaviors/minicrm/auth.behaviors.js';
import {
  isEmailSyncPanelDisabled,
  openEmailSyncSettings,
  readOrgEmailSyncSettings,
  readPanelExcludedDomains,
  saveBackfillWindow,
  saveOrgExcludedDomains,
  submitRejectedExcludedDomains,
} from '@behaviors/minicrm/email-sync-settings.behaviors.js';
import { ensureSystemDefaults } from '@behaviors/minicrm/settings.behaviors.js';

test.use({ storageState: { cookies: [], origins: [] } });

// describe.serial for intra-file ordering: every test writes the same settings rows. Cross-file protection is the @serial tag plus the resource-registry entry.
test.describe.serial('Admin Email Sync panel', () => {
  test.beforeEach(async ({ restClient }) => {
    await loginAsAdmin(restClient);
    await ensureSystemDefaults(restClient);
  });

  test.afterEach(async ({ restClient }) => {
    await loginAsAdmin(restClient);
    await ensureSystemDefaults(restClient);
  });

  test('F-ES1 — with email sync off org-wide, the panel is shown but disabled @functional @serial', async ({
    page,
    restClient,
    testData,
  }) => {
    await withAdminFlagList(page, { email_sync: false });
    const admin = await createTestAdmin(testData, restClient);

    await loginViaBrowser(admin.email, admin.password, { page });
    await openEmailSyncSettings({ page });

    expect(await isEmailSyncPanelDisabled({ page })).toBe(true);
  });

  test('F-ES2 — an admin saves the org excluded domains, normalized @functional @serial', async ({
    page,
    restClient,
    testData,
  }) => {
    await withAdminFlagList(page, { email_sync: true });
    const admin = await createTestAdmin(testData, restClient);

    await loginViaBrowser(admin.email, admin.password, { page });
    await openEmailSyncSettings({ page });
    expect(await isEmailSyncPanelDisabled({ page })).toBe(false);
    const result = await saveOrgExcludedDomains({ page }, 'HR.Example.com\n\nlegal.example.org');

    expect(result).toEqual({ status: 200, confirmed: true });
    expect((await readOrgEmailSyncSettings(restClient)).domains).toEqual([
      'hr.example.com',
      'legal.example.org',
    ]);
    await openEmailSyncSettings({ page });
    expect(await readPanelExcludedDomains({ page })).toBe('hr.example.com\nlegal.example.org');
  });

  test('F-ES3 — a domain with an @ is refused before anything is saved @functional @serial', async ({
    page,
    restClient,
    testData,
  }) => {
    await withAdminFlagList(page, { email_sync: true });
    const admin = await createTestAdmin(testData, restClient);

    await loginViaBrowser(admin.email, admin.password, { page });
    await openEmailSyncSettings({ page });
    const result = await submitRejectedExcludedDomains({ page }, 'someone@example.com');

    expect(result.message).toMatch(/one domain per line/i);
    expect(result.requested).toBe(false);
    expect((await readOrgEmailSyncSettings(restClient)).domains).toEqual([]);
  });

  test('F-ES4 — an admin sets the backfill window @functional @serial', async ({
    page,
    restClient,
    testData,
  }) => {
    await withAdminFlagList(page, { email_sync: true });
    const admin = await createTestAdmin(testData, restClient);

    await loginViaBrowser(admin.email, admin.password, { page });
    await openEmailSyncSettings({ page });

    expect(await saveBackfillWindow({ page }, 30)).toBe(200);
    expect((await readOrgEmailSyncSettings(restClient)).days).toBe(30);
  });
});
