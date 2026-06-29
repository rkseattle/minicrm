/**
 * Shared Zod schemas and TypeScript types for the AI conversation feature.
 * Used by both client and server.
 * (MINCRM-420, MINCRM-421)
 */

import { z } from 'zod';
import type { AiContextProposal } from './aiContextSchema.js';

export const AI_MESSAGE_ROLES = ['user', 'assistant'] as const;
export type AiMessageRole = (typeof AI_MESSAGE_ROLES)[number];

export const createAiSessionSchema = z.object({});

export type CreateAiSessionInput = z.infer<typeof createAiSessionSchema>;

export const sendAiMessageSchema = z.object({
  content: z.string().trim().min(1, 'Message content is required').max(32_000),
});

export type SendAiMessageInput = z.infer<typeof sendAiMessageSchema>;

/**
 * A single tool call result captured during the NLI agentic loop.
 * Stored alongside assistant messages to enable native CRM result rendering. (MINCRM-423, MINCRM-431)
 */
export interface AiToolResult {
  /** The tool that was called (e.g. 'searchContacts', 'getDeal') */
  toolName: string;
  /** The input arguments passed to the tool */
  input: Record<string, unknown>;
  /** The raw output returned by the tool (already PII-filtered) */
  output: unknown;
}

/** The mutation operation type for a pending confirmation. (MINCRM-425, MINCRM-426) */
export type AiMutationOperation = 'create' | 'update' | 'delete';

/**
 * A pending mutation action awaiting user confirmation.
 *
 * Captured when Claude calls requestMutationConfirmation and stored on the
 * assistant message so the client can render a confirmation prompt before any
 * write operation is executed. (MINCRM-425, MINCRM-426)
 */
export interface AiPendingAction {
  /** The type of mutation operation: create, update, or delete. */
  operation: AiMutationOperation;
  /** The CRM entity type being mutated (e.g. "contact", "deal", "account"). */
  entityType: string;
  /** For update/delete: the ID of the record being modified. */
  entityId?: string;
  /** For update/delete: the human-readable name of the record. */
  entityName?: string;
  /**
   * For create: all fields to be set.
   * For update: only the fields being changed and their new values.
   * For delete: key identifying fields.
   */
  fields: Record<string, unknown>;
  /** True when the operation affects more than one record. */
  isBulk: boolean;
  /** Required when isBulk is true. Total number of records affected. */
  bulkCount?: number;
  /** Optional when isBulk is true. Up to 5 representative record names. */
  bulkSample?: string[];
  /** True when isBulk is true AND operation is "delete". Triggers double-confirm gate. */
  isBulkDelete?: boolean;
  /** Plain-language description of what will happen, shown to the user. */
  summary: string;
}

export interface AiSessionResponse {
  id: string;
  user_id: string;
  name: string | null;
  created_at: string;
  updated_at: string;
}

export interface AiMessageResponse {
  id: string;
  session_id: string;
  role: AiMessageRole;
  content: string;
  /** Structured tool results for native CRM rendering. Present only on assistant messages that invoked tools. */
  tool_results: AiToolResult[] | null;
  /** Pending mutation action awaiting user confirmation. Present only when Claude called requestMutationConfirmation. */
  pending_action: AiPendingAction | null;
  /** AI-proposed context entry awaiting user accept/dismiss. Present when Claude detected an ambiguous term or correction. (MINCRM-429, MINCRM-430) */
  context_proposal: AiContextProposal | null;
  created_at: string;
}

export interface AiSessionWithMessagesResponse extends AiSessionResponse {
  messages: AiMessageResponse[];
}
