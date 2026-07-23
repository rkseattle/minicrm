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
 *
 * Test attribution (MINCRM-618): after resolving units, this module looks
 * up whether the dump being ingested has a coverage_session_dumps row (see
 * coverageSessionService.findCoverageSessionDumpByDumpId) with a non-null
 * test_id. If so, the SAME set of units is also linked to that test via
 * coverageMappingService.linkCoverageUnitsToTest, invoked as
 * upsertCoverageUnits' onUnitsUpserted callback so both writes commit in
 * the same transaction — a dump can never end up counted in coverage_units
 * but missing from coverage_test_links (or vice versa) due to a crash
 * between two separate transactions. A dump with no session attribution
 * (or a session attribution with a null test_id — e.g. a manual-recorder
 * check-in with no single associated test) is ingested into coverage_units
 * exactly as before, simply producing no coverage_test_links rows for it.
 */

import { join } from 'path';
import { findCoverageDump } from '../../services/coverageDumpService.js';
import { upsertCoverageUnits } from '../../services/coverageModelService.js';
import { linkCoverageUnitsToTest } from '../../services/coverageMappingService.js';
import type { CoverageTestLinkInput } from '../../services/coverageMappingService.js';
import { findCoverageSessionDumpByDumpId } from '../../services/coverageSessionService.js';
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

  // Looked up before the transaction so a session-attribution lookup
  // failure surfaces as a normal thrown error rather than happening deep
  // inside upsertCoverageUnits' held transaction.
  const sessionDump = await findCoverageSessionDumpByDumpId(dumpId);
  const testId = sessionDump?.testId ?? null;

  const { alreadyIngested, unitCount, unresolvedCount } = await upsertCoverageUnits(
    dumpId,
    dump.commitSha,
    dump.agent,
    units,
    testId
      ? async (client) => {
          const links: CoverageTestLinkInput[] = units.map((unit) => ({
            unitKey: unit.unitKey,
            branchId: unit.branchId,
            filePath: unit.filePath,
            hitCount: unit.hitCount,
          }));
          await linkCoverageUnitsToTest(
            client,
            dump.commitSha,
            testId,
            sessionDump?.testName ?? null,
            links,
          );
        }
      : undefined,
  );

  logger.info(
    { dumpId, commitSha: dump.commitSha, alreadyIngested, unitCount, unresolvedCount, testId },
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
