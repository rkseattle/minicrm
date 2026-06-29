/**
 * Context proposal extraction — parses the structured %%CONTEXT_PROPOSAL%% marker
 * that Claude embeds in its text response when it detects an ambiguous term or
 * correction pattern worth remembering. The marker is stripped from content before
 * storage so users never see the raw JSON in their conversation thread.
 *
 * Marker format (embedded anywhere in the text):
 *   %%CONTEXT_PROPOSAL%%{"key":"…","value":"…","reason":"…"}%%
 *
 * Design rationale: embedding a structured marker in the text response avoids
 * adding a new tool (which would require a round-trip) or a new API field.
 * The server is the only consumer of the marker; the client receives the cleaned
 * content and the extracted proposal as separate fields on AiMessageResponse.
 * (MINCRM-429, MINCRM-430)
 */

import type { AiContextProposal } from '@minicrm/shared/schemas/aiContextSchema.js';

const PROPOSAL_REGEX = /%%CONTEXT_PROPOSAL%%(\{.*?\})%%/s;

export interface ContextProposalExtraction {
  /** The message content with any proposal marker stripped out. */
  cleanContent: string;
  /** The parsed proposal, or null when no valid marker was present. */
  proposal: AiContextProposal | null;
}

/**
 * Extracts and validates a context proposal marker from Claude's response text.
 * Returns the cleaned content and the parsed proposal (or null when absent/invalid).
 * Never throws — malformed markers are silently discarded and treated as absent.
 */
export function extractContextProposal(content: string): ContextProposalExtraction {
  const match = PROPOSAL_REGEX.exec(content);
  if (!match) {
    return { cleanContent: content, proposal: null };
  }

  const cleanContent = content.replace(PROPOSAL_REGEX, '').trim();

  let proposal: AiContextProposal | null = null;
  try {
    const parsed: unknown = JSON.parse(match[1]);
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      typeof (parsed as Record<string, unknown>)['key'] === 'string' &&
      typeof (parsed as Record<string, unknown>)['value'] === 'string' &&
      typeof (parsed as Record<string, unknown>)['reason'] === 'string' &&
      (parsed as Record<string, unknown>)['key'] !== '' &&
      (parsed as Record<string, unknown>)['value'] !== ''
    ) {
      proposal = parsed as AiContextProposal;
    }
  } catch {
    // Malformed JSON — treat as absent.
  }

  return { cleanContent, proposal };
}
