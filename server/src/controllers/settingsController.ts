/**
 * Settings controller — request/response shaping for settings endpoints.
 * No business logic here; all DB access goes through settingsService.
 */

import type { Request, Response } from 'express';
import {
  getDefaultLanguage,
  setDefaultLanguage,
  getNavLayout,
  setNavLayout,
  getEmailNotificationsEnabled,
  setEmailNotificationsEnabled,
} from '../services/settingsService.js';
import {
  setDefaultLanguageSchema,
  setNavLayoutSchema,
} from '@minicrm/shared/schemas/settingsSchema.js';

/**
 * GET /api/settings/default-language
 * Returns the current system-wide default language.
 * Public endpoint — unauthenticated users need this on app load.
 *
 * @param _req - Express request (unused).
 * @param res - Express response.
 */
export async function getDefaultLanguageHandler(_req: Request, res: Response): Promise<void> {
  const language = await getDefaultLanguage();
  res.status(200).json({ language });
}

/**
 * PATCH /api/settings/default-language
 * Updates the system-wide default language. Admin only.
 *
 * @param req - Express request with body `{ language: SupportedLocale }`.
 * @param res - Express response.
 */
export async function setDefaultLanguageHandler(req: Request, res: Response): Promise<void> {
  const parsed = setDefaultLanguageSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: parsed.error.errors[0]?.message ?? 'Invalid request',
      },
    });
    return;
  }

  const language = await setDefaultLanguage(parsed.data.language);
  res.status(200).json({ language });
}

/**
 * GET /api/settings/nav-layout
 * Returns the current system-wide navigation layout.
 * Public endpoint — clients need this before auth to render the shell.
 * (MINCRM-133)
 *
 * @param _req - Express request (unused).
 * @param res - Express response.
 */
export async function getNavLayoutHandler(_req: Request, res: Response): Promise<void> {
  const layout = await getNavLayout();
  res.status(200).json({ layout });
}

/**
 * PATCH /api/settings/nav-layout
 * Updates the system-wide navigation layout. Admin only. (MINCRM-133)
 *
 * @param req - Express request with body `{ layout: NavLayout }`.
 * @param res - Express response.
 */
export async function setNavLayoutHandler(req: Request, res: Response): Promise<void> {
  const parsed = setNavLayoutSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: parsed.error.errors[0]?.message ?? 'Invalid request',
      },
    });
    return;
  }

  const layout = await setNavLayout(parsed.data.layout);
  res.status(200).json({ layout });
}

// ── Email notifications global toggle (MINCRM-163) ───────────────────────────

/**
 * GET /api/settings/email-notifications
 * Returns whether the system-wide email notifications are enabled.
 * Requires authentication (admin sees this in settings page).
 *
 * @param _req - Express request (unused).
 * @param res - Express response.
 */
export async function getEmailNotificationsEnabledHandler(
  _req: Request,
  res: Response,
): Promise<void> {
  const enabled = await getEmailNotificationsEnabled();
  res.status(200).json({ enabled });
}

/**
 * PATCH /api/settings/email-notifications
 * Sets whether the system-wide email notifications are enabled. Admin only. (MINCRM-163)
 *
 * @param req - Express request with body `{ enabled: boolean }`.
 * @param res - Express response.
 */
export async function setEmailNotificationsEnabledHandler(
  req: Request,
  res: Response,
): Promise<void> {
  if (typeof req.body.enabled !== 'boolean') {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: 'enabled must be a boolean' },
    });
    return;
  }

  const enabled = await setEmailNotificationsEnabled(req.body.enabled as boolean);
  res.status(200).json({ enabled });
}
