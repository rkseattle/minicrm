/**
 * Shared types for the AI warm introduction path mapping feature.
 * Used by both client and server.
 */

export interface WarmIntroPathLink {
  contact_id: string;
  first_name: string;
  last_name: string;
  title: string | null;
  /** 0-1 heuristic strength score for this hop of the path. */
  relationship_strength: number;
}

export interface WarmIntroPath {
  /** Rep -> known contact -> target contact, in traversal order. */
  links: WarmIntroPathLink[];
  /** Overall strength of the path (lowest-strength hop, capped at 2 hops per the AC). */
  path_strength: number;
  suggested_introduction_message: string;
}

export interface WarmIntroPathResponse {
  target_contact_id: string;
  paths: WarmIntroPath[];
}
