/**
 * SSO functional tests — SAML 2.0 / OIDC single sign-on.
 *
 * Scope:
 *   - Admin can configure OIDC SSO via Settings → Integrations
 *   - SSO enabled badge is visible after configuration
 *   - Login page shows SSO sign-in button when SSO is enabled
 *   - Admin can disable SSO via the confirmation flow
 *   - After disabling, SSO button disappears from the login page
 *
 * Note on IdP-initiated login:
 *   The full SSO login round-trip (browser → IdP → callback → session) requires
 *   a running OIDC provider sidecar in the E2E Docker Compose profile. That
 *   sidecar is planned as a follow-up infrastructure task. The tests below cover
 *   all SSO configuration AC and login-page visibility AC without an IdP.
 *
 * Framework conventions:
 *   - All tests tagged @functional
 *   - Import test/expect from @apps/minicrm/fixtures.js only
 *   - No raw locators — all through behaviors
 *   - Test data cleaned up via ensureSystemDefaults() in afterEach
 *
 *
 */

import { test, expect } from '@apps/minicrm/fixtures.js';
import { loginAsAdmin, loginViaBrowser } from '@behaviors/minicrm/auth.behaviors.js';
import { createTestAdmin } from '@apps/minicrm/helpers.js';
import { reloadCurrentPage } from '@behaviors/minicrm/nav.behaviors.js';
import {
  ensureSystemDefaults,
  navigateToAdminSettings,
  expectSsoSectionVisible,
  selectSsoProtocol,
  fillSsoIdpMetadataUrl,
  fillSsoEntityId,
  clickSsoSaveButton,
  expectSsoEnabledBadgeVisible,
  expectSsoEnabledBadgeNotVisible,
  clickSsoDisableButton,
  expectSsoDisableConfirmVisible,
  clickSsoDisableConfirmButton,
  expectSsoSaveSuccessVisible,
  navigateToLoginPageForSso as navigateToLoginPage,
  expectSsoLoginButtonVisible,
  expectSsoLoginButtonNotVisible,
} from '@behaviors/minicrm/settings.behaviors.js';

// Use fresh browser context for each test — SSO tests must verify the login
// page as an unauthenticated user, so we cannot use the global admin storageState.
test.use({ storageState: { cookies: [], origins: [] } });

const OIDC_METADATA_URL = 'https://idp.example.com/.well-known/openid-configuration';
const OIDC_CLIENT_ID = 'minicrm-e2e-test-client';

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

test.beforeEach(async ({ restClient }) => {
  await loginAsAdmin(restClient);
  await ensureSystemDefaults(restClient);
});

test.afterEach(async ({ restClient }) => {
  await ensureSystemDefaults(restClient);
});

// ---------------------------------------------------------------------------
// SSO configuration
// ---------------------------------------------------------------------------

test('admin can configure OIDC SSO and see the enabled badge @functional @serial', async ({
  page,
  restClient,
  testData,
}) => {
  const admin = await createTestAdmin(testData, restClient);
  await loginViaBrowser(admin.email, admin.password, { page });

  // Navigate to Settings → Security & Identity tab (SSO moved from Integrations)
  await navigateToAdminSettings({ page }, 'security');

  // Wait for the SSO section to load
  await expectSsoSectionVisible({ page });

  // Select OIDC protocol (default is OIDC so this just verifies the selector)
  await selectSsoProtocol('oidc', { page });

  // Fill in the IdP metadata URL and client ID
  await fillSsoIdpMetadataUrl(OIDC_METADATA_URL, { page });
  await fillSsoEntityId(OIDC_CLIENT_ID, { page });

  // Save (asserts not disabled before clicking)
  await clickSsoSaveButton({ page });

  // Verify save success message
  await expectSsoSaveSuccessVisible({ page });

  // Verify enabled badge appears
  await expectSsoEnabledBadgeVisible({ page });
});

