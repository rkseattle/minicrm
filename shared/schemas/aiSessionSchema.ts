/**
 * Shared Zod schemas and TypeScript types for the AI conversation feature.
 * Used by both client and server.
 * (MINCRM-420, MINCRM-421)
 */

import { z } from 'zod';

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
  created_at: string;
}

export interface AiSessionWithMessagesResponse extends AiSessionResponse {
  messages: AiMessageResponse[];
}
