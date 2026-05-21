/**
 * Webhook subscription functional tests. (MINCRM-279)
 *
 * Tests:
 *   WH-01  Admin sees the Webhooks section in Settings → Integrations
 *   WH-02  Create webhook → secret modal appears with a non-empty secret value
 *   WH-03  Subscription appears in the list (correct URL, events, active status)
 *   WH-04  Disable subscription → status badge shows Disabled
 *   WH-05  Delete subscription → removed from list
 *   WH-06  Create contact via API → delivery log for contact.created appears (polling)
 *
 * Framework conventions (MINCRM-42):
 *   - All tests tagged @functional
 *   - Import test/expect from @apps/minicrm/fixtures.js only
 *   - All test data managed via restClient + testData.register (auto teardown)
 *   - No app-domain strings in framework layer
 */

import { test, expect } from '@apps/minicrm/fixtures.js';
import { login, loginAsAdmin, getCurrentUser } from '@behaviors/minicrm/auth.behaviors.js';
import { createContactViaApi } from '@behaviors/minicrm/contacts.behaviors.js';
import {
  createWebhookSubscription,
  listWebhookSubscriptions,
  pollForWebhookDelivery,
} from '@behaviors/minicrm/setup.behaviors.js';
import {
  getAdminSettingsWebhookSectionLocator,
  getAdminSettingsWebhookUrlInputLocator,
  clickAdminSettingsWebhookEvent,
  clickAdminSettingsAddWebhook,
  getAdminSettingsWebhookSecretRevealLocator,
  getAdminSettingsWebhookSecretValueLocator,
  closeAdminSettingsWebhookSecretModal,
  getAdminSettingsWebhookRowLocator,
  toggleAdminSettingsWebhook,
  clickAdminSettingsDeleteWebhook,
  getAdminSettingsWebhookDeleteConfirmLocator,
  confirmAdminSettingsDeleteWebhook,
} from '@behaviors/minicrm/settings.behaviors.js';

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const ADMIN_EMAIL = process.env['E2E_ADMIN_EMAIL'] ?? 'admin@example.com';
const ADMIN_PASSWORD = process.env['E2E_ADMIN_PASSWORD'];
if (!ADMIN_PASSWORD) throw new Error('[webhooks-spec] E2E_ADMIN_PASSWORD is not set');

// ---------------------------------------------------------------------------
// WH-01 – Admin sees Webhooks section
// ---------------------------------------------------------------------------

test('@functional WH-01: admin sees the Webhooks section in Settings → Integrations', async ({
  page,
}) => {
  await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD! }, { page });

  await page.goto('/admin/settings?tab=integrations', { waitUntil: 'networkidle' });

  const section = await getAdminSettingsWebhookSectionLocator({ page });
  await expect(section).toBeVisible({ timeout: 10_000 });
});

// ---------------------------------------------------------------------------
// WH-02 – Create webhook → secret modal
// ---------------------------------------------------------------------------

test('@functional WH-02: create webhook subscription → secret modal appears', async ({
  page,
  restClient,
  testData,
}) => {
  await loginAsAdmin(restClient);
  await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD! }, { page });

  await page.goto('/admin/settings?tab=integrations', { waitUntil: 'networkidle' });

  const urlInput = await getAdminSettingsWebhookUrlInputLocator({ page });
  await urlInput.fill('https://example.com/hook/wh02');

  // Select the contact.created event
  await clickAdminSettingsWebhookEvent('contact.created', { page });

  await clickAdminSettingsAddWebhook({ page });

  // Secret reveal modal should appear
  const modal = await getAdminSettingsWebhookSecretRevealLocator({ page });
  await expect(modal).toBeVisible({ timeout: 8_000 });

  // Secret value should be non-empty
  const secretInput = await getAdminSettingsWebhookSecretValueLocator({ page });
  const secretValue = await secretInput.inputValue();
  expect(secretValue.length, 'plaintextSecret should be non-empty').toBeGreaterThan(0);

  // Close the modal
  await closeAdminSettingsWebhookSecretModal({ page });

  // Find and register the newly created subscription for teardown
  const subscriptions = await listWebhookSubscriptions(restClient);
  const created = subscriptions.find((s) => s.url === 'https://example.com/hook/wh02');
  if (created) {
    testData.register('webhook_subscription', created.id, `/api/v1/admin/webhooks/${created.id}`);
  }
});

// ---------------------------------------------------------------------------
// WH-03 – Subscription appears in the list
// ---------------------------------------------------------------------------

