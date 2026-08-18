/**
 * Shared types and Zod schema for the AI contact auto-enrich feature.
 * Used by both client and server.
 */

import { z } from 'zod';

export const RAW_ENRICHMENT_TEXT_MAX_LENGTH = 5000;

export const enrichContactFromTextSchema = z.object({
  raw_text: z
    .string({ required_error: 'Text to parse is required' })
    .trim()
    .min(1, 'Text to parse is required')
    .max(
      RAW_ENRICHMENT_TEXT_MAX_LENGTH,
      `Text must be ${RAW_ENRICHMENT_TEXT_MAX_LENGTH} characters or fewer`,
    ),
});
export type EnrichContactFromTextInput = z.infer<typeof enrichContactFromTextSchema>;

export interface ContactEnrichmentFields {
  first_name: string | null;
  last_name: string | null;
  title: string | null;
  company_name: string | null;
  email: string | null;
  phone: string | null;
  linkedin_url: string | null;
  location: string | null;
}

export interface ContactEnrichmentResponse {
  fields: ContactEnrichmentFields;
  /** Existing account ID when company_name matched an existing Account by name. */
  matched_account_id: string | null;
  /** True when the AI could not extract enough information to be useful. */
  insufficient_data: boolean;
}
