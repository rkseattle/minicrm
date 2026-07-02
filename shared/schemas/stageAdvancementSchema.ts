/**
 * Shared types for the AI stage advancement suggestion feature. (MINCRM-443)
 * Used by both client and server.
 */

export interface StageAdvancementSuggestion {
  ready: true;
  /** UUID of the suggested next pipeline stage. */
  next_stage_id: string;
  /** Display name of the suggested next pipeline stage. */
  next_stage_name: string;
  /** 1-3 sentence rationale for why the deal looks ready to advance. */
  rationale: string;
}

export interface StageAdvancementNoSuggestion {
  ready: false;
}

export type StageAdvancementCheckResponse =
  | StageAdvancementSuggestion
  | StageAdvancementNoSuggestion;
