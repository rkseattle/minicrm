/**
 * BrandingContext — provides the active branding config to the component tree
 * and applies CSS custom properties + Google Font loading. (MINCRM-356)
 *
 * Fetch is done with a long staleTime (1 hour) since branding changes are rare
 * and admin-only. The style injection runs outside React's render cycle so
 * there is no flash of the default theme.
 */

import { createContext, useContext, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getBranding, BRANDING_QUERY_KEY } from '@/api/branding.js';
import { SUPPORTED_FONTS } from '@shared/schemas/brandingSchema.js';
import type { BrandingConfig } from '@/api/branding.js';

const BRANDING_STALE_MS = 60 * 60 * 1000; // 1 hour

interface BrandingContextValue {
  branding: BrandingConfig | null;
  isLoading: boolean;
}

const BrandingContext = createContext<BrandingContextValue>({
  branding: null,
  isLoading: true,
});

/**
 * Injects or updates the <style id="minicrm-branding"> tag in <head> with
 * CSS custom property overrides derived from the branding config.
 *
 * @param config - The active branding config, or null to remove overrides.
 */
function applyBrandingStyles(config: BrandingConfig | null): void {
  const existingStyle = document.getElementById('minicrm-branding');
  if (!config || (!config.primaryColor && !config.fontFamily)) {
    existingStyle?.remove();
    return;
  }

  const fontEntry = config.fontFamily
    ? SUPPORTED_FONTS.find((f) => f.id === config.fontFamily)
    : null;

  const lines: string[] = [':root {'];
  if (config.primaryColor) {
    const c = config.primaryColor;
    // Override the full primary palette so every Tailwind primary-* utility
    // reflects the brand color. Lighter shades mix toward white; darker toward black.
    lines.push(`  --color-primary-50:  color-mix(in srgb, ${c}  8%, white);`);
    lines.push(`  --color-primary-100: color-mix(in srgb, ${c} 15%, white);`);
    lines.push(`  --color-primary-200: color-mix(in srgb, ${c} 30%, white);`);
    lines.push(`  --color-primary-400: color-mix(in srgb, ${c} 70%, white);`);
    lines.push(`  --color-primary-500: color-mix(in srgb, ${c} 85%, white);`);
    lines.push(`  --color-primary-600: ${c};`);
    lines.push(`  --color-primary-700: color-mix(in srgb, ${c} 85%, black);`);
    lines.push(`  --color-primary-800: color-mix(in srgb, ${c} 70%, black);`);
    lines.push(`  --color-primary-900: color-mix(in srgb, ${c} 55%, black);`);
    if (config.primaryColorText) {
      lines.push(`  --color-primary-text: ${config.primaryColorText};`);
    }
  }
  if (fontEntry && fontEntry.googleFamily !== null) {
    lines.push(`  --font-body: '${fontEntry.label}', sans-serif;`);
  }
  lines.push('}');
  // Apply the custom font to the document body so it takes effect regardless
  // of Tailwind's font-sans utility class being set on child elements.
  if (fontEntry && fontEntry.googleFamily !== null) {
    lines.push(`body { font-family: '${fontEntry.label}', sans-serif; }`);
  }

  const style = existingStyle ?? document.createElement('style');
  style.id = 'minicrm-branding';
  style.textContent = lines.join('\n');
  if (!existingStyle) {
    document.head.appendChild(style);
  }
}

/**
 * Loads a Google Font by injecting a <link> into <head>.
 * Only runs when a non-default (non-inter) font is configured.
 * Idempotent — if the link already exists it is not duplicated.
 *
 * @param googleFamily - The Google Fonts family query string (e.g. 'Open+Sans').
 */
function loadGoogleFont(googleFamily: string): void {
  const linkId = `gfont-${googleFamily}`;
  if (document.getElementById(linkId)) return;
  const link = document.createElement('link');
  link.id = linkId;
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${googleFamily}:wght@400;500;600;700&display=swap`;
  document.head.appendChild(link);
}

export function BrandingProvider({ children }: { children: React.ReactNode }) {
  const { data, isLoading } = useQuery({
    queryKey: BRANDING_QUERY_KEY,
    queryFn: getBranding,
    staleTime: BRANDING_STALE_MS,
  });

  const branding = data?.branding ?? null;

  useEffect(() => {
    applyBrandingStyles(branding);

    if (branding?.fontFamily && branding.fontFamily !== 'inter') {
      const fontEntry = SUPPORTED_FONTS.find((f) => f.id === branding.fontFamily);
      if (fontEntry?.googleFamily) {
        loadGoogleFont(fontEntry.googleFamily);
      }
    }
  }, [branding]);

  useEffect(() => {
    const name = branding?.companyName;
    document.title = name ? `${name}` : 'MiniCRM';
  }, [branding?.companyName]);

  return (
    <BrandingContext.Provider value={{ branding, isLoading }}>{children}</BrandingContext.Provider>
  );
}

/** Returns the active branding config and its loading state. */
export function useBranding(): BrandingContextValue {
  return useContext(BrandingContext);
}
