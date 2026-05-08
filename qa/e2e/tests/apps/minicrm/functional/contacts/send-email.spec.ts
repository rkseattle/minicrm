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
import { MailhogClient } from '@apps/minicrm/mailhogClient.js';
import { createTestContact, navigateToContact } from '@apps/minicrm/helpers.js';
import { ContactDetailPage } from '@pages/minicrm/ContactDetailPage.js';

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const ADMIN_EMAIL = process.env['E2E_ADMIN_EMAIL'] ?? 'admin@example.com';
const ADMIN_PASSWORD = process.env['E2E_ADMIN_PASSWORD'];
if (!ADMIN_PASSWORD) throw new Error('[SENDEMAIL] E2E_ADMIN_PASSWORD is not set');

const MAILHOG_URL = process.env['MAILHOG_URL'] ?? 'http://localhost:8025';

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
    const mailhog = new MailhogClient(MAILHOG_URL);

    const contact = await createTestContact(testData, restClient, {
      first_name: 'EmailTest',
      last_name: 'User',
    });

    await navigateToContact(page, contact.id);

    const detailPage = new ContactDetailPage({ page });

    // Send Email button should be visible for a contact with an email address
    const sendEmailButton = await detailPage.sendEmailButtonLocator();
    await sendEmailButton!.waitFor({ state: 'visible', timeout: 10_000 });

    // Open the compose modal
    await detailPage.clickSendEmail();

    // Modal should appear
    const modal = await detailPage.sendEmailModalLocator();
    await modal!.waitFor({ state: 'visible', timeout: 5_000 });

    // Fill in subject and body
    await detailPage.fillSendEmailSubject('Test email subject from E2E');
    await detailPage.fillSendEmailBody('This is the email body written by the E2E test.');

    // Click Send
    await detailPage.submitSendEmail();

    // Success message appears; must say "sent to" not "logged" — confirms SMTP delivered.
    const successMsg = await detailPage.sendEmailSuccessLocator();
    await successMsg!.waitFor({ state: 'visible', timeout: 10_000 });
    const successText = (await successMsg!.textContent()) ?? '';
    expect(successText, 'success message should confirm SMTP delivery, not log fallback').toContain(
      'Email sent to',
    );

    // Modal should auto-close
    await modal!.waitFor({ state: 'detached', timeout: 5_000 });

    // Poll Mailhog — the server sends email asynchronously after responding
    const messages = await mailhog.waitForMessagesTo(contact.email);

    expect(messages.length, 'exactly one email should be delivered via SMTP').toBe(1);
    expect(
      messages[0].Content.Headers['Subject']?.[0],
      'delivered email subject should match the composed subject',
    ).toBe('Test email subject from E2E');

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

    const detailPage = new ContactDetailPage({ page });
    const button = await detailPage.sendEmailButtonLocator();
    await button!.waitFor({ state: 'visible', timeout: 10_000 });
    expect(await button!.isVisible(), 'Send Email button should be visible').toBe(true);
  },
);
