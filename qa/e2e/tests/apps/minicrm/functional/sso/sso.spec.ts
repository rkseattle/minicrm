/**
 * SSO functional tests — SAML 2.0 / OIDC single sign-on. (MINCRM-399)
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
 * MINCRM-399
 */

import { test, expect } from '@apps/minicrm/fixtures.js';
import { loginAsAdmin, loginViaBrowser } from '@behaviors/minicrm/auth.behaviors.js';
import { createTestAdmin } from '@apps/minicrm/helpers.js';
import { reloadCurrentPage } from '@behaviors/minicrm/nav.behaviors.js';
import {
  ensureSystemDefaults,
  navigateToAdminSettings,
  getSsoSectionLocator,
  getSsoProtocolSelectLocator,
  getSsoIdpMetadataUrlInputLocator,
  getSsoEntityIdInputLocator,
  getSsoSaveButtonLocator,
  getSsoEnabledBadgeLocator,
  getSsoDisableButtonLocator,
  getSsoDisableConfirmButtonLocator,
  getSsoSaveSuccessLocator,
  navigateToLoginPageForSso as navigateToLoginPage,
  getSsoLoginButtonLocator,
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

  // Navigate to Settings → Security & Identity tab (SSO moved from Integrations, MINCRM-563)
  await navigateToAdminSettings({ page }, 'security');

  // Wait for the SSO section to load
  const ssoSection = await getSsoSectionLocator({ page });
  await expect(ssoSection).toBeVisible({ timeout: 10_000 });

  // Select OIDC protocol (default is OIDC so this just verifies the selector)
  const protocolSelect = await getSsoProtocolSelectLocator({ page });
  await protocolSelect.selectOption('oidc');

  // Fill in the IdP metadata URL and client ID
  const metadataUrlInput = await getSsoIdpMetadataUrlInputLocator({ page });
  await metadataUrlInput.fill(OIDC_METADATA_URL);

  const entityIdInput = await getSsoEntityIdInputLocator({ page });
  await entityIdInput.fill(OIDC_CLIENT_ID);

  // Save
  const saveButton = await getSsoSaveButtonLocator({ page });
  await expect(saveButton).not.toBeDisabled();
  await saveButton.click();

  // Verify save success message
  const saveSuccess = await getSsoSaveSuccessLocator({ page });
  await expect(saveSuccess).toBeVisible({ timeout: 8_000 });

  // Verify enabled badge appears
  const badge = await getSsoEnabledBadgeLocator({ page });
  await expect(badge).toBeVisible({ timeout: 5_000 });
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

  const ssoButton = await getSsoLoginButtonLocator({ page });
  await expect(ssoButton).toBeVisible({ timeout: 8_000 });
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
  // (SSO moved from Integrations to Security & Identity, MINCRM-563)
  await navigateToAdminSettings({ page }, 'security');

  await restClient.put('/api/v1/settings/sso', {
    protocol: 'oidc',
    idp_metadata_url: OIDC_METADATA_URL,
    entity_id: OIDC_CLIENT_ID,
  });
  await reloadCurrentPage({ page });

  // Wait for SSO section and verify enabled badge is present
  const badge = await getSsoEnabledBadgeLocator({ page });
  await expect(badge).toBeVisible({ timeout: 10_000 });

  // Click Disable SSO — first click shows confirmation
  const disableButton = await getSsoDisableButtonLocator({ page });
  await disableButton.click();

  // Confirmation UI should appear
  const confirmButton = await getSsoDisableConfirmButtonLocator({ page });
  await expect(confirmButton).toBeVisible({ timeout: 5_000 });

  // Confirm disable
  await confirmButton.click();

  // Enabled badge should disappear
  await expect(badge).not.toBeVisible({ timeout: 8_000 });
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
  const ssoButton = await getSsoLoginButtonLocator({ page });
  await expect(ssoButton).toBeVisible({ timeout: 8_000 });

  await restClient.delete('/api/v1/settings/sso');

  await reloadCurrentPage({ page });
  await expect(ssoButton).not.toBeVisible({ timeout: 5_000 });
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
