/**
 * Connected mailboxes — profile panel
 *
 * Covers the client-side surface: whether the panel renders for a given flag state, and
 * where each provider button points.
 *
 * Scope is deliberately narrow. withFlags() intercepts the BROWSER's flag fetch only;
 * the server re-reads the flag from the database on every request, so an API call behind
 * requireFeatureEnabled('email_sync') still gets a 403 while the seeded row says false.
 * Covering the API paths would mean flipping the real row, which is a shared-state
 * mutation demanding @serial plus a resource-registry entry — and those paths already
 * have contract-test coverage in connectedAccountController.test.ts, including the
 * flag-off 403 and the unreachable-server 400. Nothing here would be additive.
 *
 * A successful IMAP connect is untestable regardless: the test stack's only mail service
 * is MailHog, which speaks SMTP and runs no IMAP listener. A live OAuth connect needs a
 * real provider consent screen. Both wait on the sync story.
 *
 * Framework conventions:
 *   - All tests tagged @functional
 *   - Import test/expect from @apps/minicrm/fixtures.js only
 *   - No raw locators in this file — all through @behaviors/* imports
 */

import { test, expect } from '@apps/minicrm/fixtures.js';
import { createTestAdmin, withFlags } from '@apps/minicrm/helpers.js';
import { loginAsAdmin, loginViaBrowser } from '@behaviors/minicrm/auth.behaviors.js';
import {
  connectedAccountsPanelIsVisible,
  openProfilePage,
  readOAuthConnectHref,
} from '@behaviors/minicrm/connected-accounts.behaviors.js';

// Each test uses its own ephemeral session — no shared storageState.
test.use({ storageState: { cookies: [], origins: [] } });

test.describe('Connected mailboxes panel', () => {
  test('F-CA1 — the panel is hidden when email_sync is off @functional', async ({
    page,
    restClient,
    testData,
  }) => {
    await loginAsAdmin(restClient);
    const admin = await createTestAdmin(testData, restClient);
    await withFlags(page, { email_sync: false });
    await loginViaBrowser(admin.email, admin.password, { page });

    await openProfilePage({ page });

    expect(await connectedAccountsPanelIsVisible({ page })).toBe(false);
  });

  test('F-CA2 — each provider button starts its own OAuth flow @functional', async ({
    page,
    restClient,
    testData,
  }) => {
    await loginAsAdmin(restClient);
    const admin = await createTestAdmin(testData, restClient);
    await withFlags(page, { email_sync: true });
    await loginViaBrowser(admin.email, admin.password, { page });

    await openProfilePage({ page });

    expect(await readOAuthConnectHref({ page }, 'google')).toBe(
      '/api/v1/connected-accounts/oauth/google/start',
    );
    expect(await readOAuthConnectHref({ page }, 'microsoft')).toBe(
      '/api/v1/connected-accounts/oauth/microsoft/start',
    );
  });
});
