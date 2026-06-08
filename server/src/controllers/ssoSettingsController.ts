/**
 * SSO settings controller — request/response shaping for SSO configuration endpoints. (MINCRM-399)
 * No business logic here; all DB access goes through ssoSettingsService and ssoService.
 */

import type { Request, Response } from 'express';
import {
  getSsoConfig,
  getSsoStatus,
  setSsoConfig,
  clearSsoConfig,
} from '../services/ssoSettingsService.js';
import { unlinkAllSsoUsers } from '../services/ssoService.js';
import { setSsoConfigSchema } from '@minicrm/shared/schemas/settingsSchema.js';
import { writeAuditEntryBestEffort } from '../services/auditService.js';
import logger from '../logger.js';

/**
 * GET /api/v1/settings/sso
 * Returns the current SSO configuration. Admin only.
 * Returns null body when SSO is not configured.
 */
export async function getSsoConfigHandler(_req: Request, res: Response): Promise<void> {
  const config = await getSsoConfig();
  res.status(200).json({ sso: config });
}

/**
 * GET /api/v1/settings/sso/status
 * Returns whether SSO is enabled and which protocol is configured.
 * Authenticated but not admin-only — the login page needs this to show/hide the SSO button.
 */
export async function getSsoStatusHandler(_req: Request, res: Response): Promise<void> {
  const status = await getSsoStatus();
  res.status(200).json(status);
}

/**
 * PUT /api/v1/settings/sso
 * Saves SSO configuration and enables SSO. Admin only.
 */
export async function putSsoConfigHandler(req: Request, res: Response): Promise<void> {
  const parsed = setSsoConfigSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: parsed.error.errors[0]?.message ?? 'Invalid request',
      },
    });
    return;
  }

  const saved = await setSsoConfig(parsed.data, { id: req.user!.id, name: req.user!.name });
  res.status(200).json({ sso: saved });

  void writeAuditEntryBestEffort({
    recordType: 'system_settings',
    recordName: 'SSO Configuration',
    eventType: 'updated',
    changedById: req.user!.id,
    changedByName: req.user!.name,
  }).catch((err: unknown) => logger.warn({ err }, 'Failed to write SSO settings audit entry'));
}

/**
 * DELETE /api/v1/settings/sso
 * Clears SSO configuration, disables SSO, and removes SSO bindings from all users. Admin only.
 */
export async function deleteSsoConfigHandler(req: Request, res: Response): Promise<void> {
  // Read the current protocol before clearing, so we can unlink the right users.
  const current = await getSsoConfig();
  const protocol = current?.protocol ?? null;

  await clearSsoConfig();

  if (protocol) {
    const actor = { id: req.user!.id, name: req.user!.name };
    const unlinked = await unlinkAllSsoUsers(protocol, actor);
    logger.info({ protocol, unlinked }, 'ssoSettingsController: unlinked SSO users after disable');
  }

  res.status(200).json({ ok: true });

  void writeAuditEntryBestEffort({
    recordType: 'system_settings',
    recordName: 'SSO Configuration',
    eventType: 'deleted',
    changedById: req.user!.id,
    changedByName: req.user!.name,
  }).catch((err: unknown) => logger.warn({ err }, 'Failed to write SSO disable audit entry'));
}
