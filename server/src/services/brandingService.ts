/**
 * Branding service — all database operations for custom branding configuration. (MINCRM-356)
 * Stores the branding config as a JSON string in the system_settings key/value table.
 */

import pool from '../db.js';
import logger from '../logger.js';
import type {
  BrandingConfig,
  SetBrandingInput,
  SupportedFontId,
} from '@minicrm/shared/schemas/brandingSchema.js';

const BRANDING_KEY = 'branding';

/**
 * Computes the relative luminance of an sRGB hex colour.
 * Formula: https://www.w3.org/TR/WCAG21/#dfn-relative-luminance
 *
 * @param hex - Hex colour string (#rrggbb or #rgb).
 * @returns Relative luminance value in [0, 1].
 */
function relativeLuminance(hex: string): number {
  const full = hex.length === 4 ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}` : hex;
  const r = parseInt(full.slice(1, 3), 16) / 255;
  const g = parseInt(full.slice(3, 5), 16) / 255;
  const b = parseInt(full.slice(5, 7), 16) / 255;
  const linearize = (c: number): number =>
    c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
}

/**
 * Returns the WCAG contrast ratio between two colours.
 *
 * @param l1 - Relative luminance of the lighter colour.
 * @param l2 - Relative luminance of the darker colour.
 * @returns Contrast ratio.
 */
function contrastRatio(l1: number, l2: number): number {
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Derives the text colour (white or dark grey) that meets WCAG AA contrast
 * (4.5:1) against the given background colour.
 *
 * @param bgHex - Background hex colour.
 * @returns '#ffffff' or '#1f2937' depending on which achieves better contrast.
 */
export function deriveTextColor(bgHex: string): string {
  const bgLum = relativeLuminance(bgHex);
  const whiteLum = 1;
  const darkLum = relativeLuminance('#1f2937');
  const whiteContrast = contrastRatio(whiteLum, bgLum);
  const darkContrast = contrastRatio(darkLum, bgLum);
  return whiteContrast >= darkContrast ? '#ffffff' : '#1f2937';
}

/**
 * Returns the current branding configuration, or null if none is stored.
 *
 * @returns The stored BrandingConfig, or null.
 */
export async function getBranding(): Promise<BrandingConfig | null> {
  const result = await pool.query<{ value: string }>(
    'SELECT value FROM system_settings WHERE key = $1 LIMIT 1',
    [BRANDING_KEY],
  );
  if (!result.rows[0]) {
    return null;
  }
  try {
    return JSON.parse(result.rows[0].value) as BrandingConfig;
  } catch {
    logger.warn('system_settings branding value is not valid JSON — returning null');
    return null;
  }
}

/**
 * Persists (or merges) a branding configuration update. (MINCRM-356)
 * Merges the incoming fields onto the existing config so partial updates work.
 * Derives `primaryColorText` when `primaryColor` is present.
 *
 * @param input - Validated branding fields to store.
 * @returns The complete updated BrandingConfig.
 */
export async function setBranding(input: SetBrandingInput): Promise<BrandingConfig> {
  const existing = await getBranding();

  const merged: BrandingConfig = {
    logoUrl: input.logoUrl !== undefined ? input.logoUrl : (existing?.logoUrl ?? null),
    logoAltText:
      input.logoAltText !== undefined ? input.logoAltText : (existing?.logoAltText ?? null),
    faviconUrl: input.faviconUrl !== undefined ? input.faviconUrl : (existing?.faviconUrl ?? null),
    primaryColor:
      input.primaryColor !== undefined ? input.primaryColor : (existing?.primaryColor ?? null),
    primaryColorText: existing?.primaryColorText ?? null,
    fontFamily: (input.fontFamily !== undefined
      ? input.fontFamily
      : existing?.fontFamily) as SupportedFontId | null,
    companyName:
      input.companyName !== undefined ? input.companyName : (existing?.companyName ?? null),
    poweredByEnabled: true,
  };

  // Derive text colour any time primaryColor changes or is first set
  if (merged.primaryColor) {
    merged.primaryColorText = deriveTextColor(merged.primaryColor);
  } else {
    merged.primaryColorText = null;
  }

  await pool.query(
    `INSERT INTO system_settings (key, value, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [BRANDING_KEY, JSON.stringify(merged)],
  );

  return merged;
}

/**
 * Deletes the branding configuration, restoring default MiniCRM appearance. (MINCRM-356)
 */
export async function deleteBranding(): Promise<void> {
  await pool.query('DELETE FROM system_settings WHERE key = $1', [BRANDING_KEY]);
}
