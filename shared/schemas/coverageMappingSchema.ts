/**
 * Shared Zod schemas for the Coverage/TIA mapping query API.
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
 * — a documented, versioned interface; coverage_test_links'
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
  /** Spec file path (relative to repo root) that produced this test_id, or null if the attributing session never captured one. */
  testFile: z.string().nullable(),
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

// ── Typeahead search — backs the coverage-dashboard app's
// unit-key/test-ID pickers, since neither field is something a caller can
// plausibly type from memory. Both always require a non-empty search term
// (never "list everything") — a single commit's coverage_units/
// coverage_test_links can run into the hundreds of thousands of rows, so an
// unscoped listing is not viable at real scale. ──────────────────────────

const MAX_SEARCH_LIMIT = 50;

export const searchUnitKeysRequestSchema = z.object({
  commitSha: z.string().min(1, 'commitSha is required'),
  search: z.string().min(1, 'search is required'),
  limit: z.coerce.number().int().min(1).max(MAX_SEARCH_LIMIT).default(20),
});

export type SearchUnitKeysRequest = z.infer<typeof searchUnitKeysRequestSchema>;

export const unitKeySearchResultSchema = z.object({
  unitKey: z.string(),
  filePath: z.string(),
});

export type UnitKeySearchResult = z.infer<typeof unitKeySearchResultSchema>;

export const searchUnitKeysResponseSchema = z.object({
  results: z.array(unitKeySearchResultSchema),
});

export type SearchUnitKeysResponse = z.infer<typeof searchUnitKeysResponseSchema>;

export const searchTestIdsRequestSchema = z.object({
  commitSha: z.string().min(1, 'commitSha is required'),
  search: z.string().min(1, 'search is required'),
  limit: z.coerce.number().int().min(1).max(MAX_SEARCH_LIMIT).default(20),
});

export type SearchTestIdsRequest = z.infer<typeof searchTestIdsRequestSchema>;

export const testIdSearchResultSchema = z.object({
  testId: z.string(),
  testName: z.string().nullable(),
});

export type TestIdSearchResult = z.infer<typeof testIdSearchResultSchema>;

export const searchTestIdsResponseSchema = z.object({
  results: z.array(testIdSearchResultSchema),
});

export type SearchTestIdsResponse = z.infer<typeof searchTestIdsResponseSchema>;
