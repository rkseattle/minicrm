/**
 * Shared Zod schemas for the Coverage/TIA data pipeline.
 * Imported by the server (request validation + response typing) and, for the
 * ingestion trigger request, the QA E2E workspace (CI-triggered ingestion).
 */

import { z } from 'zod';
import { coverageDumpAgentSchema } from './coverageSchema.js';

/** Coverage detail level a coverage_units row was captured/resolved at. */
export const coverageUnitGranularitySchema = z.enum(['branch', 'function']);

export const ingestCoverageDumpRequestSchema = z.object({
  dumpId: z.string().uuid(),
});

export type IngestCoverageDumpRequest = z.infer<typeof ingestCoverageDumpRequestSchema>;

/** Result of ingesting+symbolicating a single dump into coverage_units. */
export const ingestCoverageDumpResultSchema = z.object({
  dumpId: z.string().uuid(),
  commitSha: z.string(),
  /** True when this dumpId had already been ingested — the call was a no-op. */
  alreadyIngested: z.boolean(),
  unitCount: z.number().int(),
  unresolvedCount: z.number().int(),
});

export type IngestCoverageDumpResult = z.infer<typeof ingestCoverageDumpResultSchema>;

/** A single normalized, symbolicated coverage record — the pipeline's storage-model row. */
export const coverageUnitSchema = z.object({
  id: z.string().uuid(),
  commitSha: z.string(),
  filePath: z.string(),
  unitKey: z.string(),
  branchId: z.string().nullable(),
  granularity: coverageUnitGranularitySchema,
  agent: coverageDumpAgentSchema,
  hitCount: z.number().int(),
  resolved: z.boolean(),
  unresolvedReason: z.string().nullable(),
  firstSeenAt: z.string(),
  lastSeenAt: z.string(),
  /** Recency-decayed confidence, 0.0-1.0. See coverageReconciliationService. */
  confidenceScore: z.number().min(0).max(1),
  /** When build-time reconciliation last validated this row, or null if never reconciled. */
  lastReconciledAt: z.string().nullable(),
});

export type CoverageUnit = z.infer<typeof coverageUnitSchema>;
