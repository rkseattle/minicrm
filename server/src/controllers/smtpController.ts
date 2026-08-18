/**
 * SMTP settings controller — request/response shaping for SMTP endpoints.
 * No business logic here; all DB access goes through smtpSettingsService.
 */

import type { Request, Response } from 'express';
import { z } from 'zod';
import nodemailer from 'nodemailer';
import {
  getSmtpConfig,
  setSmtpConfig,
  getSmtpConfigInternal,
} from '../services/smtpSettingsService.js';
import { writeAuditEntryBestEffort } from '../services/auditService.js';
import logger from '../logger.js';

// ── Validation schemas ────────────────────────────────────────────────────────

const putSmtpSchema = z.object({
  smtp_host: z.string().max(253),
  smtp_port: z.number().int().min(1).max(65535),
  smtp_user: z.string().max(254),
  smtp_pass: z.string().max(1024).optional(),
  smtp_enabled: z.boolean(),
});

const testSmtpSchema = z.object({
  to: z.string().email(),
});

// ── Handlers ──────────────────────────────────────────────────────────────────

/**
 * GET /api/settings/smtp
 * Returns current SMTP configuration. smtp_pass is never included.
 * Accessible by admin and rep roles.
 */
export async function getSmtpConfigHandler(_req: Request, res: Response): Promise<void> {
  const config = await getSmtpConfig();
  res.status(200).json(config);
}

/**
 * PUT /api/settings/smtp
 * Updates SMTP configuration. Admin only.
 * If smtp_pass is absent from the payload the stored password is preserved.
 */
export async function putSmtpConfigHandler(req: Request, res: Response): Promise<void> {
  const parsed = putSmtpSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: parsed.error.errors[0]?.message ?? 'Invalid request',
      },
    });
    return;
  }

  const saved = await setSmtpConfig(parsed.data);
  res.status(200).json(saved);

  void writeAuditEntryBestEffort({
    recordType: 'system_settings',
    recordName: 'SMTP Configuration',
    eventType: 'updated',
    changedById: req.user!.id,
    changedByName: req.user!.name,
  }).catch((err: unknown) => logger.warn({ err }, 'Failed to write SMTP settings audit entry'));
}

/**
 * POST /api/settings/smtp/test
 * Sends a test email using the current saved SMTP configuration. Admin only.
 * Returns { success: true } or { success: false, error: string }.
 * The response is always HTTP 200 — the SMTP outcome is in the payload.
 */
export async function testSmtpHandler(req: Request, res: Response): Promise<void> {
  const parsed = testSmtpSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: parsed.error.errors[0]?.message ?? 'Invalid request',
      },
    });
    return;
  }

  const config = await getSmtpConfigInternal();

  if (!config.smtp_host) {
    res.status(200).json({ success: false, error: 'SMTP host is not configured.' });
    return;
  }

  if (!config.smtp_enabled) {
    res.status(200).json({ success: false, error: 'SMTP is currently disabled.' });
    return;
  }

  const transport = nodemailer.createTransport({
    host: config.smtp_host,
    port: config.smtp_port,
    secure: config.smtp_port === 465,
    auth:
      config.smtp_user && config.smtp_pass
        ? { user: config.smtp_user, pass: config.smtp_pass }
        : undefined,
  });

  const timestamp = new Date().toISOString();
  const html = `
    <p>This is a configuration test email sent by MiniCRM.</p>
    <ul>
      <li><strong>Sending host:</strong> ${config.smtp_host}</li>
      <li><strong>Timestamp:</strong> ${timestamp}</li>
    </ul>
    <p style="color:#888;font-size:12px">
      If you received this email, your SMTP configuration is working correctly.
    </p>
  `;

  try {
    await transport.sendMail({
      from: process.env.SMTP_FROM ?? 'MiniCRM <noreply@minicrm.local>',
      to: parsed.data.to,
      subject: 'MiniCRM SMTP Test',
      html,
    });
    res.status(200).json({ success: true });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn({ err, to: parsed.data.to }, 'smtpController: test send failed');
    res.status(200).json({ success: false, error: message });
  }
}
