/**
 * Shared types for the AI follow-up task suggestion feature.
 * Used by both client and server.
 */

export interface SuggestedTask {
  description: string;
  suggested_due_date: string;
  /** Which entity the suggested task should link to when accepted. */
  linked_entity: 'contact' | 'opportunity' | null;
}

export interface TaskSuggestionResponse {
  suggestions: SuggestedTask[];
  generated_at: string;
}
