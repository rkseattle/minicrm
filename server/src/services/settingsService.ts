/**
 * Settings service — all database operations related to system settings.
 * Business logic belongs here. Controllers must not query the database directly.
 */

import pool from '../db.js';
import logger from '../logger.js';
import {
  SUPPORTED_LOCALES,
  NAV_LAYOUTS,
  SUPPORTED_CURRENCIES,
} from '@minicrm/shared/schemas/settingsSchema.js';
import type {
  SupportedLocale,
  NavLayout,
  SupportedCurrency,
} from '@minicrm/shared/schemas/settingsSchema.js';

/** A row from the system_settings table */
interface SystemSettingRow {
  key: string;
  value: string;
  updated_at: Date;
}

/** The key used to store the default language setting */
const DEFAULT_LANGUAGE_KEY = 'default_language';

/** The key used to store the navigation layout setting (MINCRM-133) */
const NAV_LAYOUT_KEY = 'nav_layout';

/** The key used to store the global email notifications enabled setting (MINCRM-163) */
const EMAIL_NOTIFICATIONS_ENABLED_KEY = 'email_notifications_enabled';

/** The key used to store the default currency setting (MINCRM-189) */
const DEFAULT_CURRENCY_KEY = 'default_currency';

/** The key used to store the tag creation restriction setting (MINCRM-263) */
const TAGS_RESTRICT_CREATION_KEY = 'tags_restrict_creation';

/** The key used to store the onboarding completed flag (MINCRM-256) */
const ONBOARDING_COMPLETED_KEY = 'onboarding_completed';

/** The key used to track that the admin reviewed/saved pipeline stages (MINCRM-379) */
const PIPELINE_STAGES_REVIEWED_KEY = 'pipeline_stages_reviewed';

/**
 * Retrieves the current system-wide default language.
 * Falls back to 'en' if the row is somehow missing.
 *
 * @returns The stored default language code.
 */
export async function getDefaultLanguage(): Promise<SupportedLocale> {
  const result = await pool.query<SystemSettingRow>(
    'SELECT value FROM system_settings WHERE key = $1 LIMIT 1',
    [DEFAULT_LANGUAGE_KEY],
  );
  if (!result.rows[0]) {
    logger.warn('system_settings row for default_language is missing — falling back to en');
    return 'en';
  }
  const raw = result.rows[0].value;
  if (!(SUPPORTED_LOCALES as readonly string[]).includes(raw)) {
    logger.warn(`system_settings default_language '${raw}' is unsupported — falling back to en`);
    return 'en';
  }
  return raw as SupportedLocale;
}

/**
 * Persists a new system-wide default language.
 *
 * @param language - One of the supported locale codes.
 * @returns The updated language code.
 */
