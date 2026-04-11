/**
 * Email service — sends transactional emails.
 *
 * In development / test mode this is a stub that logs the email details to the
 * console instead of delivering them. Configure a real transport by setting the
 * SMTP_* environment variables (future work).
 *
 * MINCRM-156
 */

import logger from '../logger.js';

/**
 * Sends a password reset email to the user.
 *
 * In dev/test: logs the reset URL to the console so developers can copy it
 * directly without needing an SMTP server.
 * In production: would deliver the email via the configured SMTP transport.
 *
 * @param email - Recipient email address.
 * @param resetUrl - The full reset URL containing the plaintext token.
 */
export async function sendPasswordResetEmail(email: string, resetUrl: string): Promise<void> {
  if (process.env.NODE_ENV !== 'production') {
    // Dev/test stub — print the link so it can be used without a mail server.
    logger.info(
      { email, resetUrl },
      '[DEV] Password reset requested. Copy the link below to proceed:',
    );
    // Also write to stdout so it surfaces clearly in docker-compose logs.
    console.log(`\n[DEV] Password reset link for ${email}:\n  ${resetUrl}\n`);
    return;
  }

  // Production: wire up a real SMTP transport here (nodemailer, SendGrid, etc.)
  // This path is intentionally unreachable until a transport is configured.
  logger.warn(
    { email },
    'sendPasswordResetEmail: no production transport configured — email not delivered',
  );
}
