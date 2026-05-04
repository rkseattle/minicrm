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
import { login } from '@behaviors/minicrm/auth.behaviors.js';
import type { RestClient } from '@framework/clients/rest-client.js';

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const ADMIN_EMAIL = process.env['E2E_ADMIN_EMAIL'] ?? 'admin@example.com';
const ADMIN_PASSWORD = process.env['E2E_ADMIN_PASSWORD'];
if (!ADMIN_PASSWORD) throw new Error('[webhooks-spec] E2E_ADMIN_PASSWORD is not set');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface WebhookSubscription {
  id: string;
  url: string;
  events: string[];
  status: 'active' | 'failed' | 'disabled';
  created_by: string;
  created_at: string;
}

interface WebhookSubscriptionsResponse {
  subscriptions: WebhookSubscription[];
}

interface WebhookCreateResponse {
  subscription: WebhookSubscription;
  plaintextSecret: string;
}

interface DeliveryLog {
  id: string;
  subscription_id: string | null;
  event_type: string;
  attempt: number;
  status_code: number | null;
  error: string | null;
  delivered_at: string;
}

interface DeliveryLogsResponse {
  data: DeliveryLog[];
  total: number;
  page: number;
  limit: number;
}

// ---------------------------------------------------------------------------
// Polling helper
// ---------------------------------------------------------------------------

const MAX_POLL_MS = 8_000;
const INITIAL_BACKOFF_MS = 200;

/**
 * Polls GET /api/admin/webhooks/:id/logs until a log entry matching the given
 * event type appears, using exponential backoff.
 */
async function pollForDeliveryLog(
  restClient: RestClient,
  subscriptionId: string,
  eventType: string,
): Promise<DeliveryLog> {
  const deadline = Date.now() + MAX_POLL_MS;
  let backoff = INITIAL_BACKOFF_MS;
  let attempt = 0;

  while (Date.now() < deadline) {
    attempt++;
    await new Promise((resolve) => setTimeout(resolve, backoff));
    backoff = Math.min(backoff * 2, 2_000);

    const response = await restClient.get<DeliveryLogsResponse>(
      `/api/v1/admin/webhooks/${subscriptionId}/logs?limit=10`,
    );
    const match = response.body.data.find((log) => log.event_type === eventType);
    if (match) return match;
  }

  throw new Error(
    `[pollForDeliveryLog] No delivery log for event "${eventType}" on subscription ` +
      `"${subscriptionId}" after ${attempt} attempts (${MAX_POLL_MS}ms).`,
  );
}

// ---------------------------------------------------------------------------
// WH-01 – Admin sees Webhooks section
// ---------------------------------------------------------------------------

test('@functional WH-01: admin sees the Webhooks section in Settings → Integrations', async ({
  page,
}) => {
  await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD! }, { page });

  await page.goto('/admin/settings?tab=integrations', { waitUntil: 'networkidle' });

  const section = await page
    .locate([
      { type: 'testId', value: 'webhook-settings-section' },
      { type: 'css', value: '[data-testid="webhook-settings-section"]' },
    ])
    .resolve();
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
  await restClient.post('/api/v1/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD! }, { page });

  await page.goto('/admin/settings?tab=integrations', { waitUntil: 'networkidle' });

  const urlInput = await page
    .locate([
      { type: 'testId', value: 'webhook-url-input' },
      { type: 'role', value: 'textbox' },
    ])
    .resolve();
  await urlInput.fill('https://wh02.example.com/hook');

  // Select the contact.created event
  await page.click([{ type: 'testId', value: 'webhook-event-contact.created' }]);

  await page.click([{ type: 'testId', value: 'webhook-add-button' }]);

  // Secret reveal modal should appear
  const modal = await page
    .locate([
      { type: 'testId', value: 'webhook-secret-reveal' },
      { type: 'css', value: '[data-testid="webhook-secret-reveal"]' },
    ])
    .resolve();
  await expect(modal).toBeVisible({ timeout: 8_000 });

  // Secret value should be non-empty
  const secretInput = await page
    .locate([
      { type: 'testId', value: 'webhook-secret-value' },
      { type: 'css', value: '[data-testid="webhook-secret-value"]' },
    ])
    .resolve();
  const secretValue = await secretInput.inputValue();
  expect(secretValue.length, 'plaintextSecret should be non-empty').toBeGreaterThan(0);

  // Close the modal
  await page.click([{ type: 'testId', value: 'webhook-secret-done-button' }]);

  // Find and register the newly created subscription for teardown
  const listResp = await restClient.get<WebhookSubscriptionsResponse>('/api/v1/admin/webhooks');
  const created = listResp.body.subscriptions.find(
    (s) => s.url === 'https://wh02.example.com/hook',
  );
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
  await restClient.post('/api/v1/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

  const suffix = Date.now().toString();
  const hookUrl = `https://wh03-${suffix}.example.com/hook`;

  const createResp = await restClient.post<WebhookCreateResponse>('/api/v1/admin/webhooks', {
    url: hookUrl,
    events: ['deal.won', 'deal.lost'],
  });
  const sub = createResp.body.subscription;
  testData.register('webhook_subscription', sub.id, `/api/v1/admin/webhooks/${sub.id}`);

  await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD! }, { page });
  await page.goto('/admin/settings?tab=integrations', { waitUntil: 'networkidle' });

  const row = await page
    .locate([
      { type: 'testId', value: `webhook-row-${sub.id}` },
      { type: 'css', value: `[data-testid="webhook-row-${sub.id}"]` },
    ])
    .resolve();
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
  await restClient.post('/api/v1/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

  const suffix = Date.now().toString();
  const hookUrl = `https://wh04-${suffix}.example.com/hook`;

  const createResp = await restClient.post<WebhookCreateResponse>('/api/v1/admin/webhooks', {
    url: hookUrl,
    events: ['account.created'],
  });
  const sub = createResp.body.subscription;
  testData.register('webhook_subscription', sub.id, `/api/v1/admin/webhooks/${sub.id}`);

  await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD! }, { page });
  await page.goto('/admin/settings?tab=integrations', { waitUntil: 'networkidle' });

  const row = await page
    .locate([
      { type: 'testId', value: `webhook-row-${sub.id}` },
      { type: 'css', value: `[data-testid="webhook-row-${sub.id}"]` },
    ])
    .resolve();
  await expect(row).toBeVisible({ timeout: 8_000 });

  // Click Disable toggle
  await page.click([{ type: 'testId', value: `webhook-toggle-button-${sub.id}` }]);

  // Status badge should now show Disabled
  await expect(row).toContainText('Disabled', { timeout: 6_000 });
});

