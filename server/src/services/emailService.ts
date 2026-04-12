/**
 * Email service — sends transactional emails.
 *
 * In development / test mode this is a stub that logs the email details to the
 * console instead of delivering them. Configure a real transport by setting the
 * SMTP_* environment variables.
 *
 * MINCRM-156, MINCRM-161, MINCRM-162
 */

import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import logger from '../logger.js';

/** Lazily-created transport instance — null until first use */
let _transport: Transporter | null = null;

/**
 * Returns the configured nodemailer transport, creating it on first call.
 * In dev/test, returns null to trigger the stub path.
 */
function getTransport(): Transporter | null {
  if (process.env.NODE_ENV !== 'production') return null;

  if (!_transport) {
    const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
    if (!SMTP_HOST) {
      logger.warn('emailService: SMTP_HOST not set — emails will not be delivered');
      return null;
    }
    _transport = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT ? Number(SMTP_PORT) : 587,
      secure: SMTP_PORT === '465',
      auth: SMTP_USER && SMTP_PASS ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
    });
  }

  return _transport;
}

/** The From address used in all outbound emails */
function getFromAddress(): string {
  return process.env.SMTP_FROM ?? 'MiniCRM <noreply@minicrm.local>';
}

/**
 * Sends an email using the configured transport.
 * In dev/test, logs the message instead of delivering it.
 *
 * @param to - Recipient email address.
 * @param subject - Email subject line.
 * @param html - HTML body content.
 */
async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  const transport = getTransport();

  if (!transport) {
    // Dev/test stub — print to stdout so it surfaces in logs.
    logger.info({ to, subject }, '[DEV] Email (not delivered):');
    console.log(`\n[DEV] Email to ${to}:\n  Subject: ${subject}\n  Body (HTML):\n${html}\n`);
    return;
  }

  try {
    await transport.sendMail({ from: getFromAddress(), to, subject, html });
  } catch (err) {
    logger.error({ err, to, subject }, 'emailService: failed to send email');
    throw err;
  }
}

/**
 * Sends a password reset email to the user.
 *
 * In dev/test: logs the reset URL to the console so developers can copy it
 * directly without needing an SMTP server.
 *
 * @param email - Recipient email address.
 * @param resetUrl - The full reset URL containing the plaintext token.
 */
export async function sendPasswordResetEmail(email: string, resetUrl: string): Promise<void> {
  if (process.env.NODE_ENV !== 'production') {
    logger.info(
      { email, resetUrl },
      '[DEV] Password reset requested. Copy the link below to proceed:',
    );
    console.log(`\n[DEV] Password reset link for ${email}:\n  ${resetUrl}\n`);
    return;
  }

  const html = `
    <p>You requested a password reset for your MiniCRM account.</p>
    <p><a href="${resetUrl}">Click here to reset your password</a></p>
    <p>This link expires in 60 minutes. If you did not request this, you can ignore this email.</p>
  `;

  await sendEmail(email, 'Reset your MiniCRM password', html);
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
      const recordLink =
        task.linked_record_name && task.linked_record_path
          ? `<a href="${appUrl}${task.linked_record_path}">${task.linked_record_name}</a>`
          : (task.linked_record_name ?? '—');
      return `<tr>
        <td style="padding:6px 12px;border-bottom:1px solid #eee">${task.subject}</td>
        <td style="padding:6px 12px;border-bottom:1px solid #eee">${task.due_date}</td>
        <td style="padding:6px 12px;border-bottom:1px solid #eee">${recordLink}</td>
      </tr>`;
    })
    .join('');

  const html = `
    <p>Hi ${name},</p>
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
  /** Record type: 'contact' | 'account' | 'deal' */
  recordType: string;
  /** Human-readable record name */
  recordName: string;
  /** URL path to the record (e.g. /contacts/uuid) */
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
        <strong>${item.recordType}</strong>:
        <a href="${appUrl}${item.recordPath}">${item.recordName}</a>
        (assigned by ${item.assignedByName})
      </li>`,
    )
    .join('');

  const subject =
    items.length === 1
      ? `${items[0].assignedByName} assigned a ${items[0].recordType} to you`
      : `${items.length} records were assigned to you`;

  const html = `
    <p>Hi ${name},</p>
    <p>The following record${items.length === 1 ? ' has' : 's have'} been assigned to you:</p>
    <ul>${itemRows}</ul>
    <p style="color:#888;font-size:12px">
      You're receiving this because you were assigned a record in MiniCRM.
      <a href="${appUrl}/profile">Manage notification preferences</a>.
    </p>
  `;

  await sendEmail(email, subject, html);
}
