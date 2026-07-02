/**
 * Shared types and Zod schema for AI proposal draft generation. (MINCRM-473)
 * Used by both client and server.
 */

import { z } from 'zod';

export const generateProposalDraftSchema = z.object({
  focus_notes: z.string().trim().min(1).max(500).optional(),
});
export type GenerateProposalDraftInput = z.infer<typeof generateProposalDraftSchema>;

const proposalPricingLineItemSchema = z.object({
  description: z.string().trim().min(1).max(200),
  amount: z.number(),
});
export type ProposalPricingLineItem = z.infer<typeof proposalPricingLineItemSchema>;

/**
 * Validates a (possibly rep-edited) draft posted back to the export endpoint.
 * The draft is never regenerated server-side on export — this only guards
 * the shape of client-submitted data before it's used to build a document.
 */
export const proposalDraftSchema = z.object({
  executive_summary: z.string().trim().min(1).max(2000),
  problem_statement: z.string().trim().min(1).max(2000),
  proposed_solution: z.string().trim().min(1).max(4000),
  pricing_line_items: z.array(proposalPricingLineItemSchema).min(1).max(20),
  pricing_currency: z.string().trim().length(3),
  next_steps: z.string().trim().min(1).max(2000),
  prepared_for: z.string().trim().min(1).max(300),
  prepared_by: z.string().trim().min(1).max(300),
});
export type ProposalDraft = z.infer<typeof proposalDraftSchema>;

export const exportProposalDraftSchema = z.object({
  draft: proposalDraftSchema,
});
export type ExportProposalDraftInput = z.infer<typeof exportProposalDraftSchema>;

export interface GenerateProposalDraftResponse {
  draft: ProposalDraft;
}
