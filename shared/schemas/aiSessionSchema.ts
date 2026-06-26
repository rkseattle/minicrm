/**
 * Shared Zod schemas and TypeScript types for the AI conversation feature.
 * Used by both client and server.
 * (MINCRM-420, MINCRM-421)
 */

import { z } from 'zod';

export const AI_MESSAGE_ROLES = ['user', 'assistant'] as const;
export type AiMessageRole = (typeof AI_MESSAGE_ROLES)[number];

export const createAiSessionSchema = z.object({
  name: z.string().min(1).max(255).trim().optional(),
});

export type CreateAiSessionInput = z.infer<typeof createAiSessionSchema>;

export const sendAiMessageSchema = z.object({
  content: z.string().min(1, 'Message content is required').max(32_000).trim(),
});

export type SendAiMessageInput = z.infer<typeof sendAiMessageSchema>;

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
  created_at: string;
}

export interface AiSessionWithMessagesResponse extends AiSessionResponse {
  messages: AiMessageResponse[];
}
