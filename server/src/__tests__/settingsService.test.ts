/**
 * Integration tests for settingsService.
 *
 * Runs against a real PostgreSQL test database.
 * The system_settings table is restored to its default state after each test.
 *
 * Run: npm test (from /server)
 */

import 'dotenv/config';
import { getDefaultLanguage, setDefaultLanguage } from '../services/settingsService.js';
import pool from '../db.js';

beforeEach(async () => {
  // Reset to the seeded default before each test
  await pool.query(
    `INSERT INTO system_settings (key, value, updated_at)
     VALUES ('default_language', 'en', now())
     ON CONFLICT (key) DO UPDATE SET value = 'en', updated_at = now()`,
  );
});

afterAll(async () => {
  await pool.end();
});

describe('getDefaultLanguage', () => {
  it('returns "en" when no override has been set', async () => {
    const language = await getDefaultLanguage();
    expect(language).toBe('en');
  });

  it('returns the language that was last set', async () => {
    await pool.query(`UPDATE system_settings SET value = 'fr' WHERE key = 'default_language'`);
    const language = await getDefaultLanguage();
    expect(language).toBe('fr');
  });

  it('falls back to "en" when the row is missing', async () => {
    await pool.query(`DELETE FROM system_settings WHERE key = 'default_language'`);
    const language = await getDefaultLanguage();
    expect(language).toBe('en');
  });
});

describe('setDefaultLanguage', () => {
  it('persists and returns the new language', async () => {
    const result = await setDefaultLanguage('zh-Hans');
    expect(result).toBe('zh-Hans');

    const fetched = await getDefaultLanguage();
    expect(fetched).toBe('zh-Hans');
  });

  it('overwrites a previously set language', async () => {
    await setDefaultLanguage('de');
    await setDefaultLanguage('es');
    const fetched = await getDefaultLanguage();
    expect(fetched).toBe('es');
  });

  it('handles all supported locales without error', async () => {
    const locales = ['en', 'zh-Hans', 'es', 'fr', 'de'] as const;
    for (const locale of locales) {
      await expect(setDefaultLanguage(locale)).resolves.toBe(locale);
    }
  });
});
