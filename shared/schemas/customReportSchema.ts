/**
 * Shared Zod schemas for custom report definitions (MINCRM-402).
 * Imported by both server (request validation) and client (API response typing).
 */

import { z } from 'zod';

export const REPORT_ENTITY_TYPES = ['contact', 'account', 'deal', 'lead', 'activity'] as const;
export type ReportEntityType = (typeof REPORT_ENTITY_TYPES)[number];

export const FILTER_OPERATORS = [
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'contains',
  'is_null',
  'is_not_null',
] as const;
export type FilterOperator = (typeof FILTER_OPERATORS)[number];

export const AGGREGATE_TYPES = ['count', 'sum'] as const;
export type AggregateType = (typeof AGGREGATE_TYPES)[number];

export const SORT_DIRECTIONS = ['asc', 'desc'] as const;
export type SortDirection = (typeof SORT_DIRECTIONS)[number];

/** A single filter row in the report builder. */
export const filterConditionSchema = z.object({
  field: z.string().min(1).max(100),
  operator: z.enum(FILTER_OPERATORS),
  /** Required for all operators except is_null / is_not_null. */
  value: z.string().nullable().optional(),
});
export type FilterCondition = z.infer<typeof filterConditionSchema>;

/** Optional aggregate definition — applied alongside the group_by field. */
export const aggregateSchema = z.object({
  type: z.enum(AGGREGATE_TYPES),
  /** Field to sum (ignored for count). */
  field: z.string().min(1).max(100).optional(),
});
export type Aggregate = z.infer<typeof aggregateSchema>;

/** The full report configuration stored in custom_reports.config. */
export const reportConfigSchema = z.object({
  selected_fields: z.array(z.string().min(1).max(100)).min(1).max(20),
  filters: z.array(filterConditionSchema).max(10).default([]),
  group_by: z.string().min(1).max(100).optional(),
  sort_field: z.string().min(1).max(100).optional(),
  sort_direction: z.enum(SORT_DIRECTIONS).optional(),
  aggregate: aggregateSchema.optional(),
  chart_type: z.enum(['bar', 'line']).optional(),
});
export type ReportConfig = z.infer<typeof reportConfigSchema>;

/** Request body for creating a new saved custom report. */
export const createCustomReportSchema = z.object({
  name: z
    .string({ required_error: 'Report name is required' })
    .min(1, 'Report name is required')
    .max(200, 'Report name must be 200 characters or fewer')
    .trim(),
  entity_type: z.enum(REPORT_ENTITY_TYPES),
  config: reportConfigSchema,
});
export type CreateCustomReportInput = z.infer<typeof createCustomReportSchema>;

/** Request body for updating a saved custom report. */
export const updateCustomReportSchema = z
  .object({
    name: z.string().min(1).max(200).trim().optional(),
    config: reportConfigSchema.optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided',
  });
export type UpdateCustomReportInput = z.infer<typeof updateCustomReportSchema>;

/** Shape of a custom_reports row as returned by the API. */
export const customReportResponseSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  entity_type: z.enum(REPORT_ENTITY_TYPES),
  config: reportConfigSchema,
  created_by: z.string().uuid().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type CustomReportResponse = z.infer<typeof customReportResponseSchema>;

/** Shape of a single executed report result row (column name → value). */
export type ReportResultRow = Record<string, string | number | null>;

/** Response from POST /api/v1/reports/custom/:id/run */
export const runReportResponseSchema = z.object({
  columns: z.array(z.string()),
  rows: z.array(z.record(z.union([z.string(), z.number(), z.null()]))),
  row_count: z.number().int(),
});
export type RunReportResponse = z.infer<typeof runReportResponseSchema>;
