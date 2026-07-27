/**
 * Internal shape produced by symbolication, consumed by ingestion's DB
 * upsert. (MINCRM-614, MINCRM-615)
 *
 * Distinct from the shared coverageUnitSchema (shared/schemas/coveragePipelineSchema.ts):
 * that schema is the DB row / API response shape (has id, firstSeenAt,
 * lastSeenAt, hitCount already merged across ingestions). This type is the
 * per-dump symbolication *output*, before it has been merged into storage.
 */

import type { CoverageDumpSource } from '../sdk/CoverageAgentPlugin.js';
import type { CoverageUnitGranularity } from './coverageSymbolicationService.js';

/** A single resolved (or flagged-unresolvable) coverage unit from one dump. */
export interface NormalizedCoverageUnit {
  filePath: string;
  /** Qualified function/method signature this unit belongs to. */
  unitKey: string;
  /** Branch/block identifier within the unit, or null for function-granularity units. */
  branchId: string | null;
  granularity: CoverageUnitGranularity;
  hitCount: number;
  resolved: boolean;
  unresolvedReason: string | null;
}

/** Result of symbolicating one raw dump payload. */
export interface SymbolicationResult {
  agent: CoverageDumpSource;
  units: NormalizedCoverageUnit[];
}
