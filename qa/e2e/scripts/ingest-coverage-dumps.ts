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
import {
  loginAsAdmin,
  refreshAdminRestSession,
  resolveAuthCookieName,
} from '@behaviors/minicrm/auth.behaviors.js';
import { applySessionUpkeep, type SessionUpkeep } from '../framework/auth/token-expiry.js';
import { ingestCoverageDump } from '../framework/coverageAgent/coverage-pipeline-client.js';

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
    // Kept even though the loop's own expiry check would mint a session on its
    // first iteration: this fails fast on bad or missing credentials before any
    // dump is touched, rather than surfacing the same error partway through a
    // run that has already reported progress.
    await loginAsAdmin(restClient);
    // No feature flag to switch on first (MINCRM-685): the ingestion route is
    // gated by COVERAGE_PIPELINE_INGESTION at process boot, which the server
    // this script targets must already have set — .github/actions/e2e-infra's
    // coverage-instrumentation input supplies it for record-mode runs. A PATCH
    // here would 404 on a flag row that no longer exists and abort the whole
    // ingestion before the first dump.

    let ingested = 0;
    let alreadyIngested = 0;
    let failed = 0;
    let refreshed = 0;

    const sessionUpkeep: SessionUpkeep<RestClient> = {
      cookieName: resolveAuthCookieName(),
      refresh: refreshAdminRestSession,
    };

    for (const entry of entries) {
      // Renew the session BEFORE it can expire, not after a 401 comes back.
      //
      // The token minted by loginAsAdmin above carries a 30-minute sliding
      // idle expiry, and sliding is client-initiated: the server's
      // authenticate middleware verifies the cookie without ever re-issuing
      // it, so making requests does not keep the session alive. This loop runs
      // ~1000 dumps at roughly 2s each, which crosses that window well before
      // it finishes — every dump after the crossing 401s, and the run reports
      // a partial map as a hard failure.
      //
      // A retry inside the catch below would be the wrong shape: it cannot
      // tell an expired token from a revoked admin, so it would retry a
      // permanently-failing call once per remaining dump. Checking the token's
      // own claims costs a local base64 decode and is exact.
      //
      // Shares the fixture's upkeep helper rather than repeating the check —
      // one implementation, and this path inherits its unit tests. Imported
      // from the auth module, not the fixture module: the latter calls
      // test.extend() at import time and would build a Playwright fixture graph
      // as a side effect of running this script.
      //
      // throwOnFailure, unlike the per-test fixture: if the session cannot be
      // renewed then every remaining dump is guaranteed to 401, so continuing
      // would turn one clear error into hundreds of misleading ones and report
      // a partial map as though the refresh had worked. Propagates to main()'s
      // catch, which exits non-zero.
      const upkeep = await applySessionUpkeep(restClient, sessionUpkeep, {
        throwOnFailure: true,
      });
      if (upkeep.refreshed) {
        refreshed++;
      }

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
      `[ingest-coverage-dumps] ${entries.length} dump(s) found: ${ingested} newly ingested, ${alreadyIngested} already ingested, ${failed} failed, ${refreshed} session refresh(es).`,
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
