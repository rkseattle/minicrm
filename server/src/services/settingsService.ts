/**
 * Settings service — all database operations related to system settings.
 * Business logic belongs here. Controllers must not query the database directly.
 */

import pool from '../db.js';
import logger from '../logger.js';
import { SUPPORTED_LOCALES, NAV_LAYOUTS } from '@minicrm/shared/schemas/settingsSchema.js';
import type { SupportedLocale, NavLayout } from '@minicrm/shared/schemas/settingsSchema.js';

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
