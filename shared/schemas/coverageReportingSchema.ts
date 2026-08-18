/**
 * Shared Zod schemas for the Coverage/TIA reporting query API.
 * Imported by the server (request validation +
 * response typing) and the standalone coverage-dashboard app.
 */

import { z } from 'zod';

const MAX_TREND_LIMIT = 500;
const MAX_GAP_LIMIT = 5000;

// ── Summary & trend ────────────────────────────────────────────

export const getCoverageSummaryRequestSchema = z.object({
  commitSha: z.string().min(1, 'commitSha is required'),
});

export type GetCoverageSummaryRequest = z.infer<typeof getCoverageSummaryRequestSchema>;

export const coverageSummarySchema = z.object({
  commitSha: z.string(),
  overallUnitCount: z.number().int().nonnegative(),
  overallCoveredUnitCount: z.number().int().nonnegative(),
  overallCoveragePercent: z.number().min(0).max(100),
  apiUnitCount: z.number().int().nonnegative(),
  apiCoveredUnitCount: z.number().int().nonnegative(),
  apiCoveragePercent: z.number().min(0).max(100),
  frontendUnitCount: z.number().int().nonnegative(),
  frontendCoveredUnitCount: z.number().int().nonnegative(),
  frontendCoveragePercent: z.number().min(0).max(100),
  automatedCoveredUnitCount: z.number().int().nonnegative(),
  manualCoveredUnitCount: z.number().int().nonnegative(),
  lastUpdatedAt: z.string(),
});

export type CoverageSummary = z.infer<typeof coverageSummarySchema>;

export const getCoverageTrendRequestSchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_TREND_LIMIT).default(30),
});

export type GetCoverageTrendRequest = z.infer<typeof getCoverageTrendRequestSchema>;

export const getCoverageTrendResponseSchema = z.object({
  results: z.array(coverageSummarySchema),
});

export type GetCoverageTrendResponse = z.infer<typeof getCoverageTrendResponseSchema>;

// ── Gap analysis ──────────────────────────────────────────────

export const getGapsRequestSchema = z.object({
  commitSha: z.string().min(1, 'commitSha is required'),
  baseSha: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(MAX_GAP_LIMIT).default(1000),
});

export type GetGapsRequest = z.infer<typeof getGapsRequestSchema>;

export const deadZoneUnitSchema = z.object({
  filePath: z.string(),
  unitKey: z.string(),
  branchId: z.string().nullable(),
  granularity: z.enum(['branch', 'function']),
  resolved: z.boolean(),
});

export type DeadZoneUnit = z.infer<typeof deadZoneUnitSchema>;

export const changedUntestedUnitSchema = z.object({
  filePath: z.string(),
  unitKey: z.string(),
  changeKind: z.enum(['new', 'deleted', 'in-line', 'refactor', 'ambiguous']),
});

export type ChangedUntestedUnit = z.infer<typeof changedUntestedUnitSchema>;

export const getGapsResponseSchema = z.object({
  deadZoneUnits: z.array(deadZoneUnitSchema),
  neverTakenBranches: z.array(deadZoneUnitSchema),
  // Only populated when the request included baseSha — computing a diff
  // is meaningfully more expensive than the two coverage_units-only lists
  // above, and has no meaning without a base commit to diff against.
  changedUntestedUnits: z.array(changedUntestedUnitSchema).nullable(),
});

export type GetGapsResponse = z.infer<typeof getGapsResponseSchema>;

// ── Per-issue traceability & TIA value metrics ────────────────

export const getIssueCoverageRequestSchema = z.object({
  commitSha: z.string().min(1, 'commitSha is required'),
});

export type GetIssueCoverageRequest = z.infer<typeof getIssueCoverageRequestSchema>;

export const issueCoverageSchema = z.object({
  issueKey: z.string(),
  sessionCount: z.number().int().nonnegative(),
  coveredUnitCount: z.number().int().nonnegative(),
  testIds: z.array(z.string()),
});

export type IssueCoverage = z.infer<typeof issueCoverageSchema>;

export const listIssueKeysRequestSchema = z.object({
  commitSha: z.string().min(1, 'commitSha is required'),
});

export type ListIssueKeysRequest = z.infer<typeof listIssueKeysRequestSchema>;

export const listIssueKeysResponseSchema = z.object({
  issueKeys: z.array(z.string()),
});

export type ListIssueKeysResponse = z.infer<typeof listIssueKeysResponseSchema>;

export const getTiaValueMetricsRequestSchema = z.object({
  fromSha: z.string().min(1, 'fromSha is required'),
  toSha: z.string().min(1, 'toSha is required'),
});

export type GetTiaValueMetricsRequest = z.infer<typeof getTiaValueMetricsRequestSchema>;

export const tiaValueMetricsSchema = z.object({
  fromSha: z.string(),
  toSha: z.string(),
  totalBuilds: z.number().int().nonnegative(),
  averageApiCoveragePercent: z.number().min(0).max(100),
  averageFrontendCoveragePercent: z.number().min(0).max(100),
});

export type TiaValueMetrics = z.infer<typeof tiaValueMetricsSchema>;
