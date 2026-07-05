/**
 * Duplicate explanation API module. (MINCRM-440)
 * Wraps the on-demand AI duplicate-explanation endpoint. Requires authentication and
 * the ai_duplicate_explanation feature flag to be enabled.
 */

import apiClient from './axiosInstance.js';
import type { DuplicateExplanationResponse } from '@shared/schemas/duplicateExplanationSchema.js';

export interface DuplicateFieldValues {
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
  name?: string;
}

/**
 * Explains why two records look like duplicates. `recordB` may be either an
 * existing record's UUID or raw field values for an unsaved record (the
 * create-form duplicate banner's "new" side, which was rejected with 409
 * before it could be persisted).
 */
export async function explainDuplicate(
  entityType: 'contact' | 'account',
  recordAId: string,
  recordB: { id: string } | { fields: DuplicateFieldValues },
): Promise<DuplicateExplanationResponse> {
  const response = await apiClient.post<DuplicateExplanationResponse>('/duplicates/explain', {
    entity_type: entityType,
    record_a_id: recordAId,
    ...('id' in recordB ? { record_b_id: recordB.id } : { record_b_fields: recordB.fields }),
  });
  return response.data;
}
