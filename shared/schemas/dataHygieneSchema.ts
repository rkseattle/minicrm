/**
 * Shared types for the AI data hygiene assistant feature.
 * Used by both client and server.
 */

import { z } from 'zod';

export const DATA_HYGIENE_ENTITY_TYPES = ['contact', 'account', 'opportunity'] as const;
export type DataHygieneEntityType = (typeof DATA_HYGIENE_ENTITY_TYPES)[number];

export const DATA_HYGIENE_ISSUE_TYPES = [
  // Contact issues
  'contact_no_activity',
  'contact_missing_contact_info',
  'contact_stale_title',
  'contact_unresolvable_email_domain',
  'contact_duplicate',
  // Account issues
  'account_no_contacts',
  'account_no_activity',
  'account_website_unreachable',
  'account_missing_firmographics',
  // Opportunity issues
  'opportunity_no_activity',
  'opportunity_close_date_passed',
  'opportunity_no_contact',
  'opportunity_zero_value',
] as const;
export type DataHygieneIssueType = (typeof DATA_HYGIENE_ISSUE_TYPES)[number];

export const DATA_HYGIENE_STATUSES = ['open', 'dismissed'] as const;
export type DataHygieneStatus = (typeof DATA_HYGIENE_STATUSES)[number];

export interface DataHygieneFinding {
  id: string;
  entity_type: DataHygieneEntityType;
  entity_id: string;
  /** Denormalized at read time from the entity's own name/title field — not persisted. */
  entity_name: string;
  issue_type: DataHygieneIssueType;
  /** Only set for 'contact_duplicate' findings — the matched counterpart contact's ID. */
  related_entity_id: string | null;
  /** Denormalized at read time — the related contact's display name, when related_entity_id is set. */
  related_entity_name: string | null;
  owner_id: string;
  last_activity_at: string | null;
  suggested_action: string;
  status: DataHygieneStatus;
  dismissed_until: string | null;
  dismissed_reason: string | null;
  detected_at: string;
  updated_at: string;
}

export interface DataHygieneQueueResponse {
  findings: DataHygieneFinding[];
  total: number;
}

export interface DataHygieneConfigResponse {
  contact_inactivity_days: number;
  account_inactivity_days: number;
  title_staleness_days: number;
  opportunity_inactivity_days: number;
  dismiss_suppression_days: number;
  weekly_digest_enabled: boolean;
  updated_at: string;
  updated_by: string | null;
}

/** Schema for PATCH /api/v1/admin/ai/data-hygiene-config request body. */
export const setDataHygieneConfigSchema = z.object({
  contact_inactivity_days: z.number().int().min(1),
  account_inactivity_days: z.number().int().min(1),
  title_staleness_days: z.number().int().min(1),
  opportunity_inactivity_days: z.number().int().min(1),
  dismiss_suppression_days: z.number().int().min(1),
  weekly_digest_enabled: z.boolean(),
});
export type SetDataHygieneConfigInput = z.infer<typeof setDataHygieneConfigSchema>;

/** Schema for POST /api/v1/data-hygiene/findings/:id/dismiss request body. */
export const dismissHygieneFindingSchema = z.object({
  reason: z.string().trim().min(1, 'A reason is required to dismiss a finding'),
});
export type DismissHygieneFindingInput = z.infer<typeof dismissHygieneFindingSchema>;

/**
 * Schema for GET /api/v1/data-hygiene/findings query params. scope=mine (default)
 * restricts to the caller's own records; scope=all is admin-only.
 */
export const listHygieneFindingsQuerySchema = z.object({
  scope: z.enum(['mine', 'all']).optional(),
  entity_type: z.enum(DATA_HYGIENE_ENTITY_TYPES).optional(),
});
export type ListHygieneFindingsQuery = z.infer<typeof listHygieneFindingsQuerySchema>;
