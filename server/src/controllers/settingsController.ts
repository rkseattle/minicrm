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
  getDefaultTimezone,
  setDefaultTimezone,
  getTagsRestrictCreation,
  setTagsRestrictCreation,
  getOnboardingStatus,
  setOnboardingCompleted,
  resetPipelineStagesReviewed,
  getMfaRequired,
  setMfaRequired,
} from '../services/settingsService.js';
import { getCurrencies, updateCurrencies } from '../services/currencyService.js';
import {
  setDefaultLanguageSchema,
  setNavLayoutSchema,
  setDefaultCurrencySchema,
  setDefaultTimezoneSchema,
  updateCurrenciesSchema,
  SUPPORTED_CURRENCY_LIST,
} from '@minicrm/shared/schemas/settingsSchema.js';
import { writeAuditEntryBestEffort } from '../services/auditService.js';
import { getAllVisibilityPolicies, updateVisibilityConfig } from '../services/visibilityService.js';
import { updateVisibilityConfigSchema } from '@minicrm/shared/schemas/visibilitySchema.js';
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

  const actor = { id: req.user!.id, name: req.user!.name };
  const previousLanguage = await getDefaultLanguage();
  const language = await setDefaultLanguage(parsed.data.language, actor);
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

  const actor = { id: req.user!.id, name: req.user!.name };
  const previousLayout = await getNavLayout();
  const layout = await setNavLayout(parsed.data.layout, actor);
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

  const actor = { id: req.user!.id, name: req.user!.name };
  const previousEnabled = await getEmailNotificationsEnabled();
  const enabled = await setEmailNotificationsEnabled(req.body.enabled as boolean, actor);
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

  const actor = { id: req.user!.id, name: req.user!.name };
  const previousCurrency = await getDefaultCurrency();
  const currency = await setDefaultCurrency(parsed.data.currency, actor);
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

// ── Default timezone (MINCRM-470) ─────────────────────────────────────────────

/**
 * GET /api/settings/default-timezone
 * Returns the current system-wide default display timezone.
 * Public endpoint — the follow-up timing suggestion card needs this before auth resolves.
 *
 * @param _req - Express request (unused).
 * @param res - Express response.
 */
export async function getDefaultTimezoneHandler(_req: Request, res: Response): Promise<void> {
  const timezone = await getDefaultTimezone();
  res.status(200).json({ timezone });
}

/**
 * PATCH /api/settings/default-timezone
 * Updates the system-wide default display timezone. Admin only. (MINCRM-470)
 *
 * @param req - Express request with body `{ timezone: string }`.
 * @param res - Express response.
 */
