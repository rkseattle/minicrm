/**
 * Integration tests for brandingService.
 *
 * Runs against the real PostgreSQL minicrm_test DB.
 * Cleans up the branding key in system_settings before each test.
 *
 * Run: npm test --workspace=minicrm-server
 */

import 'dotenv/config';
import {
  getBranding,
  setBranding,
  deleteBranding,
  deriveTextColor,
  __clearCacheForTest,
} from '../services/brandingService.js';
import pool from '../db.js';

beforeEach(async () => {
  await pool.query(`DELETE FROM system_settings WHERE key = 'branding'`);
  // Tests truncate system_settings directly via SQL (not through deleteBranding()),
  // which wouldn't invalidate getBranding()'s in-memory TTL cache — clear it
  // explicitly so each test observes the DB state it just set up.
  __clearCacheForTest();
});

afterAll(async () => {
  await pool.query(`DELETE FROM system_settings WHERE key = 'branding'`);
});

// ── deriveTextColor ───────────────────────────────────────────────────────────

describe('deriveTextColor', () => {
  it('returns white for a dark background colour', () => {
    expect(deriveTextColor('#1a1a2e')).toBe('#ffffff');
  });

  it('returns dark text for a light background colour', () => {
    expect(deriveTextColor('#f0f4ff')).toBe('#1f2937');
  });

  it('returns white for a mid-dark indigo', () => {
    expect(deriveTextColor('#4f46e5')).toBe('#ffffff');
  });

  it('handles #rgb shorthand', () => {
    const result = deriveTextColor('#000');
    expect(result).toBe('#ffffff');
  });
});

// ── getBranding ───────────────────────────────────────────────────────────────

describe('getBranding', () => {
  it('returns null when no branding row exists', async () => {
    const result = await getBranding();
    expect(result).toBeNull();
  });

  it('returns the stored branding config', async () => {
    await setBranding({ primaryColor: '#e53e3e', companyName: 'Acme Corp' });
    const result = await getBranding();
    expect(result).not.toBeNull();
    expect(result?.primaryColor).toBe('#e53e3e');
    expect(result?.companyName).toBe('Acme Corp');
    expect(result?.poweredByEnabled).toBe(true);
  });

  it('returns null when system_settings value is invalid JSON', async () => {
    await pool.query(
      `INSERT INTO system_settings (key, value, updated_at) VALUES ('branding', 'not-json', now())`,
    );
    const result = await getBranding();
    expect(result).toBeNull();
  });

  it('serves a cached value on a subsequent call, not re-reading the DB', async () => {
    await setBranding({ companyName: 'Cached Co' });
    const first = await getBranding();
    expect(first?.companyName).toBe('Cached Co');

    // Bypass setBranding()'s cache invalidation by writing directly — a cached
    // getBranding() must NOT observe this until the cache is cleared/expires.
    await pool.query(`UPDATE system_settings SET value = $1 WHERE key = 'branding'`, [
      JSON.stringify({ ...first, companyName: 'Uncached Write' }),
    ]);
    const second = await getBranding();
    expect(second?.companyName).toBe('Cached Co');
  });

  it('reflects a write immediately after setBranding() invalidates the cache', async () => {
    await setBranding({ companyName: 'First' });
    await getBranding(); // populate the cache
    await setBranding({ companyName: 'Second' });
    const result = await getBranding();
    expect(result?.companyName).toBe('Second');
  });

  it('reflects deleteBranding() immediately by invalidating the cache', async () => {
    await setBranding({ companyName: 'ToDelete' });
    await getBranding(); // populate the cache
    await deleteBranding();
    const result = await getBranding();
    expect(result).toBeNull();
  });
});

// ── setBranding ───────────────────────────────────────────────────────────────

describe('setBranding', () => {
  it('creates a new branding config', async () => {
    const result = await setBranding({ companyName: 'TestCo', primaryColor: '#1a56db' });
    expect(result.companyName).toBe('TestCo');
    expect(result.primaryColor).toBe('#1a56db');
    expect(result.primaryColorText).toBe('#ffffff');
    expect(result.poweredByEnabled).toBe(true);
  });

  it('derives primaryColorText from the primary colour', async () => {
    const dark = await setBranding({ primaryColor: '#000000' });
    expect(dark.primaryColorText).toBe('#ffffff');

    await pool.query(`DELETE FROM system_settings WHERE key = 'branding'`);
    const light = await setBranding({ primaryColor: '#ffffff' });
    expect(light.primaryColorText).toBe('#1f2937');
  });

  it('sets primaryColorText to null when primaryColor is null', async () => {
    const result = await setBranding({ primaryColor: null });
    expect(result.primaryColorText).toBeNull();
  });

  it('merges a partial update onto the existing config', async () => {
    await setBranding({ companyName: 'First', primaryColor: '#1a56db', fontFamily: 'roboto' });
    const updated = await setBranding({ companyName: 'Second' });
    expect(updated.companyName).toBe('Second');
    expect(updated.primaryColor).toBe('#1a56db');
    expect(updated.fontFamily).toBe('roboto');
  });

  it('persists and retrieves the full config correctly', async () => {
    await setBranding({
      logoUrl: 'https://example.com/logo.png',
      logoAltText: 'Logo',
      faviconUrl: 'https://example.com/favicon.ico',
      primaryColor: '#e53e3e',
      fontFamily: 'poppins',
      companyName: 'Acme',
    });
    const persisted = await getBranding();
    expect(persisted?.logoUrl).toBe('https://example.com/logo.png');
    expect(persisted?.logoAltText).toBe('Logo');
    expect(persisted?.faviconUrl).toBe('https://example.com/favicon.ico');
    expect(persisted?.fontFamily).toBe('poppins');
    expect(persisted?.companyName).toBe('Acme');
  });
});

// ── deleteBranding ────────────────────────────────────────────────────────────

describe('deleteBranding', () => {
  it('removes the branding config so getBranding returns null', async () => {
    await setBranding({ companyName: 'ToDelete' });
    expect(await getBranding()).not.toBeNull();

    await deleteBranding();
    expect(await getBranding()).toBeNull();
  });

  it('is idempotent — deleting when no row exists does not throw', async () => {
    await expect(deleteBranding()).resolves.toBeUndefined();
  });
});
