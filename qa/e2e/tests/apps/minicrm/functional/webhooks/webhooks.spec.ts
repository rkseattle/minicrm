/**
 * Webhook subscription functional tests.
 *
 * Tests:
 *   WH-01  Admin sees the Webhooks section in Settings → Integrations
 *   WH-02  Create webhook → secret modal appears with a non-empty secret value
 *   WH-03  Subscription appears in the list (correct URL, events, active status)
 *   WH-04  Disable subscription → status badge shows Disabled
 *   WH-05  Delete subscription → removed from list
 *   WH-06  Create contact via API → delivery log for contact.created appears (polling)
 *
 * Framework conventions:
 *   - All tests tagged @functional
 *   - Import test/expect from @apps/minicrm/fixtures.js only
 *   - All test data managed via restClient + testData.register (auto teardown)
 *   - No app-domain strings in framework layer
 */

import { test, expect } from '@apps/minicrm/fixtures.js';
import {
  loginAsAdmin,
  loginViaBrowser,
  getCurrentUser,
} from '@behaviors/minicrm/auth.behaviors.js';
import { createTestAdmin, withFlags } from '@apps/minicrm/helpers.js';
import { createContactViaApi } from '@behaviors/minicrm/contacts.behaviors.js';
import {
  createWebhookSubscription,
  listWebhookSubscriptions,
  pollForWebhookDelivery,
} from '@behaviors/minicrm/setup.behaviors.js';
import {
  expectAdminSettingsWebhookSectionVisible,
  fillAdminSettingsWebhookUrl,
  clickAdminSettingsWebhookEvent,
  clickAdminSettingsAddWebhook,
  expectAdminSettingsWebhookSecretRevealVisible,
  getAdminSettingsWebhookSecretValue,
  closeAdminSettingsWebhookSecretModal,
  expectAdminSettingsWebhookRowVisible,
  expectAdminSettingsWebhookRowContainsText,
  expectAdminSettingsWebhookRowNotVisible,
  toggleAdminSettingsWebhook,
  clickAdminSettingsDeleteWebhook,
  expectAdminSettingsWebhookDeleteConfirmVisible,
  confirmAdminSettingsDeleteWebhook,
  navigateToAdminSettingsIntegrations,
} from '@behaviors/minicrm/settings.behaviors.js';

test.use({ storageState: { cookies: [], origins: [] } });

// ---------------------------------------------------------------------------
// WH-01 – Admin sees Webhooks section
// ---------------------------------------------------------------------------

test('@functional WH-01: admin sees the Webhooks section in Settings → Integrations', async ({
  page,
  restClient,
  testData,
}) => {
  await loginAsAdmin(restClient);
  const admin = await createTestAdmin(testData, restClient);
  await withFlags(page, { webhooks: true });
  await loginViaBrowser(admin.email, admin.password, { page });

  await navigateToAdminSettingsIntegrations({ page });

  await expectAdminSettingsWebhookSectionVisible({ page }, 10_000);
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
  const admin = await createTestAdmin(testData, restClient);
  await withFlags(page, { webhooks: true });
  await loginViaBrowser(admin.email, admin.password, { page });

  await navigateToAdminSettingsIntegrations({ page });

  await fillAdminSettingsWebhookUrl('https://example.com/hook/wh02', { page });

  // Select the contact.created event
  await clickAdminSettingsWebhookEvent('contact.created', { page });

  await clickAdminSettingsAddWebhook({ page });

  // Secret reveal modal should appear
  await expectAdminSettingsWebhookSecretRevealVisible({ page }, 8_000);

  // Secret value should be non-empty
  const secretValue = await getAdminSettingsWebhookSecretValue({ page });
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

  const admin = await createTestAdmin(testData, restClient);
  await withFlags(page, { webhooks: true });
  await loginViaBrowser(admin.email, admin.password, { page });
  await navigateToAdminSettingsIntegrations({ page });

  await expectAdminSettingsWebhookRowVisible(sub.id, { page }, 8_000);

  // URL is displayed in the row
  await expectAdminSettingsWebhookRowContainsText(sub.id, hookUrl, { page });
  // Events are listed
  await expectAdminSettingsWebhookRowContainsText(sub.id, 'deal.won', { page });
  // Status badge shows active
  await expectAdminSettingsWebhookRowContainsText(sub.id, 'Active', { page });
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

  const admin = await createTestAdmin(testData, restClient);
  await withFlags(page, { webhooks: true });
  await loginViaBrowser(admin.email, admin.password, { page });
  await navigateToAdminSettingsIntegrations({ page });

  await expectAdminSettingsWebhookRowVisible(sub.id, { page }, 8_000);

  // Click Disable toggle
  await toggleAdminSettingsWebhook(sub.id, { page });

  // Status badge should now show Disabled
  await expectAdminSettingsWebhookRowContainsText(sub.id, 'Disabled', { page }, 6_000);
});

// ---------------------------------------------------------------------------
// WH-05 – Delete subscription
// ---------------------------------------------------------------------------

test('@functional WH-05: delete subscription → removed from list', async ({
  restClient,
  testData,
  page,
}) => {
  await loginAsAdmin(restClient);

  const suffix = Date.now().toString();
  const hookUrl = `https://example.com/hook/wh05-${suffix}`;

  const { subscription: sub } = await createWebhookSubscription(restClient, {
    url: hookUrl,
    events: ['contact.deleted'],
  });
  // Do NOT register for auto-teardown — the test itself deletes it via UI

  const admin = await createTestAdmin(testData, restClient);
  await withFlags(page, { webhooks: true });
  await loginViaBrowser(admin.email, admin.password, { page });
  await navigateToAdminSettingsIntegrations({ page });

  await expectAdminSettingsWebhookRowVisible(sub.id, { page }, 8_000);

  // Click Delete
  await clickAdminSettingsDeleteWebhook(sub.id, { page });

  // Confirm dialog appears
  await expectAdminSettingsWebhookDeleteConfirmVisible({ page });

  // Confirm deletion
  await confirmAdminSettingsDeleteWebhook({ page });

  // Row should disappear
  await expectAdminSettingsWebhookRowNotVisible(sub.id, { page }, 6_000);
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

  // Poll until a delivery log entry for contact.created appears.
  // maxMs must exceed DELIVERY_TIMEOUT_MS (10 s) + dispatch overhead: the log is
  // written after attemptDelivery() returns (success or timeout), so 8 s is too
  // tight when httpbin.org is slow under CI load.
  const log = await pollForWebhookDelivery(restClient, sub.id, 'contact.created', {
    maxMs: 20_000,
  });

  expect(log.event_type, 'delivery log should record event type').toBe('contact.created');
  // A log entry was written (status_code may be null if target was unreachable — that's OK)
  expect(log.id, 'delivery log should have an ID').toBeTruthy();
});
