/**
 * Contact enrichment API module.
 * Wraps the on-demand AI contact-field-extraction endpoint. Requires authentication and
 * the ai_contact_enrichment feature flag to be enabled.
 */

import apiClient from './axiosInstance.js';
import type { ContactEnrichmentResponse } from '@shared/schemas/contactEnrichmentSchema.js';

export async function enrichContactFromText(rawText: string): Promise<ContactEnrichmentResponse> {
  const response = await apiClient.post<ContactEnrichmentResponse>('/contacts/enrich-from-text', {
    raw_text: rawText,
  });
  return response.data;
}
