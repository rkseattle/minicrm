/**
 * Email draft API module.
 * Wraps the on-demand AI email draft generation endpoint. Requires authentication and
 * the ai_email_draft feature flag to be enabled.
 */

import apiClient from './axiosInstance.js';
import type { EmailDraftResponse, EmailDraftTone } from '@shared/schemas/emailDraftSchema.js';

export async function generateEmailDraft(
  contactId: string,
  tone: EmailDraftTone,
): Promise<EmailDraftResponse> {
  const response = await apiClient.post<EmailDraftResponse>(`/contacts/${contactId}/email-draft`, {
    tone,
  });
  return response.data;
}
