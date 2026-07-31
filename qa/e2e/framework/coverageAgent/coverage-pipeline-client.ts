/**
 * Reference client for the coverage pipeline ingestion endpoint. Thin
 * wrapper around RestClient — mirrors coverage-control-client.ts's own
 * role as the canonical, tested example referenced from
 * docs/dev/coverage.md's "reference client" section.
 *
 * Requires an authenticated RestClient (admin session). The endpoint is
 * admin-only, and the server registers it only when its own boot-time
 * environment gate is set — so an unconfigured server answers 404 rather than
 * a permission error.
 */

import type { RestClient } from '../clients/rest-client.js';

const INGEST_ENDPOINT = '/api/v1/admin/coverage/pipeline/ingest';

/** Result of normalizing and symbolicating a single dump into coverage_units. */
export interface IngestCoverageDumpResult {
  dumpId: string;
  commitSha: string;
  alreadyIngested: boolean;
  unitCount: number;
  unresolvedCount: number;
}

/**
 * Normalizes and symbolicates a single already-persisted raw coverage dump
 * into the coverage_units storage model. Idempotent — ingesting a dumpId
 * that was already ingested returns alreadyIngested=true rather than
 * double-counting hit_count.
 */
export async function ingestCoverageDump(
  restClient: RestClient,
  dumpId: string,
): Promise<IngestCoverageDumpResult> {
  const response = await restClient.post<{ result: IngestCoverageDumpResult }>(INGEST_ENDPOINT, {
    dumpId,
  });
  return response.body.result;
}
