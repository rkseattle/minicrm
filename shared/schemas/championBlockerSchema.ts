/**
 * Shared types for the AI champion/blocker detection feature.
 * Used by both client and server.
 */

export const CHAMPION_BLOCKER_STATUSES = [
  'champion',
  'likely_champion',
  'neutral',
  'likely_blocker',
  'blocker',
] as const;
export type ChampionBlockerStatus = (typeof CHAMPION_BLOCKER_STATUSES)[number];

export interface ChampionBlockerSignal {
  /** Short quote or paraphrase of the contributing signal. */
  description: string;
  detected_at: string;
}

export interface ContactChampionBlockerResponse {
  contact_id: string;
  /** Effective status — the rep override when set, otherwise the AI-inferred status. */
  status: ChampionBlockerStatus;
  /** True when the effective status came from a rep override rather than AI inference. */
  is_overridden: boolean;
  /** Most recent 1-2 contributing signals, most recent first. */
  recent_signals: ChampionBlockerSignal[];
  /** True when a rep has dismissed the classification via "Not accurate". */
  dismissed: boolean;
  updated_at: string;
}

export interface StakeholderMapEntry {
  contact_id: string;
  first_name: string;
  last_name: string;
  status: ChampionBlockerStatus;
  is_overridden: boolean;
  dismissed: boolean;
  last_activity_at: string | null;
}

export interface StakeholderMapResponse {
  contacts: StakeholderMapEntry[];
  champion_count: number;
  blocker_count: number;
  /** True when only one contact is engaged and the deal value exceeds the configured threshold. */
  single_threaded_risk: boolean;
}
