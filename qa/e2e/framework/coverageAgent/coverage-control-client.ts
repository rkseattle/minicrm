/**
 * Reference client for the coverage control API's backend verbs
 * (reset/snapshot/dump). Thin wrapper around RestClient — this file is the
 * canonical, tested example referenced from docs/dev/coverage.md's
 * "reference client" section.
 *
 * Requires an authenticated RestClient (admin session) and the
 * coverage_instrumentation feature flag enabled, since the control API
 * is admin-only and flag-gated.
 */

import type { RestClient } from '../clients/rest-client.js';

const RESET_ENDPOINT = '/api/v1/admin/coverage/reset';
const SNAPSHOT_ENDPOINT = '/api/v1/admin/coverage/snapshot';
const DUMP_ENDPOINT = '/api/v1/admin/coverage/dump';

/** Metadata describing a persisted (or snapshotted) coverage dump. */
export interface CoverageDumpMetadata {
  dumpId: string;
  agent: 'node-v8' | 'browser-istanbul';
  label: string;
  commitSha: string;
  capturedAt: string;
  format: 'v8-script-coverage' | 'istanbul';
  path: string;
}

/** Resets the backend V8 coverage agent's counters. */
export async function resetCoverage(restClient: RestClient): Promise<void> {
  await restClient.post(RESET_ENDPOINT, {});
}

/**
 * Reads current backend counters without persisting an artifact.
 * NOTE: this is not a non-destructive read — see docs/dev/coverage.md.
 */
export async function snapshotCoverage(
  restClient: RestClient,
  label?: string,
): Promise<CoverageDumpMetadata> {
  const response = await restClient.post<{ dump: CoverageDumpMetadata }>(SNAPSHOT_ENDPOINT, {
    label,
  });
  return response.body.dump;
}

/** Persists a tagged backend dump. */
export async function dumpCoverage(
  restClient: RestClient,
  label: string,
): Promise<CoverageDumpMetadata> {
  const response = await restClient.post<{ dump: CoverageDumpMetadata }>(DUMP_ENDPOINT, { label });
  return response.body.dump;
}