// ---------------------------------------------------------------------------
// WH-05 – Delete subscription
// ---------------------------------------------------------------------------

test('@functional WH-05: delete subscription → removed from list', async ({ restClient, page }) => {
  await restClient.post('/api/v1/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

  const suffix = Date.now().toString();
  const hookUrl = `https://wh05-${suffix}.example.com/hook`;

  const createResp = await restClient.post<WebhookCreateResponse>('/api/v1/admin/webhooks', {
    url: hookUrl,
    events: ['contact.deleted'],
  });
  const sub = createResp.body.subscription;
  // Do NOT register for auto-teardown — the test itself deletes it via UI

  await login({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD! }, { page });
  await page.goto('/admin/settings?tab=integrations', { waitUntil: 'networkidle' });

  const row = await page
    .locate([
      { type: 'testId', value: `webhook-row-${sub.id}` },
      { type: 'css', value: `[data-testid="webhook-row-${sub.id}"]` },
    ])
    .resolve();
  await expect(row).toBeVisible({ timeout: 8_000 });

  // Click Delete
  await page.click([{ type: 'testId', value: `webhook-delete-button-${sub.id}` }]);

  // Confirm dialog appears
  const dialog = await page
    .locate([
      { type: 'testId', value: 'webhook-delete-confirm' },
      { type: 'role', value: 'dialog' },
    ])
    .resolve();
  await expect(dialog).toBeVisible();

  // Confirm deletion
  await page.click([{ type: 'testId', value: 'webhook-delete-confirm-button' }]);

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
  await restClient.post('/api/v1/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

  // Create a webhook subscribed to contact.created pointing at httpbin (any valid URL —
  // we only verify the log was written, not that the target accepted it)
  const suffix = Date.now().toString();
  const createResp = await restClient.post<WebhookCreateResponse>('/api/v1/admin/webhooks', {
    url: `https://httpbin.org/anything/wh06-${suffix}`,
    events: ['contact.created'],
  });
  const sub = createResp.body.subscription;
  testData.register('webhook_subscription', sub.id, `/api/v1/admin/webhooks/${sub.id}`);

  // Create a contact to fire the contact.created event
  const contactResp = await restClient.post<{ contact: { id: string } }>('/api/v1/contacts', {
    first_name: 'WH06',
    last_name: `Contact-${suffix}`,
    email: `wh06-${suffix}@example.com`,
    owner_id: (await restClient.get<{ user: { id: string } }>('/api/v1/auth/me')).body.user.id,
  });
  const contactId = contactResp.body.contact.id;
  testData.register('contact', contactId, `/api/v1/contacts/${contactId}`);

  // Poll until a delivery log entry for contact.created appears
  const log = await pollForDeliveryLog(restClient, sub.id, 'contact.created');

  expect(log.event_type, 'delivery log should record event type').toBe('contact.created');
  // A log entry was written (status_code may be null if target was unreachable — that's OK)
  expect(log.id, 'delivery log should have an ID').toBeTruthy();
});