export async function setDefaultLanguage(language: SupportedLocale): Promise<SupportedLocale> {
  await pool.query(
    `INSERT INTO system_settings (key, value, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [DEFAULT_LANGUAGE_KEY, language],
  );
  return language;
}

/**
 * Retrieves the current system-wide navigation layout.
 * Falls back to 'top' if the row is somehow missing. (MINCRM-133)
 *
 * @returns The stored nav layout value.
 */
export async function getNavLayout(): Promise<NavLayout> {
  const result = await pool.query<SystemSettingRow>(
    'SELECT value FROM system_settings WHERE key = $1 LIMIT 1',
    [NAV_LAYOUT_KEY],
  );
  if (!result.rows[0]) {
    logger.warn('system_settings row for nav_layout is missing — falling back to top');
    return 'top';
  }
  const raw = result.rows[0].value;
  if (!(NAV_LAYOUTS as readonly string[]).includes(raw)) {
    logger.warn(`system_settings nav_layout '${raw}' is unsupported — falling back to top`);
    return 'top';
  }
  return raw as NavLayout;
}

/**
 * Persists a new system-wide navigation layout. (MINCRM-133)
 *
 * @param layout - One of the supported nav layout values.
 * @returns The updated layout value.
 */
export async function setNavLayout(layout: NavLayout): Promise<NavLayout> {
  await pool.query(
    `INSERT INTO system_settings (key, value, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [NAV_LAYOUT_KEY, layout],
  );
  return layout;
}

// ── Email notifications global toggle (MINCRM-163) ───────────────────────────

/**
 * Returns whether the system-wide email notifications are enabled.
 * Defaults to true if the setting row is missing.
 *
 * @returns True when notifications are globally enabled.
 */
export async function getEmailNotificationsEnabled(): Promise<boolean> {
  const result = await pool.query<SystemSettingRow>(
    'SELECT value FROM system_settings WHERE key = $1 LIMIT 1',
    [EMAIL_NOTIFICATIONS_ENABLED_KEY],
  );
  if (!result.rows[0]) {
    logger.warn(
      'system_settings row for email_notifications_enabled is missing — defaulting to true',
    );
    return true;
  }
  return result.rows[0].value === 'true';
}

/**
 * Sets whether the system-wide email notifications are enabled. Admin only.
 *
 * @param enabled - Whether to enable or disable email notifications globally.
 * @returns The persisted value.
 */
export async function setEmailNotificationsEnabled(enabled: boolean): Promise<boolean> {
  await pool.query(
    `INSERT INTO system_settings (key, value, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [EMAIL_NOTIFICATIONS_ENABLED_KEY, String(enabled)],
  );
  return enabled;
}

// ── Default currency (MINCRM-189) ─────────────────────────────────────────────

/**
 * Retrieves the current system-wide default currency.
 * Falls back to 'USD' if the row is missing.
 *
 * @returns The stored default currency code.
 */
export async function getDefaultCurrency(): Promise<SupportedCurrency> {
  const result = await pool.query<SystemSettingRow>(
    'SELECT value FROM system_settings WHERE key = $1 LIMIT 1',
    [DEFAULT_CURRENCY_KEY],
  );
  if (!result.rows[0]) {
    return 'USD';
  }
  const raw = result.rows[0].value;
  if (!(SUPPORTED_CURRENCIES as readonly string[]).includes(raw)) {
    logger.warn(`system_settings default_currency '${raw}' is unsupported — falling back to USD`);
    return 'USD';
  }
  return raw as SupportedCurrency;
}

/**
 * Persists a new system-wide default currency. Admin only. (MINCRM-189)
 *
 * @param currency - One of the supported ISO 4217 currency codes.
 * @returns The updated currency code.
 */
export async function setDefaultCurrency(currency: SupportedCurrency): Promise<SupportedCurrency> {
  await pool.query(
    `INSERT INTO system_settings (key, value, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [DEFAULT_CURRENCY_KEY, currency],
  );
  return currency;
}

// ── Tag creation restriction (MINCRM-263) ─────────────────────────────────────

/**
 * Returns whether tag creation is restricted to the Tag Management page.
 * Defaults to false if the setting row is missing.
 *
 * @returns True when tag creation is restricted to admins only.
 */
export async function getTagsRestrictCreation(): Promise<boolean> {
  const result = await pool.query<SystemSettingRow>(
    'SELECT value FROM system_settings WHERE key = $1 LIMIT 1',
    [TAGS_RESTRICT_CREATION_KEY],
  );
  if (!result.rows[0]) {
    return false;
  }
  return result.rows[0].value === 'true';
}

/**
 * Sets whether tag creation is restricted to admins on the Tag Management page. Admin only.
 *
 * @param restricted - Whether to restrict inline tag creation to admins only.
 * @returns The persisted value.
 */
export async function setTagsRestrictCreation(restricted: boolean): Promise<boolean> {
  await pool.query(
    `INSERT INTO system_settings (key, value, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [TAGS_RESTRICT_CREATION_KEY, String(restricted)],
  );
  return restricted;
}

// ── Onboarding / Setup Checklist (MINCRM-256, MINCRM-379) ────────────────────

/** Completion status for one setup checklist task (MINCRM-379) */
export interface OnboardingTask {
  id: string;
  completed: boolean;
}

/** Shape returned by the onboarding status query */
export interface OnboardingStatus {
  is_first_run: boolean;
  onboarding_completed: boolean;
  /** Per-task completion, determined server-side (MINCRM-379) */
  tasks: OnboardingTask[];
}

/**
 * Returns onboarding status including per-task completion for the setup
 * checklist widget (MINCRM-379). Task completion is determined server-side:
 *   1. pipeline_stages_reviewed — always true; user can manually mark done
 *   2. team_member_invited     — any user other than the first admin exists
 *   3. first_contact_added     — contacts table is non-empty
 *   4. first_deal_created      — deals table is non-empty
 *   5. smtp_configured         — smtp_host setting is non-empty
 *
 * @returns The current onboarding status.
 */
export async function getOnboardingStatus(): Promise<OnboardingStatus> {
  const [settingsResult, countsResult] = await Promise.all([
    pool.query<SystemSettingRow>(`SELECT key, value FROM system_settings WHERE key = ANY($1)`, [
      [ONBOARDING_COMPLETED_KEY, PIPELINE_STAGES_REVIEWED_KEY, 'smtp_host'],
    ]),
    pool.query<{
      user_count: string;
      contact_count: string;
      deal_count: string;
    }>(
      `SELECT
         (SELECT COUNT(*) FROM users WHERE status != 'inactive') AS user_count,
         (SELECT COUNT(*) FROM contacts) AS contact_count,
         (SELECT COUNT(*) FROM deals) AS deal_count`,
    ),
  ]);

  const settingsMap = Object.fromEntries(settingsResult.rows.map((r) => [r.key, r.value]));

  const onboarding_completed = settingsMap[ONBOARDING_COMPLETED_KEY] === 'true';
  const is_first_run = !onboarding_completed;

  const row = countsResult.rows[0];
  const userCount = parseInt(row?.user_count ?? '0', 10);
  const contactCount = parseInt(row?.contact_count ?? '0', 10);
  const dealCount = parseInt(row?.deal_count ?? '0', 10);
  const smtpHost = settingsMap['smtp_host'] ?? '';

  const tasks: OnboardingTask[] = [
    {
      id: 'pipeline_stages_reviewed',
      // Auto-completes when the admin explicitly marks it done via the checklist
      // (MINCRM-379); also pre-completed after any pipeline stage save.
      completed: settingsMap[PIPELINE_STAGES_REVIEWED_KEY] === 'true',
    },
    {
      id: 'team_member_invited',
      // More than one active/invited user means someone else has been added.
      completed: userCount > 1,
    },
    {
      id: 'first_contact_added',
      completed: contactCount > 0,
    },
    {
      id: 'first_deal_created',
      completed: dealCount > 0,
    },
    {
      id: 'smtp_configured',
      completed: smtpHost.trim().length > 0,
    },
  ];

  return { is_first_run, onboarding_completed, tasks };
}

/**
 * Sets the onboarding_completed flag. Admin only. (MINCRM-256)
 *
 * @param completed - Whether onboarding has been completed.
 * @returns The persisted value.
 */
export async function setOnboardingCompleted(completed: boolean): Promise<boolean> {
  await pool.query(
    `INSERT INTO system_settings (key, value, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [ONBOARDING_COMPLETED_KEY, String(completed)],
  );
  return completed;
}

/**
 * Marks the pipeline-stages-reviewed task as done in the setup checklist.
 * Called after the admin saves a pipeline stage change (MINCRM-379).
 */
export async function markPipelineStagesReviewed(): Promise<void> {
  await pool.query(
    `INSERT INTO system_settings (key, value, updated_at)
     VALUES ($1, 'true', now())
     ON CONFLICT (key) DO UPDATE SET value = 'true', updated_at = now()`,
    [PIPELINE_STAGES_REVIEWED_KEY],
  );
}

/** The key used to store the org-wide MFA enforcement setting (MINCRM-392) */
const REQUIRE_MFA_KEY = 'require_mfa';

/**
 * Returns whether MFA is required for all users org-wide. (MINCRM-392)
 */
export async function getMfaRequired(): Promise<boolean> {
  const result = await pool.query<SystemSettingRow>(
    'SELECT value FROM system_settings WHERE key = $1 LIMIT 1',
    [REQUIRE_MFA_KEY],
  );
  return result.rows[0]?.value === 'true';
}

/**
 * Sets the org-wide MFA enforcement flag. Admin only. (MINCRM-392)
 *
 * @param required - Whether to require MFA for all users.
 * @returns The persisted value.
 */
export async function setMfaRequired(required: boolean): Promise<boolean> {
  await pool.query(
    `INSERT INTO system_settings (key, value, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [REQUIRE_MFA_KEY, String(required)],
  );
  return required;
}
