/**
 * Shared types for the AI duplicate detection explanation feature. (MINCRM-440)
 * Used by both client and server.
 */

export interface DuplicateExplanationResponse {
  /** 2-4 sentence natural-language explanation, or a clear "cannot determine" message. */
  explanation: string;
  /** True when the AI could not find a meaningful similarity reason. */
  inconclusive: boolean;
  generated_at: string;
}
