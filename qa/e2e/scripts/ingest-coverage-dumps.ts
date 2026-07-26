#!/usr/bin/env tsx
/**
 * ingest-coverage-dumps.ts
 *
 * Post-run step for MINCRM-633's record mode: walks the server's coverage
 * dump index (index.jsonl under COVERAGE_DUMPS_ROOT) and ingests every dump
 * produced during this run into coverage_units/coverage_test_links via
 * POST /api/v1/admin/coverage/pipeline/ingest — the same endpoint
 * coverage-pipeline-client.ts already wraps for E2E functional specs.
 *
 * Why this exists: no CI job automatically triggers ingestion today
 * (docs/dev/coverage.md: "No scheduled or automatic trigger exists —
 * ingestion is manual/CI-triggered only"). Record mode's whole purpose is
 * to keep the mapping engine's coverage_test_links fresh with the FULL
 * suite's authoritative results, so a post-merge/nightly run that produces
 * dumps but never ingests them would silently defeat that purpose.
 *
 * Ingestion is idempotent (coverageIngestionService's coverage_ingested_dumps
 * claim-first pattern) — re-running this script against an already-ingested
 * dumpId is a safe no-op (alreadyIngested: true), not a double-count.
 *
 * Usage (from repo root):
 *   E2E_ADMIN_EMAIL=... E2E_ADMIN_PASSWORD=... COVERAGE_DUMPS_ROOT=... \
 *     npx tsx qa/e2e/scripts/ingest-coverage-dumps.ts
 *
 * Required environment variables:
 *   E2E_API_URL (or defaults to RestClient's own DEFAULT_BASE_URL)
 *   E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD — admin credentials (ingest is admin-only)
 *   COVERAGE_DUMPS_ROOT — the server process's dumps root (defaults to
 *     <server cwd>/coverage-dumps, matching coverageConfig.ts's own default)
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { request as playwrightRequest } from '@playwright/test';
import { RestClient } from '../framework/clients/rest-client.js';
import { loginAsAdmin } from '@behaviors/minicrm/auth.behaviors.js';
import { updateFeatureFlag } from '@behaviors/minicrm/feature-flags.behaviors.js';
import { ingestCoverageDump } from '../framework/coverageAgent/coverage-pipeline-client.js';

const INGESTION_FLAG_KEY = 'coverage_pipeline_ingestion';

interface DumpIndexEntry {
  dumpId: string;
  commitSha: string;
  capturedAt: string;
  metaPath: string;
}

function readDumpIndex(dumpsRoot: string): DumpIndexEntry[] {
  const indexPath = resolve(dumpsRoot, 'index.jsonl');
  if (!existsSync(indexPath)) {
    console.log(
      `[ingest-coverage-dumps] No index.jsonl found at ${indexPath} — nothing to ingest.`,
    );
    return [];
  }
  const raw = readFileSync(indexPath, 'utf8');
  return raw
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as DumpIndexEntry);
}

async function main(): Promise<void> {
  const dumpsRoot = process.env['COVERAGE_DUMPS_ROOT'] ?? resolve(process.cwd(), 'coverage-dumps');
  const entries = readDumpIndex(dumpsRoot);

  if (entries.length === 0) {
    return;
  }

  const context = await playwrightRequest.newContext();
  try {
    const restClient = new RestClient(context);
    await loginAsAdmin(restClient);
    await updateFeatureFlag(restClient, INGESTION_FLAG_KEY, { enabled: true });

    let ingested = 0;
    let alreadyIngested = 0;
    let failed = 0;

    for (const entry of entries) {
      try {
        const result = await ingestCoverageDump(restClient, entry.dumpId);
        if (result.alreadyIngested) {
          alreadyIngested++;
        } else {
          ingested++;
        }
      } catch (err) {
        failed++;
        console.error(
          `[ingest-coverage-dumps] Failed to ingest dump ${entry.dumpId} (commit ${entry.commitSha}): ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    console.log(
      `[ingest-coverage-dumps] ${entries.length} dump(s) found: ${ingested} newly ingested, ${alreadyIngested} already ingested, ${failed} failed.`,
    );

    if (failed > 0) {
      // A partial ingestion failure must not silently look like a fully
      // fresh map — record mode's whole point is trustworthy coverage
      // data, so a non-zero failure count fails this step visibly.
      process.exitCode = 1;
    }
  } finally {
    await context.dispose();
  }
}

main().catch((err: unknown) => {
  console.error(`[ingest-coverage-dumps] fatal: ${err instanceof Error ? err.stack : String(err)}`);
  process.exitCode = 1;
});
