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
  getDefaultCurrency,
  setDefaultCurrency,
  getTagsRestrictCreation,
  setTagsRestrictCreation,
  getOnboardingStatus,
  setOnboardingCompleted,
} from '../services/settingsService.js';
import { getCurrencies, updateCurrencies } from '../services/currencyService.js';
import {
  setDefaultLanguageSchema,
  setNavLayoutSchema,
  setDefaultCurrencySchema,
  updateCurrenciesSchema,
  SUPPORTED_CURRENCY_LIST,
} from '@minicrm/shared/schemas/settingsSchema.js';
import { writeAuditEntryBestEffort } from '../services/auditService.js';
import logger from '../logger.js';

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

  const previousLanguage = await getDefaultLanguage();
  const language = await setDefaultLanguage(parsed.data.language);
  res.status(200).json({ language });

  // Audit: system settings updated (MINCRM-170)
  void writeAuditEntryBestEffort({
    recordType: 'system_settings',
    recordName: 'Default Language',
    eventType: 'updated',
    fieldName: 'Default Language',
    oldValue: previousLanguage,
    newValue: language,
    changedById: req.user!.id,
    changedByName: req.user!.name,
  }).catch((err: unknown) => logger.warn({ err }, 'Failed to write settings audit entry'));
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

  const previousLayout = await getNavLayout();
  const layout = await setNavLayout(parsed.data.layout);
  res.status(200).json({ layout });

  // Audit: system settings updated (MINCRM-170)
  void writeAuditEntryBestEffort({
    recordType: 'system_settings',
    recordName: 'Navigation Layout',
    eventType: 'updated',
    fieldName: 'Navigation Layout',
    oldValue: previousLayout,
    newValue: layout,
    changedById: req.user!.id,
    changedByName: req.user!.name,
  }).catch((err: unknown) => logger.warn({ err }, 'Failed to write settings audit entry'));
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

  const previousEnabled = await getEmailNotificationsEnabled();
  const enabled = await setEmailNotificationsEnabled(req.body.enabled as boolean);
  res.status(200).json({ enabled });

  // Audit: system settings updated (MINCRM-170)
  void writeAuditEntryBestEffort({
    recordType: 'system_settings',
    recordName: 'Email Notifications',
    eventType: 'updated',
    fieldName: 'Email Notifications',
    oldValue: String(previousEnabled),
    newValue: String(enabled),
    changedById: req.user!.id,
    changedByName: req.user!.name,
  }).catch((err: unknown) => logger.warn({ err }, 'Failed to write settings audit entry'));
}

// ── Default currency (MINCRM-189) ─────────────────────────────────────────────

/**
 * GET /api/settings/default-currency
 * Returns the current system-wide default currency.
 * Public endpoint — deal create form needs this before auth resolves.
 *
 * @param _req - Express request (unused).
 * @param res - Express response.
 */
export async function getDefaultCurrencyHandler(_req: Request, res: Response): Promise<void> {
  const currency = await getDefaultCurrency();
  res.status(200).json({ currency });
}

/**
 * PATCH /api/settings/default-currency
 * Updates the system-wide default currency. Admin only. (MINCRM-189)
 *
 * @param req - Express request with body `{ currency: SupportedCurrency }`.
 * @param res - Express response.
 */
export async function setDefaultCurrencyHandler(req: Request, res: Response): Promise<void> {
  const parsed = setDefaultCurrencySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: parsed.error.errors[0]?.message ?? 'Invalid request',
      },
    });
    return;
  }

  const previousCurrency = await getDefaultCurrency();
  const currency = await setDefaultCurrency(parsed.data.currency);
  res.status(200).json({ currency });

  void writeAuditEntryBestEffort({
    recordType: 'system_settings',
    recordName: 'Default Currency',
    eventType: 'updated',
    fieldName: 'Default Currency',
    oldValue: previousCurrency,
    newValue: currency,
    changedById: req.user!.id,
    changedByName: req.user!.name,
  }).catch((err: unknown) => logger.warn({ err }, 'Failed to write settings audit entry'));
}

// ── Tag creation restriction (MINCRM-263) ────────────────────────────────────

