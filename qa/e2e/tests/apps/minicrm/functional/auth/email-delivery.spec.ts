/**
 * F1-EM — Transactional Email Delivery
 *
 * Functional tests that assert transactional emails are actually delivered
 * through the SMTP path to Mailhog. These tests require:
 *   - Mailhog running with SMTP on port 1025 and HTTP API on port 8025
 *   - system_settings seeded with Mailhog SMTP config (seed:e2e-smtp)
 *
 * Covered events:
 *   F1-EM1 — Password reset: forgot-password flow sends email to correct address
 *            containing a reset link
 *   F1-EM2 — User invitation: inviting a new user sends an invite email to the
 *            invited address
 *
 * These tests complement the existing F1-PR and F1-INV token-flow specs. Those
 * specs verify the UI flows using tokens retrieved via API; these specs verify
 * the email delivery path end-to-end.
 *
 * Framework conventions (MINCRM-42, MINCRM-306):
 *   - All tests tagged @functional
 *   - Import test/expect from @apps/minicrm/fixtures.js only
 *   - Mailhog messages cleared before each test to prevent cross-test contamination
 *   - All test data managed via restClient + finally-block teardown
 *   - Tests must pass with --workers=4 (no shared mutable state)
 *
 * MINCRM-306
 */

import { test, expect } from '@apps/minicrm/fixtures.js';
import { MailhogClient, decodeQuotedPrintable } from '@apps/minicrm/mailhogClient.js';
import { loginAsAdmin, forgotPassword } from '@behaviors/minicrm/auth.behaviors.js';
import {
  inviteUserViaApi,
  setUserPassword,
  deactivateUser,
} from '@behaviors/minicrm/users.behaviors.js';

// F1-EM tests exercise unauthenticated flows. Use an empty storageState to
// prevent the project-level admin session from loading.
test.use({ storageState: { cookies: [], origins: [] } });

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const MAILHOG_URL = process.env['MAILHOG_URL'] ?? 'http://localhost:8025';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('@functional F1-EM1: forgot-password — sends reset email to the correct address containing a reset link', async ({
  restClient,
}) => {
  const mailhog = new MailhogClient(MAILHOG_URL);

  // Log in as admin to create a test user.
  await loginAsAdmin(restClient);
  const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const testEmail = `f1-em1-${uniqueSuffix}@example.com`;

  const inviteRes = await inviteUserViaApi(restClient, {
    name: `F1-EM1 User ${uniqueSuffix}`,
    email: testEmail,
    role: 'rep',
  });
  const userId = inviteRes.user.id;

  // Wait for the invite email to arrive before triggering the reset flow —
  // ensures the invite email has landed so the reset email arrives as a second message.
  await mailhog.waitForMessagesTo(testEmail, { maxAttempts: 15, intervalMs: 200 });

  try {
    // Activate the user so they can request a password reset.
    await setUserPassword(restClient, inviteRes.inviteToken, 'InitP@ss1234!');

    // Trigger the forgot-password flow.
    await forgotPassword(restClient, testEmail);

    // Poll until 2 messages arrive (invite + reset). Each test uses a unique
    // address so no clearMessages() is needed — won't collide with parallel tests.
    const messages = await mailhog.waitForMessagesCountTo(testEmail, 2);

    expect(messages.length, 'invite + reset emails should be delivered').toBe(2);

    // The second message is the reset email (first is the invite).
    // Decode quoted-printable — Content.Body and Raw.Data use QP encoding.
    const resetMsg = messages.find((m) => {
      const raw = decodeQuotedPrintable(m.Raw.Data);
      return raw.includes('/reset-password?token=');
    });
    expect(
      resetMsg,
      'a reset email containing a reset-password link should be delivered',
    ).toBeTruthy();
    const body = decodeQuotedPrintable(resetMsg!.Raw.Data);
    expect(body, 'reset email should contain a reset-password link').toContain(
      '/reset-password?token=',
    );
  } finally {
    await loginAsAdmin(restClient).catch(() => null);
    await deactivateUser(restClient, userId).catch((err: unknown) => {
      console.error(`[F1-EM1] teardown failed: ${String(err)}`);
    });
  }
});

test('@functional F1-EM2: user invitation — sends invite email to the invited address', async ({
  restClient,
}) => {
  const mailhog = new MailhogClient(MAILHOG_URL);

  await loginAsAdmin(restClient);

  const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const invitedEmail = `f1-em2-${uniqueSuffix}@example.com`;

  const inviteRes = await inviteUserViaApi(restClient, {
    name: `F1-EM2 User ${uniqueSuffix}`,
    email: invitedEmail,
    role: 'rep',
  });
  const userId = inviteRes.user.id;

  try {
    // Poll Mailhog briefly — the server fires the invite email after responding.
    const messages = await mailhog.waitForMessagesTo(invitedEmail);

    expect(messages.length, 'exactly one invite email should be delivered').toBe(1);

    // Decode quoted-printable — Content.Body and Raw.Data use QP encoding.
    const body = decodeQuotedPrintable(messages[0].Raw.Data);
    expect(body, 'invite email should contain a set-password link').toContain(
      '/set-password?token=',
    );
  } finally {
    await deactivateUser(restClient, userId).catch((err: unknown) => {
      console.error(`[F1-EM2] teardown failed: ${String(err)}`);
    });
  }
});
