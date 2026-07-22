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
 * Idempotent: re-ingesting a dumpId that's already in coverage_ingested_dumps
 * is a no-op (checked before doing any symbolication work, not just at the
 * DB-write layer) — repeated CI/manual ingestion calls for the same dump
 * never double-count hit_count.
 */

import { join } from 'path';
import { findCoverageDump } from '../../services/coverageDumpService.js';
import { findActiveCoverageSessionByCorrelationId } from '../../services/coverageSessionService.js';
import { isDumpAlreadyIngested, upsertCoverageUnits } from '../../services/coverageModelService.js';
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
  if (await isDumpAlreadyIngested(dumpId)) {
    const dump = await findCoverageDump(dumpId);
    return {
      dumpId,
      commitSha: dump?.commitSha ?? 'unknown',
      alreadyIngested: true,
      unitCount: 0,
      unresolvedCount: 0,
    };
  }

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

  const { unitCount, unresolvedCount } = await upsertCoverageUnits(
    dumpId,
    dump.commitSha,
    dump.agent,
    units,
  );

  logger.info(
    { dumpId, commitSha: dump.commitSha, unitCount, unresolvedCount },
    'coverageIngestionService: ingested coverage dump',
  );

  return {
    dumpId,
    commitSha: dump.commitSha,
    alreadyIngested: false,
    unitCount,
    unresolvedCount,
  };
}

/**
 * Correlates a dumpId to its originating session/test, for callers that
 * want ingestion results attributed the same way coverage_session_dumps
 * already does (MINCRM-610/612) — a thin pass-through, not a new
 * correlation mechanism.
 */
export async function findIngestionSessionCorrelation(correlationId: string) {
  return findActiveCoverageSessionByCorrelationId(correlationId);
}