export async function setDefaultTimezoneHandler(req: Request, res: Response): Promise<void> {
  const parsed = setDefaultTimezoneSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: parsed.error.errors[0]?.message ?? 'Invalid request',
      },
    });
    return;
  }

  const actor = { id: req.user!.id, name: req.user!.name };
  const previousTimezone = await getDefaultTimezone();
  const timezone = await setDefaultTimezone(parsed.data.timezone, actor);
  res.status(200).json({ timezone });

  void writeAuditEntryBestEffort({
    recordType: 'system_settings',
    recordName: 'Default Timezone',
    eventType: 'updated',
    fieldName: 'Default Timezone',
    oldValue: previousTimezone,
    newValue: timezone,
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

  const actor = { id: req.user!.id, name: req.user!.name };
  const previousRestricted = await getTagsRestrictCreation();
  const restricted = await setTagsRestrictCreation(req.body.restricted as boolean, actor);
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

  void writeAuditEntryBestEffort({
    recordType: 'system_settings',
    recordName: 'Currencies',
    eventType: 'updated',
    fieldName: 'currencies',
    newValue: `home: ${parsed.data.home_currency}, ${parsed.data.currencies.length} non-home currencies`,
    changedById: req.user!.id,
    changedByName: req.user!.name,
  }).catch((err: unknown) => logger.warn({ err }, 'Failed to write settings audit entry'));
}

// ── Onboarding (MINCRM-256) ───────────────────────────────────────────────────

/**
 * GET /api/settings/onboarding
 * Returns first-run detection status and onboarding_completed flag.
 * Visible to both admin and rep users (MINCRM-410).
 *
 * @param req - Express request.
 * @param res - Express response.
 */
export async function getOnboardingStatusHandler(req: Request, res: Response): Promise<void> {
  const status = await getOnboardingStatus({
    id: req.user!.id,
    role: req.user!.role as 'admin' | 'rep',
  });
  res.status(200).json(status);
}

/**
 * PUT /api/settings/onboarding
 * Updates the onboarding_completed flag for the calling user. (MINCRM-256, MINCRM-410)
 * Available to all authenticated users — writes to the caller's own user row.
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

  // Non-admin users may only dismiss their own checklist (true), not re-open it (false).
  // Admins can reset any user's checklist via POST /api/v1/users/:id/reset-onboarding.
  if (!req.body.onboarding_completed && req.user!.role !== 'admin') {
    res.status(403).json({
      error: {
        code: 'FORBIDDEN',
        message: 'Only admins can reset the onboarding checklist',
      },
    });
    return;
  }

  const completed = await setOnboardingCompleted(
    req.user!.id,
    req.body.onboarding_completed as boolean,
  );
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

/**
 * DELETE /api/v1/settings/pipeline-stages-reviewed
 * Clears the pipeline_stages_reviewed flag so the onboarding task reappears.
 * Admin only. Primarily used by E2E test setup (ensureSystemDefaults). (MINCRM-410)
 */
export async function deletePipelineStagesReviewedHandler(
  _req: Request,
  res: Response,
): Promise<void> {
  await resetPipelineStagesReviewed();
  res.status(204).end();
}

// ── MFA enforcement (MINCRM-392) ──────────────────────────────────────────────

/**
 * GET /api/v1/settings/mfa-required
 * Returns whether org-wide MFA enforcement is active. Admin only.
 */
export async function getMfaRequiredHandler(_req: Request, res: Response): Promise<void> {
  const required = await getMfaRequired();
  res.status(200).json({ mfa_required: required });
}

/**
 * PATCH /api/v1/settings/mfa-required
 * Sets the org-wide MFA enforcement flag. Admin only.
 */
export async function setMfaRequiredHandler(req: Request, res: Response): Promise<void> {
  if (typeof req.body.mfa_required !== 'boolean') {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: 'mfa_required must be a boolean' },
    });
    return;
  }

  const actor = { id: req.user!.id, name: req.user!.name };
  const previous = await getMfaRequired();
  const current = await setMfaRequired(req.body.mfa_required as boolean, actor);
  res.status(200).json({ mfa_required: current });

  void writeAuditEntryBestEffort({
    recordType: 'system_settings',
    recordName: 'MFA Enforcement',
    eventType: 'updated',
    fieldName: 'mfa_required',
    oldValue: String(previous),
    newValue: String(current),
    changedById: req.user!.id,
    changedByName: req.user!.name,
  }).catch((err: unknown) => logger.warn({ err }, 'Failed to write MFA settings audit entry'));
}

/**
 * GET /api/settings/visibility
 * Returns the current per-object-type data visibility policies.
 * Accessible to admin and manager roles. (MINCRM-538)
 */
export async function getVisibilityConfigHandler(_req: Request, res: Response): Promise<void> {
  const config = await getAllVisibilityPolicies();
  res.status(200).json({ visibility: config });
}

/**
 * PUT /api/settings/visibility
 * Updates one or more per-object-type visibility policies. Admin only. (MINCRM-538)
 */
export async function putVisibilityConfigHandler(req: Request, res: Response): Promise<void> {
  const parsed = updateVisibilityConfigSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: parsed.error.errors[0].message },
    });
    return;
  }

  const actor = { id: req.user!.id, name: req.user!.name };
  const config = await updateVisibilityConfig(parsed.data, actor);
  res.status(200).json({ visibility: config });
}
