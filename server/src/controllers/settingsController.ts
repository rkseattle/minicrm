/**
 * Settings controller — request/response shaping for settings endpoints.
 * No business logic here; all DB access goes through settingsService.
 */

import type { Request, Response } from 'express';
import { getDefaultLanguage, setDefaultLanguage } from '../services/settingsService.js';
import { setDefaultLanguageSchema } from '@minicrm/shared/schemas/settingsSchema.js';

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
      error: { code: 'VALIDATION_ERROR', message: parsed.error.errors[0]?.message },
    });
    return;
  }

  const language = await setDefaultLanguage(parsed.data.language);
  res.status(200).json({ language });
}