test('@functional WH-03: created subscription appears in the list with correct details', async ({
  restClient,
  testData,
  page,
}) => {
  await loginAsAdmin(restClient);

  const suffix = Date.now().toString();
  const hookUrl = `https://example.com/hook/wh03-${suffix}`;

  const { subscription: sub } = await createWebhookSubscription(restClient, {
    url: hookUrl,
    events: ['deal.won', 'deal.lost'],
  });
  testData.register('webhook_subscription', sub.id, `/api/v1/admin/webhooks/${sub.id}`);

  await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD! }, { page });
  await page.goto('/admin/settings?tab=integrations', { waitUntil: 'networkidle' });

  const row = await getAdminSettingsWebhookRowLocator(sub.id, { page });
  await expect(row).toBeVisible({ timeout: 8_000 });

  // URL is displayed in the row
  await expect(row).toContainText(hookUrl);
  // Events are listed
  await expect(row).toContainText('deal.won');
  // Status badge shows active
  await expect(row).toContainText('Active');
});

// ---------------------------------------------------------------------------
// WH-04 – Disable subscription
// ---------------------------------------------------------------------------

test('@functional WH-04: disable subscription → status shows Disabled', async ({
  restClient,
  testData,
  page,
}) => {
  await loginAsAdmin(restClient);

  const suffix = Date.now().toString();
  const hookUrl = `https://example.com/hook/wh04-${suffix}`;

  const { subscription: sub } = await createWebhookSubscription(restClient, {
    url: hookUrl,
    events: ['account.created'],
  });
  testData.register('webhook_subscription', sub.id, `/api/v1/admin/webhooks/${sub.id}`);

  await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD! }, { page });
  await page.goto('/admin/settings?tab=integrations', { waitUntil: 'networkidle' });

  const row = await getAdminSettingsWebhookRowLocator(sub.id, { page });
  await expect(row).toBeVisible({ timeout: 8_000 });

  // Click Disable toggle
  await toggleAdminSettingsWebhook(sub.id, { page });

  // Status badge should now show Disabled
  await expect(row).toContainText('Disabled', { timeout: 6_000 });
});

// ---------------------------------------------------------------------------
// WH-05 – Delete subscription
// ---------------------------------------------------------------------------

test('@functional WH-05: delete subscription → removed from list', async ({ restClient, page }) => {
  await loginAsAdmin(restClient);

  const suffix = Date.now().toString();
  const hookUrl = `https://example.com/hook/wh05-${suffix}`;

  const { subscription: sub } = await createWebhookSubscription(restClient, {
    url: hookUrl,
    events: ['contact.deleted'],
  });
  // Do NOT register for auto-teardown — the test itself deletes it via UI

  await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD! }, { page });
  await page.goto('/admin/settings?tab=integrations', { waitUntil: 'networkidle' });

  const row = await getAdminSettingsWebhookRowLocator(sub.id, { page });
  await expect(row).toBeVisible({ timeout: 8_000 });

  // Click Delete
  await clickAdminSettingsDeleteWebhook(sub.id, { page });

  // Confirm dialog appears
  const dialog = await getAdminSettingsWebhookDeleteConfirmLocator({ page });
  await expect(dialog).toBeVisible();

  // Confirm deletion
  await confirmAdminSettingsDeleteWebhook({ page });

  // Row should disappear
  await expect(row).not.toBeVisible({ timeout: 6_000 });
});

// ---------------------------------------------------------------------------
// WH-06 – End-to-end delivery: create contact → log appears
// ---------------------------------------------------------------------------

test('@functional WH-06: create contact via API → contact.created log appears for subscription', async ({
  restClient,
  testData,
}) => {
  await loginAsAdmin(restClient);

  // Create a webhook subscribed to contact.created pointing at httpbin (any valid URL —
  // we only verify the log was written, not that the target accepted it)
  const suffix = Date.now().toString();
  const { subscription: sub } = await createWebhookSubscription(restClient, {
    url: `https://httpbin.org/anything/wh06-${suffix}`,
    events: ['contact.created'],
  });
  testData.register('webhook_subscription', sub.id, `/api/v1/admin/webhooks/${sub.id}`);

  // Resolve the admin user's ID for the contact owner_id field
  const currentUser = await getCurrentUser(restClient);

  // Create a contact to fire the contact.created event
  const contact = await createContactViaApi(restClient, {
    first_name: 'WH06',
    last_name: `Contact-${suffix}`,
    email: `wh06-${suffix}@example.com`,
    owner_id: currentUser.id,
  });
  const contactId = contact.id;
  testData.register('contact', contactId, `/api/v1/contacts/${contactId}`);

  // Poll until a delivery log entry for contact.created appears
  const log = await pollForWebhookDelivery(restClient, sub.id, 'contact.created');

  expect(log.event_type, 'delivery log should record event type').toBe('contact.created');
  // A log entry was written (status_code may be null if target was unreachable — that's OK)
  expect(log.id, 'delivery log should have an ID').toBeTruthy();
});
