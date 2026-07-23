/**
 * Shared Zod schemas for the Coverage/TIA mapping query API. (MINCRM-621)
 * Imported by the server (request validation + response typing) and the QA
 * E2E workspace (reference client).
 */

import { z } from 'zod';

export const findTestsForUnitRequestSchema = z.object({
  commitSha: z.string().min(1, 'commitSha is required'),
  unitKey: z.string().min(1, 'unitKey is required'),
  branchId: z.string().min(1).optional(),
});

export type FindTestsForUnitRequest = z.infer<typeof findTestsForUnitRequestSchema>;

export const findUnitsForTestRequestSchema = z.object({
  commitSha: z.string().min(1, 'commitSha is required'),
  testId: z.string().min(1, 'testId is required'),
});

export type FindUnitsForTestRequest = z.infer<typeof findUnitsForTestRequestSchema>;

/**
 * A single mapping result row — deliberately NOT the same shape as
 * coverageMappingService's own CoverageTestLink DB type, even though the
 * fields largely overlap. This is the documented, versioned wire contract
 * (MINCRM-621's "documented, versioned interface" AC); coverage_test_links'
 * own column set is an implementation detail free to change independently
 * as long as this response shape is preserved.
 */
export const coverageMappingResultSchema = z.object({
  commitSha: z.string(),
  unitKey: z.string(),
  branchId: z.string().nullable(),
  filePath: z.string(),
  testId: z.string(),
  testName: z.string().nullable(),
  hitCount: z.number().int(),
  firstSeenAt: z.string(),
  lastSeenAt: z.string(),
  /** Recency-decayed confidence, 0.0-1.0, or null if no matching coverage_units row was found (e.g. pruned by reconciliation). */
  confidenceScore: z.number().min(0).max(1).nullable(),
  /** When build-time reconciliation last validated the underlying coverage_units row, or null. */
  lastReconciledAt: z.string().nullable(),
});

export type CoverageMappingResult = z.infer<typeof coverageMappingResultSchema>;

export const findTestsForUnitResponseSchema = z.object({
  results: z.array(coverageMappingResultSchema),
});

export type FindTestsForUnitResponse = z.infer<typeof findTestsForUnitResponseSchema>;

export const findUnitsForTestResponseSchema = z.object({
  results: z.array(coverageMappingResultSchema),
});

export type FindUnitsForTestResponse = z.infer<typeof findUnitsForTestResponseSchema>;
