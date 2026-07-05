/**
 * Shared types and Zod schema for the AI email draft generation feature. (MINCRM-437)
 * Used by both client and server.
 */

import { z } from 'zod';

export const EMAIL_DRAFT_TONES = ['Professional', 'Friendly', 'Concise'] as const;
export type EmailDraftTone = (typeof EMAIL_DRAFT_TONES)[number];

export const generateEmailDraftSchema = z.object({
  tone: z.enum(EMAIL_DRAFT_TONES).optional().default('Professional'),
});
export type GenerateEmailDraftInput = z.infer<typeof generateEmailDraftSchema>;

export interface EmailDraftResponse {
  subject: string;
  body: string;
  tone: EmailDraftTone;
  generated_at: string;
}
