/**
 * Shared Zod schemas and constants for custom branding configuration.
 * Imported by both the server (validation) and the client (form validation + CSS injection).
 */

import { z } from 'zod';

/** Curated list of Google Fonts exposed for brand font selection. */
export const SUPPORTED_FONTS = [
  { id: 'inter', label: 'Inter (default)', googleFamily: null },
  { id: 'roboto', label: 'Roboto', googleFamily: 'Roboto' },
  { id: 'open-sans', label: 'Open Sans', googleFamily: 'Open+Sans' },
  { id: 'lato', label: 'Lato', googleFamily: 'Lato' },
  { id: 'nunito', label: 'Nunito', googleFamily: 'Nunito' },
  { id: 'poppins', label: 'Poppins', googleFamily: 'Poppins' },
  { id: 'raleway', label: 'Raleway', googleFamily: 'Raleway' },
  { id: 'source-sans', label: 'Source Sans 3', googleFamily: 'Source+Sans+3' },
  { id: 'merriweather', label: 'Merriweather', googleFamily: 'Merriweather' },
  { id: 'pt-serif', label: 'PT Serif', googleFamily: 'PT+Serif' },
] as const;

export type SupportedFontId = (typeof SUPPORTED_FONTS)[number]['id'];

export const SUPPORTED_FONT_IDS = SUPPORTED_FONTS.map((f) => f.id) as unknown as readonly [
  SupportedFontId,
  ...SupportedFontId[],
];

/** Validates a CSS hex colour value (#rrggbb or #rgb). */
const hexColorSchema = z
  .string()
  .regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, 'Must be a valid hex colour (e.g. #1a56db)');

/** Validates a URL that begins with http:// or https://. */
const urlSchema = z
  .string()
  .url('Must be a valid URL')
  .startsWith('http', 'Must begin with http:// or https://');

/**
 * Schema for the PUT /api/settings/branding request body.
 * All fields are optional — admin can update a subset of branding fields at once.
 */
export const setBrandingSchema = z.object({
  logoUrl: urlSchema.optional().nullable(),
  logoAltText: z
    .string()
    .max(200, 'Alt text must be 200 characters or fewer')
    .optional()
    .nullable(),
  faviconUrl: urlSchema.optional().nullable(),
  primaryColor: hexColorSchema.optional().nullable(),
  fontFamily: z
    .enum(SUPPORTED_FONT_IDS, {
      errorMap: () => ({ message: `Font must be one of: ${SUPPORTED_FONT_IDS.join(', ')}` }),
    })
    .optional()
    .nullable(),
  companyName: z
    .string()
    .max(100, 'Company name must be 100 characters or fewer')
    .optional()
    .nullable(),
});

export type SetBrandingInput = z.infer<typeof setBrandingSchema>;

/**
 * Full branding configuration stored in the database and returned by the API.
 * `primaryColorText` is derived server-side from `primaryColor` for WCAG contrast.
 * `poweredByEnabled` is always true when a branding record exists.
 */
export interface BrandingConfig {
  logoUrl: string | null;
  logoAltText: string | null;
  faviconUrl: string | null;
  primaryColor: string | null;
  primaryColorText: string | null;
  fontFamily: SupportedFontId | null;
  companyName: string | null;
  poweredByEnabled: boolean;
}

/** Shape returned by GET /api/settings/branding */
export interface BrandingResponse {
  branding: BrandingConfig | null;
}
