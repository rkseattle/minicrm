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

// F1-EM tests exercise unauthenticated flows. Use an empty storageState to
// prevent the project-level admin session from loading.
test.use({ storageState: { cookies: [], origins: [] } });

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const ADMIN_EMAIL = process.env['E2E_ADMIN_EMAIL'] ?? 'admin@example.com';
const ADMIN_PASSWORD = process.env['E2E_ADMIN_PASSWORD'];
if (!ADMIN_PASSWORD) throw new Error('[F1-EM] E2E_ADMIN_PASSWORD is not set');

const MAILHOG_URL = process.env['MAILHOG_URL'] ?? 'http://localhost:8025';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface InviteResponse {
  user: { id: string; email: string };
  inviteToken: string;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('@functional F1-EM1: forgot-password — sends reset email to the correct address containing a reset link', async ({
  restClient,
}) => {
  const mailhog = new MailhogClient(MAILHOG_URL);

  await mailhog.clearMessages();

  // Log in as admin to create a test user.
  await restClient.post('/api/v1/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const testEmail = `f1-em1-${uniqueSuffix}@example.com`;

  const inviteRes = await restClient.post<InviteResponse>('/api/v1/users/invite', {
    name: `F1-EM1 User ${uniqueSuffix}`,
    email: testEmail,
    role: 'rep',
  });
  const userId = inviteRes.body.user.id;

  // Wait for the fire-and-forget invite email to arrive, then clear so only
  // the reset email counts. Poll until the invite email lands before clearing
  // to avoid a race where the invite email arrives after our clear.
  await mailhog.waitForMessagesTo(testEmail, { maxAttempts: 15, intervalMs: 200 });
  await mailhog.clearMessages();

  try {
    // Activate the user so they can request a password reset.
    await restClient.post('/api/v1/users/set-password', {
      token: inviteRes.body.inviteToken,
      password: 'InitPass1!',
    });

    // Trigger the forgot-password flow.
    await restClient.post('/api/v1/auth/forgot-password', { email: testEmail });

    // Poll Mailhog briefly — the server sends the email asynchronously after responding.
    const messages = await mailhog.waitForMessagesTo(testEmail);

    expect(messages.length, 'exactly one reset email should be delivered').toBe(1);

    // Decode quoted-printable — Content.Body and Raw.Data use QP encoding.
    const body = decodeQuotedPrintable(messages[0].Raw.Data);
    expect(body, 'reset email should contain a reset-password link').toContain(
      '/reset-password?token=',
    );
  } finally {
    await restClient
      .post('/api/v1/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
      .catch(() => null);
    await restClient.patch(`/api/v1/users/${userId}/deactivate`).catch((err: unknown) => {
      console.error(`[F1-EM1] teardown failed: ${String(err)}`);
    });
  }
});

test('@functional F1-EM2: user invitation — sends invite email to the invited address', async ({
  restClient,
}) => {
  const mailhog = new MailhogClient(MAILHOG_URL);

  await mailhog.clearMessages();

  await restClient.post('/api/v1/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });

  const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const invitedEmail = `f1-em2-${uniqueSuffix}@example.com`;

  const inviteRes = await restClient.post<InviteResponse>('/api/v1/users/invite', {
    name: `F1-EM2 User ${uniqueSuffix}`,
    email: invitedEmail,
    role: 'rep',
  });
  const userId = inviteRes.body.user.id;

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
    await restClient.patch(`/api/v1/users/${userId}/deactivate`).catch((err: unknown) => {
      console.error(`[F1-EM2] teardown failed: ${String(err)}`);
    });
  }
});
