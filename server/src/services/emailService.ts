/**
 * Email service — sends transactional emails.
 *
 * Transport configuration priority:
 *   1. Database-stored SMTP settings (via smtpSettingsService) when smtp_enabled = true
 *   2. SMTP_* environment variables when SMTP_HOST is set
 *   3. Console/log fallback — no email is delivered
 *
 * This means a UI-configured deployment overrides env vars, and a containerised
 * deployment using env vars continues to work without a DB-stored config.
 *
 *
 */

import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import logger from '../logger.js';
import { getSmtpConfigInternal } from './smtpSettingsService.js';
import { isAuthBypassEnv } from '../utils/nodeEnv.js';
import type { RecordLinkType } from '@minicrm/shared/types/recordPath.js';

/** HTML-escape map for the five characters that can break HTML contexts */
const HTML_ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#x27;',
};

/**
 * Escapes a string for safe interpolation into HTML.
 * All user-supplied data must pass through this before being placed in email templates.
 *
 * @param str - Raw string value from user or DB.
 * @returns HTML-safe string.
 */
export function escapeHtml(str: string): string {
  return str.replace(/[&<>"']/g, (ch) => HTML_ESCAPE_MAP[ch] ?? ch);
}

/** The From address used in all outbound emails (display-name format for the header). */
function getFromAddress(): string {
  return process.env.SMTP_FROM || 'MiniCRM <noreply@minicrm.local>';
}

/**
 * Extracts the bare email address from a From string that may include a display name.
 * Used for the SMTP envelope MAIL FROM command, which requires a plain address.
 * e.g. "MiniCRM <noreply@minicrm.local>" → "noreply@minicrm.local"
 */
function extractEmail(address: string): string {
  const match = address.match(/<([^>]+)>/);
  return match ? match[1] : address;
}

/**
 * Resolves the nodemailer transport for the current request.
 *
 * Priority order:
 *   1. Database SMTP config (smtp_enabled = true and smtp_host set)
 *   2. SMTP_HOST environment variable
 *   3. null → the caller records it as undelivered
 *
 * A fresh transport is created each call so DB changes take effect without a restart.
 *
 * @returns A ready-to-use Transporter, or null when no SMTP source is configured.
 */
async function resolveTransport(): Promise<Transporter | null> {
  // Never use a live transport in test environments — return null so all
  // callers record the message as undelivered regardless of SMTP env vars or DB config.
  if (process.env.NODE_ENV === 'test') return null;

  // 1. Database-stored config takes precedence
  try {
    const dbConfig = await getSmtpConfigInternal();
    if (dbConfig.smtp_enabled && dbConfig.smtp_host) {
      return nodemailer.createTransport({
        host: dbConfig.smtp_host,
        port: dbConfig.smtp_port,
        secure: dbConfig.smtp_port === 465,
        auth:
          dbConfig.smtp_user && dbConfig.smtp_pass
            ? { user: dbConfig.smtp_user, pass: dbConfig.smtp_pass }
            : undefined,
      });
    }
  } catch (err) {
    logger.warn({ err }, 'emailService: failed to read DB SMTP config — falling back to env vars');
  }

  // 2. Environment variable fallback
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (SMTP_HOST) {
    return nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT ? Number(SMTP_PORT) : 587,
      secure: SMTP_PORT === '465',
      auth: SMTP_USER && SMTP_PASS ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
    });
  }

  // 3. No SMTP configured → caller records it as undelivered
  return null;
}

/**
 * Records an email that no transport was configured to send.
 *
 * `secrets` carries reset and invite URLs, which are single-use account-takeover
 * tokens. They are logged only where handing out credentials is already acceptable,
 * which excludes staging — a real deployment with real users, and the reason the
 * split keys on isAuthBypassEnv() rather than on log level.
 *
 * @param what - Human label for the message that was not sent.
 * @param context - Non-sensitive fields, always logged.
 * @param secrets - Credential-bearing fields, logged only in dev and test.
 */
function logNoSmtp(
  what: string,
  context: Record<string, unknown>,
  secrets: Record<string, unknown> = {},
): void {
  // warn, not debug: a dropped notification is an operational event, and production
  // logs at info — a debug line would make the drop invisible exactly where it matters.
  // Redaction is the secrets/context split, not the level.
  logger.warn(
    isAuthBypassEnv() ? { ...context, ...secrets } : context,
    `[NO-SMTP] ${what} not delivered; no transport configured`,
  );
}