test('SSO login button appears on the login page when SSO is enabled @functional @serial', async ({
  page,
  restClient,
  testData,
}) => {
  void testData;
  // Configure SSO via API (already tested in UI above, so use API here for speed)
  await restClient.put('/api/v1/settings/sso', {
    protocol: 'oidc',
    idp_metadata_url: OIDC_METADATA_URL,
    entity_id: OIDC_CLIENT_ID,
  });

  // Navigate to the login page as an unauthenticated user — the browser context
  // has no session cookie (test.use({ storageState: { cookies: [], origins: [] } })),
  // so the login page renders fully without redirecting away.
  await navigateToLoginPage({ page });

  await expectSsoLoginButtonVisible({ page });
});

test('admin can disable SSO via the confirmation flow @functional @serial', async ({
  page,
  restClient,
  testData,
}) => {
  const admin = await createTestAdmin(testData, restClient);
  await loginViaBrowser(admin.email, admin.password, { page });

  // Navigate to Settings → Security & Identity tab first, then configure SSO via API
  // and reload. Setting SSO before login risks another parallel worker's
  // ensureSystemDefaults() wiping the config during the login round-trip.
  // (SSO moved from Integrations to Security & Identity)
  await navigateToAdminSettings({ page }, 'security');

  await restClient.put('/api/v1/settings/sso', {
    protocol: 'oidc',
    idp_metadata_url: OIDC_METADATA_URL,
    entity_id: OIDC_CLIENT_ID,
  });
  await reloadCurrentPage({ page });

  // Wait for SSO section and verify enabled badge is present
  await expectSsoEnabledBadgeVisible({ page }, 10_000);

  // Click Disable SSO — first click shows confirmation
  await clickSsoDisableButton({ page });

  // Confirmation UI should appear
  await expectSsoDisableConfirmVisible({ page });

  // Confirm disable
  await clickSsoDisableConfirmButton({ page });

  // Enabled badge should disappear
  await expectSsoEnabledBadgeNotVisible({ page });
});

test('SSO login button disappears from the login page after SSO is disabled @functional @serial', async ({
  page,
  restClient,
  testData,
}) => {
  void testData;
  // First enable SSO
  await restClient.put('/api/v1/settings/sso', {
    protocol: 'oidc',
    idp_metadata_url: OIDC_METADATA_URL,
    entity_id: OIDC_CLIENT_ID,
  });

  // Navigate as unauthenticated user (no session cookie in this context).
  await navigateToLoginPage({ page });
  await expectSsoLoginButtonVisible({ page }, 8_000);

  await restClient.delete('/api/v1/settings/sso');

  await reloadCurrentPage({ page });
  await expectSsoLoginButtonNotVisible({ page }, 5_000);
});

test('SSO status API returns correct state after configure and disable cycle @functional @serial', async ({
  restClient,
}) => {
  // Initially disabled
  const initial = await restClient.get<{ enabled: boolean; protocol: string | null }>(
    '/api/v1/settings/sso/status',
  );
  expect(initial.body.enabled).toBe(false);
  expect(initial.body.protocol).toBeNull();

  // Enable
  await restClient.put('/api/v1/settings/sso', {
    protocol: 'saml',
    idp_metadata_url: 'https://idp.example.com/saml/metadata',
    entity_id: 'urn:sp:minicrm',
  });

  const enabled = await restClient.get<{ enabled: boolean; protocol: string | null }>(
    '/api/v1/settings/sso/status',
  );
  expect(enabled.body.enabled).toBe(true);
  expect(enabled.body.protocol).toBe('saml');

  // Disable
  await restClient.delete('/api/v1/settings/sso');

  const disabled = await restClient.get<{ enabled: boolean; protocol: string | null }>(
    '/api/v1/settings/sso/status',
  );
  expect(disabled.body.enabled).toBe(false);
  expect(disabled.body.protocol).toBeNull();
});
