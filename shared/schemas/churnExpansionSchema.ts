/**
 * Shared types for the AI churn/expansion signal detection feature.
 * Used by both client and server.
 */

export const CHURN_EXPANSION_SIGNAL_TYPES = ['churn_risk', 'expansion'] as const;
export type ChurnExpansionSignalType = (typeof CHURN_EXPANSION_SIGNAL_TYPES)[number];

export interface ChurnExpansionFactor {
  description: string;
}

export interface AccountChurnExpansionSignal {
  id: string;
  signal_type: ChurnExpansionSignalType;
  confidence: number;
  contributing_factors: ChurnExpansionFactor[];
  detected_at: string;
}

export interface AccountChurnExpansionResponse {
  /** Active (not cleared) signal for the account, or null when none is active. */
  signal: AccountChurnExpansionSignal | null;
}

export interface ChurnExpansionAccountSummary {
  account_id: string;
  account_name: string;
  owner_id: string;
  signal: AccountChurnExpansionSignal;
}

export interface ChurnExpansionListResponse {
  at_risk: ChurnExpansionAccountSummary[];
  expansion: ChurnExpansionAccountSummary[];
}
