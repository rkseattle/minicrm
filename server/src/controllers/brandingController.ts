/**
 * Branding controller — request/response shaping for branding settings endpoints.
 * No business logic here; all DB access goes through brandingService. (MINCRM-356)
 */

import type { Request, Response } from 'express';
import { getBranding, setBranding, deleteBranding } from '../services/brandingService.js';
import { setBrandingSchema } from '@minicrm/shared/schemas/brandingSchema.js';
import { writeAuditEntryBestEffort } from '../services/auditService.js';
import logger from '../logger.js';

/**
 * GET /api/settings/branding
 * Returns the current branding config, or { branding: null } if none is configured.
 * Public endpoint — unauthenticated callers need this so the login page reflects branding.
 */
export async function getBrandingHandler(_req: Request, res: Response): Promise<void> {
  const branding = await getBranding();
  res.status(200).json({ branding });
}

/**
 * PUT /api/settings/branding
 * Merges and persists branding configuration. Admin only.
 */
export async function putBrandingHandler(req: Request, res: Response): Promise<void> {
  const parsed = setBrandingSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: parsed.error.errors[0]?.message ?? 'Invalid request',
      },
    });
    return;
  }

  const branding = await setBranding(parsed.data);
  res.status(200).json({ branding });

  void writeAuditEntryBestEffort({
    recordType: 'system_settings',
    recordName: 'Branding',
    eventType: 'updated',
    changedById: req.user!.id,
    changedByName: req.user!.name,
  }).catch((err: unknown) => logger.warn({ err }, 'Failed to write branding audit entry'));
}

/**
 * DELETE /api/settings/branding
 * Resets all branding to defaults. Admin only.
 */
export async function deleteBrandingHandler(req: Request, res: Response): Promise<void> {
  await deleteBranding();
  res.status(200).json({ branding: null });

  void writeAuditEntryBestEffort({
    recordType: 'system_settings',
    recordName: 'Branding',
    eventType: 'deleted',
    changedById: req.user!.id,
    changedByName: req.user!.name,
  }).catch((err: unknown) => logger.warn({ err }, 'Failed to write branding audit entry'));
}
