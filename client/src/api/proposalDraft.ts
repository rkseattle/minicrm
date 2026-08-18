/**
 * Proposal draft generation API module.
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
  // responseType 'arraybuffer', not 'blob': this is the only POST-with-body export
  // endpoint in the client, and that combination makes MSW's XHR interceptor throw
  // "object.stream is not a function" while constructing its mock Response from a
  // native Blob. Observed on Node 20 and NOT re-verified on Node 24, which CI now runs
  // the workaround is kept because nothing here exercises the blob path, so
  // dropping it would be untested either way — GET-based blob exports elsewhere are
  // unaffected. Constructing the Blob ourselves from an ArrayBuffer sidesteps the
  // interceptor's Blob-body handling entirely.
  const response = await apiClient.post(
    `/deals/${dealId}/proposal-draft/export-docx`,
    { draft },
    { responseType: 'arraybuffer' },
  );
  return new Blob([response.data as ArrayBuffer], {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
}