/**
 * Sends an email using the resolved transport.
 * Falls back to logging when no SMTP source is configured.
 *
 * @param to - Recipient email address.
 * @param subject - Email subject line.
 * @param html - HTML body content.
 */
async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  const transport = await resolveTransport();

  if (!transport) {
    logNoSmtp('Email', { to, subject });
    return;
  }

  const from = getFromAddress();
  try {
    await transport.sendMail({
      from,
      to,
      subject,
      html,
      // Explicit envelope ensures the SMTP MAIL FROM command uses a bare address,
      // which strict SMTP servers (including Mailhog) require.
      envelope: { from: extractEmail(from), to },
    });
  } catch (err) {
    logger.error({ err, to, subject }, 'emailService: failed to send email');
    throw err;
  }
}

/**
 * Sends a password reset email to the user.
 *
 * With no SMTP transport, the URL is logged only in development and test, where
 * it is the only way to complete the flow. See logNoSmtp.
 *
 * @param email - Recipient email address.
 * @param resetUrl - The full reset URL containing the plaintext token.
 */
export async function sendPasswordResetEmail(email: string, resetUrl: string): Promise<void> {
  const html = `
    <p>You requested a password reset for your MiniCRM account.</p>
    <p><a href="${escapeHtml(resetUrl)}">Click here to reset your password</a></p>
    <p>This link expires in 60 minutes. If you did not request this, you can ignore this email.</p>
  `;

  const transport = await resolveTransport();
  if (!transport) {
    logNoSmtp('Password reset link', { email }, { resetUrl });
    return;
  }

  await sendEmail(email, 'Reset your MiniCRM password', html);
}

/**
 * Sends a user invitation email containing the set-password link.
 *
 * With no SMTP transport, the URL is logged only in development and test, where
 * it is the only way to complete the flow. See logNoSmtp.
 *
 * @param email - Recipient email address.
 * @param name - Recipient's display name.
 * @param setPasswordUrl - The full set-password URL containing the invite token.
 */
export async function sendInviteEmail(
  email: string,
  name: string,
  setPasswordUrl: string,
): Promise<void> {
  const html = `
    <p>Hi ${escapeHtml(name)},</p>
    <p>You have been invited to MiniCRM. Click the link below to set your password and activate your account.</p>
    <p><a href="${escapeHtml(setPasswordUrl)}">Accept invitation and set password</a></p>
    <p>This invitation link expires in 72 hours.</p>
  `;

  const transport = await resolveTransport();
  if (!transport) {
    logNoSmtp('Invite link', { email }, { setPasswordUrl });
    return;
  }

  await sendEmail(email, 'You have been invited to MiniCRM', html);
}

/** A single overdue task item included in the digest email */
export interface OverdueTaskItem {
  /** Activity UUID */
  id: string;
  /** Task subject */
  subject: string;
  /** Due date as an ISO date string (YYYY-MM-DD) */
  due_date: string;
  /** Name of the linked contact, account, or deal */
  linked_record_name: string | null;
  /** URL path to the linked record (e.g. /contacts/uuid) */
  linked_record_path: string | null;
}

/**
 * Sends an overdue task digest email listing all newly-overdue tasks for a user.
 *
 * @param email - Recipient email address.
 * @param name - Recipient's display name.
 * @param tasks - Array of overdue task items to include.
 */
