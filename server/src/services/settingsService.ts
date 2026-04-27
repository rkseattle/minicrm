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
