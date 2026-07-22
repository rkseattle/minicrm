/**
 * Coverage/TIA ingestion & normalization service. (MINCRM-614)
 *
 * Reads a single already-persisted raw coverage dump (file-based, see
 * coverageAgent/dumpIndex.ts / coverageDumpService.findCoverageDump — Phase
 * 1's storage decision, unchanged by this phase), symbolicates it via
 * coverageSymbolicationService (MINCRM-615), and upserts the result into
 * the version-anchored coverage_units model via coverageModelService
 * (MINCRM-616).
 *
 * Idempotent AND race-safe: re-ingesting a dumpId that's already in
 * coverage_ingested_dumps is a no-op. The race-safety itself lives in
 * coverageModelService.upsertCoverageUnits (an atomic claim-then-write
 * transaction) — this module still symbolicates before calling it (so a
 * concurrent duplicate call does real, wasted symbolication work that gets
 * discarded rather than skipping it up front), but never double-counts
 * hit_count even if two calls for the same dumpId race, unlike a
 * check-then-act pattern split across two separate round-trips would.
 */

import { join } from 'path';
import { findCoverageDump } from '../../services/coverageDumpService.js';
import { upsertCoverageUnits } from '../../services/coverageModelService.js';
import { COVERAGE_DUMPS_ROOT } from '../coverageConfig.js';
import { readRawDumpPayload, symbolicateCoverageDump } from './coverageSymbolicationService.js';
import type { IngestCoverageDumpResult } from '@minicrm/shared/schemas/coveragePipelineSchema.js';
import logger from '../../logger.js';

/** Raised when the requested dumpId has no known coverage dump. */
export class CoverageDumpNotFoundError extends Error {
  readonly code = 'COVERAGE_DUMP_NOT_FOUND';
  constructor(dumpId: string) {
    super(`Coverage dump ${dumpId} not found`);
    this.name = 'CoverageDumpNotFoundError';
  }
}

/** Raised when a dump's raw payload file is missing, unreadable, or not valid JSON. */
export class CoverageDumpMalformedError extends Error {
  readonly code = 'COVERAGE_DUMP_MALFORMED';
  constructor(dumpId: string, cause: string) {
    super(`Coverage dump ${dumpId} could not be read or parsed: ${cause}`);
    this.name = 'CoverageDumpMalformedError';
  }
}

export interface IngestCoverageDumpOptions {
  /**
   * Repo root the dump's commitSha was captured/checked out at, used to
   * resolve backend V8 script URLs back to real files on disk. Defaults to
   * process.cwd() — the same assumption coverageConfig.ts already makes for
   * where the running process's own source lives.
   */
  sourceRoot?: string;
}

/**
 * Ingests a single coverage dump by ID: reads its raw payload, symbolicates
 * it, and merges the result into coverage_units. Safe to call multiple
 * times for the same dumpId (see module docblock).
 */
export async function ingestCoverageDump(
  dumpId: string,
  options: IngestCoverageDumpOptions = {},
): Promise<IngestCoverageDumpResult> {
  const dump = await findCoverageDump(dumpId);
  if (!dump) {
    throw new CoverageDumpNotFoundError(dumpId);
  }

  const payloadPath = join(COVERAGE_DUMPS_ROOT, dump.path);
  let payload: unknown;
  try {
    payload = await readRawDumpPayload(payloadPath);
  } catch (err) {
    throw new CoverageDumpMalformedError(
      dumpId,
      err instanceof Error ? err.message : 'unreadable or invalid JSON',
    );
  }

  const sourceRoot = options.sourceRoot ?? process.cwd();
  const { units } = await symbolicateCoverageDump(dump.agent, dump.format, payload, { sourceRoot });

  const { alreadyIngested, unitCount, unresolvedCount } = await upsertCoverageUnits(
    dumpId,
    dump.commitSha,
    dump.agent,
    units,
  );

  logger.info(
    { dumpId, commitSha: dump.commitSha, alreadyIngested, unitCount, unresolvedCount },
    'coverageIngestionService: ingested coverage dump',
  );

  return {
    dumpId,
    commitSha: dump.commitSha,
    alreadyIngested,
    unitCount,
    unresolvedCount,
  };
}
