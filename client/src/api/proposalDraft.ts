/**
 * Proposal draft generation API module. (MINCRM-473)
 * Requires authentication and the ai_proposal_draft_generation feature flag.
 */

import apiClient from './axiosInstance.js';
import type {
  GenerateProposalDraftResponse,
  ProposalDraft,
} from '@shared/schemas/proposalDraftSchema.js';

export async function generateProposalDraft(
  dealId: string,
  focusNotes?: string,
): Promise<GenerateProposalDraftResponse> {
  const response = await apiClient.post<GenerateProposalDraftResponse>(
    `/deals/${dealId}/proposal-draft`,
    focusNotes ? { focus_notes: focusNotes } : {},
  );
  return response.data;
}

export async function exportProposalDraftDocx(dealId: string, draft: ProposalDraft): Promise<Blob> {
  const response = await apiClient.post(
    `/deals/${dealId}/proposal-draft/export-docx`,
    { draft },
    { responseType: 'blob' },
  );
  return response.data as Blob;
}
