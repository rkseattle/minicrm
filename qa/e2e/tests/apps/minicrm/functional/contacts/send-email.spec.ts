/**
 * F-SENDEMAIL — Send Email from Contact Detail Page
 *
 * Functional E2E tests for MINCRM-275: outbound email composition from
 * ContactDetailPage. Tests cover the send flow (with activity logging) and
 * confirm the Send Email button only appears when the contact has an email.
 *
 * Note: The "button absent for no-email contact" guard cannot be tested via
 * the REST API in E2E because the server requires email on creation.
 * That path is covered by server unit tests (contactController: 400 NO_EMAIL).
 * The E2E spec covers the happy path and the button-visible condition.
 *
 * MINCRM-275
 */

import { test, expect } from '@apps/minicrm/fixtures.js';
import { createTestContact, navigateToContact } from '@apps/minicrm/helpers.js';

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const ADMIN_EMAIL = process.env['E2E_ADMIN_EMAIL'] ?? 'admin@example.com';
const ADMIN_PASSWORD = process.env['E2E_ADMIN_PASSWORD'];
if (!ADMIN_PASSWORD) throw new Error('[SENDEMAIL] E2E_ADMIN_PASSWORD is not set');

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

test.beforeAll(async ({ restClient }) => {
  await restClient.post('/api/v1/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test(
  'Send Email button opens modal, user fills fields, submits, success message appears, and Email activity is logged',
  { tag: ['@functional'] },
  async ({ page, testData, restClient }) => {
    const contact = await createTestContact(testData, restClient, {
      first_name: 'EmailTest',
      last_name: 'User',
    });

    await navigateToContact(page, contact.id);

    // Send Email button should be visible for a contact with an email address
    const sendEmailButton = await page
      .locate([
        { type: 'testId', value: 'send-email-button' },
        { type: 'css', value: '[data-testid="send-email-button"]' },
      ])
      .resolve();
    await sendEmailButton.waitFor({ state: 'visible', timeout: 10_000 });

    // Open the compose modal
    await page.click([{ type: 'testId', value: 'send-email-button' }]);

    // Modal should appear
    const modal = await page
      .locate([
        { type: 'testId', value: 'send-email-modal' },
        { type: 'role', value: 'dialog' },
      ])
      .resolve();
    await modal.waitFor({ state: 'visible', timeout: 5_000 });

    // Fill in subject and body
    await page.fill('Test email subject from E2E', [
      { type: 'testId', value: 'send-email-subject' },
    ]);
    await page.fill('This is the email body written by the E2E test.', [
      { type: 'testId', value: 'send-email-body' },
    ]);

    // Click Send
    await page.click([{ type: 'testId', value: 'send-email-submit' }]);

    // Success message should appear (SMTP not configured in test env → "Email logged" message)
    const successMsg = await page
      .locate([
        { type: 'testId', value: 'send-email-success' },
        { type: 'css', value: '[data-testid="send-email-success"]' },
      ])
      .resolve();
    await successMsg.waitFor({ state: 'visible', timeout: 10_000 });

    // Modal should auto-close
    await modal.waitFor({ state: 'detached', timeout: 5_000 });

    // Verify the Email activity was logged via the API
    const activitiesRes = await restClient.get<{
      data: Array<{ id: string; type: string; subject: string; direction: string }>;
      total: number;
    }>(`/api/v1/activities?contact=${contact.id}`);

    const emailActivities = activitiesRes.body.data.filter((a) => a.type === 'Email');
    expect(emailActivities.length, 'at least one Email activity should be logged').toBeGreaterThan(
      0,
    );
    expect(emailActivities[0].subject, 'activity subject should match the composed subject').toBe(
      'Test email subject from E2E',
    );
    expect(emailActivities[0].direction, 'direction should be Outbound').toBe('Outbound');
  },
);

test(
  'Send Email button is present for a contact with an email address',
  { tag: ['@functional'] },
  async ({ page, testData, restClient }) => {
    // Verifies that the button renders when contact.email is set.
    // The complementary guard (button absent when email is empty) is covered by
    // the server unit test POST /api/contacts/:id/send-email → 400 NO_EMAIL and
    // the client SendEmailModal unit test (button not rendered when email is falsy).
    const contact = await createTestContact(testData, restClient, {
      first_name: 'HasEmail',
      last_name: 'Contact',
    });

    await navigateToContact(page, contact.id);

    const button = await page
      .locate([
        { type: 'testId', value: 'send-email-button' },
        { type: 'css', value: '[data-testid="send-email-button"]' },
      ])
      .resolve();
    await button.waitFor({ state: 'visible', timeout: 10_000 });
    expect(await button.isVisible(), 'Send Email button should be visible').toBe(true);
  },
);
