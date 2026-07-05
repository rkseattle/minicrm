/**
 * Shared types and Zod schema for the AI call/note summarizer feature. (MINCRM-436)
 * Used by both client and server.
 */

import { z } from 'zod';

export const RAW_TEXT_MAX_LENGTH = 20000;

export const summarizeActivityTextSchema = z.object({
  raw_text: z
    .string({ required_error: 'Text to summarize is required' })
    .trim()
    .min(1, 'Text to summarize is required')
    .max(RAW_TEXT_MAX_LENGTH, `Text must be ${RAW_TEXT_MAX_LENGTH} characters or fewer`),
});
export type SummarizeActivityTextInput = z.infer<typeof summarizeActivityTextSchema>;

export interface SuggestedFollowUpTask {
  description: string;
  suggested_due_date: string;
}

export interface ActivitySummaryResponse {
  /** 2-4 sentence summary of the pasted text. */
  summary: string;
  /** Bulleted action items extracted from the text. */
  action_items: string[];
  suggested_follow_up_tasks: SuggestedFollowUpTask[];
  generated_at: string;
}
