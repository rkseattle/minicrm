/**
 * Settings service — all database operations related to system settings.
 * Business logic belongs here. Controllers must not query the database directly.
 */

import pool from '../db.js';
import type { SupportedLocale } from '@minicrm/shared/schemas/settingsSchema.js';

/** A row from the system_settings table */
interface SystemSettingRow {
  key: string;
  value: string;
  updated_at: Date;
}

/** The key used to store the default language setting */
const DEFAULT_LANGUAGE_KEY = 'default_language';

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
  return (result.rows[0]?.value ?? 'en') as SupportedLocale;
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