/**
 * GET /api/settings/tags-restrict-creation
 * Returns whether tag creation is restricted to the Tag Management page.
 * Requires authentication — rep callers need this to know whether to show
 * the "create new tag" option in inline tag inputs.
 *
 * @param _req - Express request (unused).
 * @param res - Express response.
 */
export async function getTagsRestrictCreationHandler(_req: Request, res: Response): Promise<void> {
  const restricted = await getTagsRestrictCreation();
  res.status(200).json({ restricted });
}

/**
 * PATCH /api/settings/tags-restrict-creation
 * Sets whether tag creation is restricted. Admin only. (MINCRM-263)
 *
 * @param req - Express request with body `{ restricted: boolean }`.
 * @param res - Express response.
 */
export async function setTagsRestrictCreationHandler(req: Request, res: Response): Promise<void> {
  if (typeof req.body.restricted !== 'boolean') {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: 'restricted must be a boolean' },
    });
    return;
  }

  const previousRestricted = await getTagsRestrictCreation();
  const restricted = await setTagsRestrictCreation(req.body.restricted as boolean);
  res.status(200).json({ restricted });

  void writeAuditEntryBestEffort({
    recordType: 'system_settings',
    recordName: 'Tag Creation Restriction',
    eventType: 'updated',
    fieldName: 'Tag Creation Restriction',
    oldValue: String(previousRestricted),
    newValue: String(restricted),
    changedById: req.user!.id,
    changedByName: req.user!.name,
  }).catch((err: unknown) => logger.warn({ err }, 'Failed to write settings audit entry'));
}

// ── Exchange rates (MINCRM-251) ───────────────────────────────────────────────

/**
 * GET /api/settings/currencies
 * Returns the full currency configuration including home currency and all rates.
 * Requires authentication.
 *
 * @param _req - Express request (unused).
 * @param res  - Express response.
 */
export async function getCurrenciesHandler(_req: Request, res: Response): Promise<void> {
  const config = await getCurrencies();
  res.status(200).json(config);
}

/**
 * PUT /api/settings/currencies
 * Atomically replaces the non-home currency set and sets the home currency.
 * Admin only. (MINCRM-251)
 *
 * @param req - Express request with body `{ home_currency, currencies }`.
 * @param res - Express response.
 */
export async function updateCurrenciesHandler(req: Request, res: Response): Promise<void> {
  const parsed = updateCurrenciesSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: parsed.error.errors[0]?.message ?? 'Invalid request',
      },
    });
    return;
  }

  // Resolve display name and symbol for the home currency from the known list
  const homeInfo = SUPPORTED_CURRENCY_LIST.find((c) => c.code === parsed.data.home_currency);
  const homeName = homeInfo?.name ?? parsed.data.home_currency;
  const homeSymbol = homeInfo?.symbol ?? parsed.data.home_currency;

  await updateCurrencies(parsed.data, homeName, homeSymbol);
  const config = await getCurrencies();
  res.status(200).json(config);
}

// ── Onboarding (MINCRM-256) ───────────────────────────────────────────────────

/**
 * GET /api/settings/onboarding
 * Returns first-run detection status and onboarding_completed flag. Admin only.
 *
 * @param _req - Express request (unused).
 * @param res  - Express response.
 */
export async function getOnboardingStatusHandler(_req: Request, res: Response): Promise<void> {
  const status = await getOnboardingStatus();
  res.status(200).json(status);
}

/**
 * PUT /api/settings/onboarding
 * Updates the onboarding_completed flag. Admin only. (MINCRM-256)
 *
 * @param req - Express request with body `{ onboarding_completed: boolean }`.
 * @param res - Express response.
 */
export async function setOnboardingCompletedHandler(req: Request, res: Response): Promise<void> {
  if (typeof req.body.onboarding_completed !== 'boolean') {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: 'onboarding_completed must be a boolean' },
    });
    return;
  }

  const completed = await setOnboardingCompleted(req.body.onboarding_completed as boolean);
  res.status(200).json({ onboarding_completed: completed });

  void writeAuditEntryBestEffort({
    recordType: 'system_settings',
    recordName: 'Onboarding',
    eventType: 'updated',
    fieldName: 'onboarding_completed',
    oldValue: String(!completed),
    newValue: String(completed),
    changedById: req.user!.id,
    changedByName: req.user!.name,
  }).catch((err: unknown) => logger.warn({ err }, 'Failed to write onboarding audit entry'));
}
