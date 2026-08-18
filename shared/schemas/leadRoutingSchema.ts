/**
 * Shared types for the AI lead routing suggestion feature.
 * Used by both client and server.
 */

import { z } from 'zod';

export const LEAD_ROUTING_CONFIDENCE_LEVELS = ['high', 'medium', 'low'] as const;
export type LeadRoutingConfidence = (typeof LEAD_ROUTING_CONFIDENCE_LEVELS)[number];

export const LEAD_ROUTING_FACTOR_TYPES = [
  'territory_match',
  'industry_match',
  'workload',
  'win_rate',
  'availability',
] as const;
export type LeadRoutingFactorType = (typeof LEAD_ROUTING_FACTOR_TYPES)[number];

export interface LeadRoutingFactor {
  type: LeadRoutingFactorType;
  description: string;
}

/** Response shape for POST /api/v1/leads/routing-suggestion. Null (204/no body) when confidence is low. */
export interface LeadRoutingSuggestionResponse {
  suggested_rep_id: string;
  suggested_rep_name: string;
  confidence: LeadRoutingConfidence;
  contributing_factors: LeadRoutingFactor[];
}

/**
 * Schema for POST /api/v1/leads/routing-suggestion request body — the draft
 * lead's profile fields, before the lead is created. All optional since a
 * manager may request a suggestion having filled in only some fields; the
 * scoring service simply skips factors it can't evaluate.
 */
export const leadRoutingSuggestionRequestSchema = z.object({
  territory: z.string().trim().optional(),
  industry: z.string().trim().optional(),
  employee_range: z.string().trim().optional(),
  lead_source: z.string().trim().optional(),
});

export type LeadRoutingSuggestionRequest = z.infer<typeof leadRoutingSuggestionRequestSchema>;

/** Response entry shape for GET /api/v1/admin/ai/lead-routing/team-overrides. */
export interface TeamRoutingOverrideResponse {
  team_id: string;
  team_name: string;
  enabled: boolean;
  updated_at: string;
  updated_by: string | null;
}

/**
 * Schema for PUT /api/v1/admin/ai/lead-routing/team-overrides/:teamId request body.
 * enabled: null clears the override, falling back to the global flag state.
 */
export const setTeamRoutingOverrideSchema = z.object({
  enabled: z.boolean().nullable(),
});

export type SetTeamRoutingOverrideInput = z.infer<typeof setTeamRoutingOverrideSchema>;

/** Response shape for GET/PATCH /api/v1/admin/ai/lead-routing-config. */
export interface LeadRoutingConfigResponse {
  territory_weight: number;
  industry_weight: number;
  workload_weight: number;
  win_rate_weight: number;
  availability_weight: number;
  low_confidence_threshold: number;
  medium_confidence_threshold: number;
  min_closed_deals_for_win_rate: number;
  updated_at: string;
  updated_by: string | null;
}

/** Schema for PATCH /api/v1/admin/ai/lead-routing-config request body. */
export const setLeadRoutingConfigSchema = z
  .object({
    territory_weight: z.number().min(0).max(1),
    industry_weight: z.number().min(0).max(1),
    workload_weight: z.number().min(0).max(1),
    win_rate_weight: z.number().min(0).max(1),
    availability_weight: z.number().min(0).max(1),
    low_confidence_threshold: z.number().min(0).max(1),
    medium_confidence_threshold: z.number().min(0).max(1),
    min_closed_deals_for_win_rate: z.number().int().min(1),
  })
  .refine(
    (data) =>
      Math.abs(
        data.territory_weight +
          data.industry_weight +
          data.workload_weight +
          data.win_rate_weight +
          data.availability_weight -
          1,
      ) < 0.001,
    { message: 'Weights must sum to 1.0' },
  )
  .refine((data) => data.medium_confidence_threshold > data.low_confidence_threshold, {
    message: 'medium_confidence_threshold must be greater than low_confidence_threshold',
  });

export type SetLeadRoutingConfigInput = z.infer<typeof setLeadRoutingConfigSchema>;