export async function sendOverdueTaskDigest(
  email: string,
  name: string,
  tasks: OverdueTaskItem[],
): Promise<void> {
  const appUrl = process.env.APP_URL ?? 'http://localhost:5173';

  const taskRows = tasks
    .map((task) => {
      const safeName = task.linked_record_name ? escapeHtml(task.linked_record_name) : null;
      const recordLink =
        safeName && task.linked_record_path
          ? `<a href="${appUrl}${escapeHtml(task.linked_record_path)}">${safeName}</a>`
          : (safeName ?? '—');
      return `<tr>
        <td style="padding:6px 12px;border-bottom:1px solid #eee">${escapeHtml(task.subject)}</td>
        <td style="padding:6px 12px;border-bottom:1px solid #eee">${escapeHtml(task.due_date)}</td>
        <td style="padding:6px 12px;border-bottom:1px solid #eee">${recordLink}</td>
      </tr>`;
    })
    .join('');

  const html = `
    <p>Hi ${escapeHtml(name)},</p>
    <p>You have ${tasks.length} overdue task${tasks.length === 1 ? '' : 's'} in MiniCRM:</p>
    <table style="border-collapse:collapse;width:100%;max-width:600px">
      <thead>
        <tr style="background:#f5f5f5">
          <th style="padding:8px 12px;text-align:left">Subject</th>
          <th style="padding:8px 12px;text-align:left">Due Date</th>
          <th style="padding:8px 12px;text-align:left">Record</th>
        </tr>
      </thead>
      <tbody>${taskRows}</tbody>
    </table>
    <p><a href="${appUrl}/tasks">View all tasks</a></p>
    <p style="color:#888;font-size:12px">
      You're receiving this because you have overdue tasks.
      <a href="${appUrl}/profile">Manage notification preferences</a>.
    </p>
  `;

  await sendEmail(
    email,
    `You have ${tasks.length} overdue task${tasks.length === 1 ? '' : 's'}`,
    html,
  );
}

/** A single record assignment notification item */
export interface AssignmentItem {
  /** Record type; constrains the path below to a route the router declares. */
  recordType: RecordLinkType;
  /** Human-readable record name */
  recordName: string;
  /** Build with recordPath(), never by hand — the type is what pins it to a route. */
  recordPath: string;
  /** Display name of the user who performed the assignment */
  assignedByName: string;
}

/**
 * Sends a batched assignment notification email.
 *
 * @param email - Recipient email address.
 * @param name - Recipient's display name.
 * @param items - Array of assignment items to include in the email.
 */
export async function sendAssignmentNotification(
  email: string,
  name: string,
  items: AssignmentItem[],
): Promise<void> {
  const appUrl = process.env.APP_URL ?? 'http://localhost:5173';

  const itemRows = items
    .map(
      (item) => `<li>
        <strong>${escapeHtml(item.recordType)}</strong>:
        <a href="${appUrl}${escapeHtml(item.recordPath)}">${escapeHtml(item.recordName)}</a>
        (assigned by ${escapeHtml(item.assignedByName)})
      </li>`,
    )
    .join('');

  const subject =
    items.length === 1
      ? `${items[0].assignedByName} assigned a ${items[0].recordType} to you`
      : `${items.length} records were assigned to you`;

  const html = `
    <p>Hi ${escapeHtml(name)},</p>
    <p>The following record${items.length === 1 ? ' has' : 's have'} been assigned to you:</p>
    <ul>${itemRows}</ul>
    <p style="color:#888;font-size:12px">
      You're receiving this because you were assigned a record in MiniCRM.
      <a href="${appUrl}/profile">Manage notification preferences</a>.
    </p>
  `;

  await sendEmail(email, subject, html);
}

/** Result of a user-initiated contact email send */
export interface SendContactEmailResult {
  /** Whether the email was actually delivered via SMTP */
  delivered: boolean;
  /** Set when delivered is false */
  reason?: 'smtp_not_configured';
}

/**
 * Sends a user-composed email to a contact.
 * Returns { delivered: false, reason: 'smtp_not_configured' } instead of throwing
 * when no SMTP transport is available — the caller logs an activity either way.
 *
 * @param to - Recipient email address.
 * @param subject - Email subject line (user-supplied).
 * @param body - Plain-text body (user-supplied); will be HTML-escaped.
 * @param sentByName - Display name of the sending rep, shown in the email footer.
 */
export async function sendContactEmail(
  to: string,
  subject: string,
  body: string,
  sentByName: string,
): Promise<SendContactEmailResult> {
  const transport = await resolveTransport();

  if (!transport) {
    logNoSmtp('Contact email', { to, subject });
    return { delivered: false, reason: 'smtp_not_configured' };
  }

  const html = `
    <p>${escapeHtml(body).replace(/\n/g, '<br>')}</p>
    <p style="color:#888;font-size:12px;margin-top:24px">
      Sent by ${escapeHtml(sentByName)} via MiniCRM
    </p>
  `;

  try {
    await transport.sendMail({ from: getFromAddress(), to, subject, html });
    return { delivered: true };
  } catch (err) {
    logger.error({ err, to, subject }, 'emailService: failed to send contact email');
    throw err;
  }
}
