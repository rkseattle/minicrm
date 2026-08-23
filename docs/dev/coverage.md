# Coverage/TIA Instrumentation

Runtime code coverage collection from the live MiniCRM stack — backend and frontend — for functional/E2E and manual-exploratory testing. Foundation for the broader Coverage/TIA (Test Impact Analysis) initiative (MINCRM-603). Phase 1 covers instrumentation and collection (MINCRM-604, MINCRM-605, MINCRM-606, MINCRM-607). Phase 2 (this document's [Session Management](#session-management-mincrm-609612) section) adds session grouping, correlation-ID attribution, and a manual-testing recorder (MINCRM-609, MINCRM-610, MINCRM-611, MINCRM-612). Phase 3 (this document's [Coverage Data Pipeline](#coverage-data-pipeline-mincrm-614615616) section) normalizes, symbolicates, and stores raw dumps in a version-anchored model (MINCRM-614, MINCRM-615, MINCRM-616). Phase 4 (this document's [Mapping Engine](#mapping-engine-mincrm-618619620621-pr-tia-4) section) builds the bidirectional code⇄test index, stable structural keys, confidence/freshness scoring, and a query API on top (MINCRM-618, MINCRM-619, MINCRM-620, MINCRM-621). Phase 5 (this document's [Change Impact Analysis & Test Selection](#change-impact-analysis--test-selection-mincrm-623624625626627-pr-tia-6) section) turns a git diff into a test selection decision (MINCRM-623, MINCRM-624, MINCRM-625, MINCRM-626, MINCRM-627). Phase 6 (this document's [Reporting & Gap Analysis](#reporting--gap-analysis-mincrm-629630631-pr-tia-7) section) adds a per-build coverage rollup and read-only reporting/gap-analysis query API for the standalone coverage-dashboard tool (MINCRM-629, MINCRM-630, MINCRM-631). See [Deferred to later phases](#deferred-to-later-phases) for what remains intentionally out of scope.

## Contents

- [Files](#files)
  - [Phase 2 — Session management files](#phase-2--session-management-files)
  - [Phase 3 — Coverage data pipeline files](#phase-3--coverage-data-pipeline-files)
  - [Phase 4 — Mapping engine files](#phase-4--mapping-engine-files)
  - [Phase 5 — Change impact analysis & test selection files](#phase-5--change-impact-analysis--test-selection-files)
  - [Phase 7 — Platform governance files (MINCRM-637)](#phase-7--platform-governance-files-mincrm-637)
  - [Phase 6 — Reporting & gap analysis files](#phase-6--reporting--gap-analysis-files)
- [Reporting & Gap Analysis (MINCRM-629/630/631, `pr-tia-7`)](#reporting--gap-analysis-mincrm-629630631-pr-tia-7)
  - [Per-build rollup (`coverage_build_summary`)](#per-build-rollup-coverage_build_summary)
  - [Query endpoints](#query-endpoints)
- [Standalone Dashboard App (`coverage-dashboard/`, MINCRM-629)](#standalone-dashboard-app-coverage-dashboard-mincrm-629)
  - [No-login mode (MINCRM-636/637)](#no-login-mode-mincrm-636637)
- [Mounting](#mounting)
- [Access Control (MINCRM-637)](#access-control-mincrm-637)
- [Policy Configuration (MINCRM-637)](#policy-configuration-mincrm-637)
  - [No feature flags](#no-feature-flags)
  - [Env vars (boot-time, resolved once)](#env-vars-boot-time-resolved-once)
  - [Scheduled retention pruning](#scheduled-retention-pruning)
- [Health & Observability (MINCRM-637)](#health--observability-mincrm-637)
  - [`GET /api/v1/admin/coverage/health`](#get-apiv1admincoveragehealth)
  - [Operational logging](#operational-logging)
- [Coverage Database](#coverage-database)
- [Backend Agent (MINCRM-604)](#backend-agent-mincrm-604)
- [Agent & Harness Adapter SDK (MINCRM-636)](#agent--harness-adapter-sdk-mincrm-636)
- [Frontend Agent (MINCRM-605)](#frontend-agent-mincrm-605)
- [Control API (MINCRM-606)](#control-api-mincrm-606)
  - [Reference client](#reference-client)
- [Low-Overhead Mode (MINCRM-607)](#low-overhead-mode-mincrm-607)
  - [Measured overhead](#measured-overhead)
- [Session Management (MINCRM-609..612)](#session-management-mincrm-609612)
  - [Data model](#data-model)
  - [Correlation-ID propagation](#correlation-id-propagation)
  - [Session control API](#session-control-api)
  - [E2E harness hooks (MINCRM-609)](#e2e-harness-hooks-mincrm-609)
  - [Manual-testing session recorder (MINCRM-611)](#manual-testing-session-recorder-mincrm-611)
- [Coverage Data Pipeline (MINCRM-614/615/616)](#coverage-data-pipeline-mincrm-614615616)
  - [Ingestion & normalization (MINCRM-614)](#ingestion--normalization-mincrm-614)
  - [Symbolication (MINCRM-615)](#symbolication-mincrm-615)
  - [Version-anchored storage model (MINCRM-616)](#version-anchored-storage-model-mincrm-616)
  - [Ingestion trigger endpoint](#ingestion-trigger-endpoint)
- [Local / CI / Shared-env setup](#local--ci--shared-env-setup)
- [Mapping Engine (MINCRM-618/619/620/621, `pr-tia-4`)](#mapping-engine-mincrm-618619620621-pr-tia-4)
  - [Stable structural keys (MINCRM-619)](#stable-structural-keys-mincrm-619)
  - [Bidirectional code⇄test index (MINCRM-618)](#bidirectional-codetest-index-mincrm-618)
  - [Confidence/freshness scoring & reconciliation (MINCRM-620)](#confidencefreshness-scoring--reconciliation-mincrm-620)
  - [Mapping query API (MINCRM-621)](#mapping-query-api-mincrm-621)
- [Change Impact Analysis & Test Selection (MINCRM-623/624/625/626/627, `pr-tia-6`)](#change-impact-analysis--test-selection-mincrm-623624625626627-pr-tia-6)
  - [Git-diff change detector (MINCRM-623)](#git-diff-change-detector-mincrm-623)
  - [Test selection algorithm (MINCRM-624, batched lookups MINCRM-637)](#test-selection-algorithm-mincrm-624-batched-lookups-mincrm-637)
  - [Config/infra dependency graph (MINCRM-625)](#configinfra-dependency-graph-mincrm-625)
  - [Safety-net selection policy (MINCRM-626)](#safety-net-selection-policy-mincrm-626)
  - [Pluggable scoring interface (MINCRM-627)](#pluggable-scoring-interface-mincrm-627)
- [Record Mode — the authoritative run (MINCRM-633/687)](#record-mode--the-authoritative-run-mincrm-633687)
  - [The environment contract](#the-environment-contract)
  - [Both Playwright projects run](#both-playwright-projects-run)
  - [How the attestation gate treats skips (MINCRM-687)](#how-the-attestation-gate-treats-skips-mincrm-687)
  - [Why the run is slow, and what that does not affect](#why-the-run-is-slow-and-what-that-does-not-affect)
  - [Reading a failed run](#reading-a-failed-run)
  - [Is attestation per-test or per-file? (MINCRM-705)](#is-attestation-per-test-or-per-file-mincrm-705)
  - [Local buildSha provenance (MINCRM-688)](#local-buildsha-provenance-mincrm-688)
  - [Map format (MINCRM-703)](#map-format-mincrm-703)
  - [Reading a failed load](#reading-a-failed-load)
- [Deferred to later phases](#deferred-to-later-phases)

---

## Files

| Path                                                             | Purpose                                                                                                                                                                                                                                               |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `server/src/coverageAgent/sdk/CoverageAgentPlugin.ts`            | `CoverageAgentPlugin` SDK contract + `CoverageDump`/`AgentMetadata` types (MINCRM-636) — the only import path for these types; every caller migrated off the old `CoverageAgent.ts` re-export, which was deleted rather than kept as a permanent shim |
| `server/src/coverageAgent/NodeV8CoverageAgent.ts`                | Backend agent — Node inspector API, `reset`/`snapshot`/`dump`; reference implementation of `CoverageAgentPlugin`                                                                                                                                      |
| `shared/schemas/coverageHarnessAdapterSchema.ts`                 | `HarnessAdapterShape` — documents the harness-adapter contract against the Playwright reference client (MINCRM-636)                                                                                                                                   |
| `server/src/coverageAgent/coverageConfig.ts`                     | Env-var resolution: enabled, granularity, commit SHA, dumps root                                                                                                                                                                                      |
| `server/src/coverageAgent/coverageAgentRegistry.ts`              | Module-level singleton holding the process's agent instance                                                                                                                                                                                           |
| `server/src/coverageAgent/dumpIndex.ts`                          | Append-only `dumpId` → metadata-path lookup index                                                                                                                                                                                                     |
| `server/src/services/coverageDumpService.ts`                     | Wraps the agent + dumpIndex; handles browser-dump ingestion                                                                                                                                                                                           |
| `server/src/controllers/coverageController.ts`                   | Request/response shaping for the control API                                                                                                                                                                                                          |
| `server/src/routes/coverage.ts`                                  | `@openapi` routes, mounted at `/api/v1/admin/coverage`                                                                                                                                                                                                |
| `shared/schemas/coverageSchema.ts`                               | Zod request/response schemas, shared server+client+qa                                                                                                                                                                                                 |
| `db/migrations/156_add_coverage_instrumentation_flag.js`         | Seeded the `coverage_instrumentation` feature flag; removed by migration 161 (MINCRM-663) in favor of the `COVERAGE_INSTRUMENTATION` env var                                                                                                          |
| `client/vite.config.ts`                                          | `vite-plugin-istanbul`, added to `plugins` only when `COVERAGE=true`                                                                                                                                                                                  |
| `qa/e2e/framework/coverageAgent/browser-coverage-agent.ts`       | Client-side: pulls `window.__coverage__`, submits to the dump endpoint                                                                                                                                                                                |
| `qa/e2e/framework/coverageAgent/coverage-control-client.ts`      | Reference client for the backend verbs (reset/snapshot/dump)                                                                                                                                                                                          |
| `qa/e2e/framework/reporting/coverage-reporter.ts`                | Triggers one final dump at run end when `E2E_COVERAGE_GRANULARITY=per-run`                                                                                                                                                                            |
| `qa/e2e/globalTeardown.ts`                                       | Reset safety-net after each E2E run                                                                                                                                                                                                                   |
| `qa/e2e/apps/minicrm/fixtures.ts`                                | Per-test coverage pull+submit wired into the `page` fixture                                                                                                                                                                                           |
| `qa/e2e/tests/apps/minicrm/functional/coverage-instrumentation/` | Functional spec exercising the control API end to end                                                                                                                                                                                                 |

Note: framework-layer coverage files live under `coverageAgent/`, not `coverage/` — the repo's `.gitignore` has an unanchored `coverage/` pattern (for Vitest's test-coverage output) that would otherwise silently ignore a literal `coverage/` directory anywhere in the tree, including this one.

### Phase 2 — Session management files

| Path                                                                | Purpose                                                                                                                                                                                                     |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `server/src/middleware/correlationId.ts`                            | Reads `x-coverage-correlation-id` into `req.coverageCorrelationId`                                                                                                                                          |
| `server/src/services/coverageSessionService.ts`                     | `CoverageSession` CRUD + dump attribution — unaudited (see [Coverage Database](#coverage-database))                                                                                                         |
| `server/src/controllers/coverageSessionController.ts`               | Request/response shaping for the session control API                                                                                                                                                        |
| `server/src/routes/coverageSessions.ts`                             | `@openapi` routes, mounted at `/api/v1/admin/coverage/sessions`                                                                                                                                             |
| `shared/schemas/coverageSessionSchema.ts`                           | Zod schemas for sessions + the `CORRELATION_ID_HEADER` constant                                                                                                                                             |
| `db/migrations/157_add_coverage_sessions.js`                        | Seeded the `coverage_session_management` feature flag; removed by migration 161 (MINCRM-663) in favor of `COVERAGE_SESSION_MANAGEMENT` (table creation moved — see [Coverage Database](#coverage-database)) |
| `qa/e2e/framework/coverageAgent/coverage-session-control-client.ts` | Reference client for the session verbs (start/end/record-dump)                                                                                                                                              |
| `client/src/api/coverageSessions.ts`                                | Axios wrapper + `COVERAGE_SESSIONS_QUERY_KEY` for the recorder UI                                                                                                                                           |
| `client/src/pages/admin/CoverageSessionRecorderPage.tsx`            | Manual-testing session recorder control panel (MINCRM-611)                                                                                                                                                  |

### Phase 3 — Coverage data pipeline files

| Path                                                                | Purpose                                                                                                                                                                                                                 |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `server/src/coverageAgent/pipeline/coverageSymbolicationService.ts` | Resolves raw dumps (both formats) to real source (MINCRM-615)                                                                                                                                                           |
| `server/src/coverageAgent/pipeline/normalizedCoverageUnit.ts`       | `NormalizedCoverageUnit`/`SymbolicationResult` internal types                                                                                                                                                           |
| `server/src/coverageAgent/pipeline/coverageIngestionService.ts`     | Ties symbolication + storage together for a single dumpId (MINCRM-614)                                                                                                                                                  |
| `server/src/services/coverageModelService.ts`                       | Owns all DB access for `coverage_units` (MINCRM-616), via `coverageDb.ts`                                                                                                                                               |
| `server/src/controllers/coveragePipelineController.ts`              | Request/response shaping for the ingestion trigger endpoint                                                                                                                                                             |
| `server/src/routes/coveragePipeline.ts`                             | `@openapi` routes, mounted at `/api/v1/admin/coverage/pipeline`                                                                                                                                                         |
| `shared/schemas/coveragePipelineSchema.ts`                          | Zod request/response schemas for the pipeline                                                                                                                                                                           |
| `db/migrations/158_add_coverage_pipeline.js`                        | Seeded the `coverage_pipeline_ingestion` feature flag; removed by migration 163 (MINCRM-685) in favor of the `COVERAGE_PIPELINE_INGESTION` env var (table creation moved — see [Coverage Database](#coverage-database)) |
| `qa/e2e/framework/coverageAgent/coverage-pipeline-client.ts`        | Reference client for the ingestion endpoint                                                                                                                                                                             |
| `qa/e2e/tests/apps/minicrm/functional/coverage-pipeline/`           | Functional spec exercising the ingestion endpoint end to end                                                                                                                                                            |

### Phase 4 — Mapping engine files

| Path                                                                 | Purpose                                                                                                                      |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `server/src/coverageAgent/pipeline/structuralKeyService.ts`          | Derives `name#normalizedBodyHash` structural unit keys (MINCRM-619)                                                          |
| `server/src/services/coverageMappingService.ts`                      | Owns all DB access for `coverage_test_links`, via `coverageDb.ts` (MINCRM-618)                                               |
| `server/src/coverageAgent/pipeline/coverageReconciliationService.ts` | Confidence/freshness scoring + build-time reconciliation (MINCRM-620)                                                        |
| `server/src/controllers/coverageMappingController.ts`                | Request/response shaping for the mapping query endpoints (MINCRM-621)                                                        |
| `server/src/routes/coverageMapping.ts`                               | `@openapi` routes, mounted at `/api/v1/admin/coverage/mapping`                                                               |
| `shared/schemas/coverageMappingSchema.ts`                            | Zod request/response schemas for the mapping query API                                                                       |
| `db/migrations/159_add_coverage_mapping_query_flag.js`               | Seeded the `coverage_mapping_query` feature flag; removed by migration 163 (MINCRM-685) in favor of `COVERAGE_MAPPING_QUERY` |
| `qa/migrations/001_coverage_baseline.js`                             | `coverage_test_links` table + `coverage_units.confidence_score`/`last_reconciled_at` columns (coverage database)             |
| `qa/e2e/framework/coverageAgent/coverage-mapping-client.ts`          | Reference client for the mapping query endpoints                                                                             |
| `qa/e2e/tests/apps/minicrm/functional/coverage-mapping/`             | Functional spec exercising the mapping query API end to end                                                                  |

### Phase 5 — Change impact analysis & test selection files

| Path                                                               | Purpose                                                                                        |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| `server/src/coverageAgent/testSelection/diffParser.ts`             | Parses `base..head` git diff into per-file changed line ranges (MINCRM-623)                    |
| `server/src/coverageAgent/testSelection/changeUnitResolver.ts`     | Resolves changed line ranges to changed code units via TS-compiler-API boundaries (MINCRM-623) |
| `server/src/coverageAgent/testSelection/testSelectionService.ts`   | Resolves changed units to affected tests via the mapping query API (MINCRM-624)                |
| `server/src/coverageAgent/testSelection/dependencyGraphService.ts` | Deterministic config/infra file → widened test scope rule table (MINCRM-625)                   |
| `server/src/coverageAgent/testSelection/safetyNetPolicy.ts`        | Always-run baseline + full-suite fallback policy (MINCRM-626)                                  |
| `server/src/coverageAgent/testSelection/scorer.ts`                 | Pluggable `TestScorer` interface + default `mapBasedScorer` (MINCRM-627)                       |

See [ADR-003](../adr/003-test-impact-analysis-selection.md) for the full pipeline design
and the safety-net/scorer decoupling invariant.

### Phase 7 — Platform governance files (MINCRM-637)

| Path                                                        | Purpose                                                                                                                                                          |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `server/src/middleware/coverageAccessGate.ts`               | Access-control gate — `requireRole('admin')` or `coverage:admin` capability, per `COVERAGE_CAPABILITY_GATING` (see [Access Control](#access-control-mincrm-637)) |
| `db/migrations/162_add_coverage_admin_capability.js`        | Seeds `coverage:admin` to the built-in `admin` role (product database)                                                                                           |
| `server/src/coverageAgent/coveragePolicyConfig.ts`          | Centralizes granularity/retention/safety-threshold config behind `resolveCoveragePolicy()` (see [Policy Configuration](#policy-configuration-mincrm-637))        |
| `server/src/coverageAgent/coverageRetentionScheduler.ts`    | Daily cron entry point for `pruneCoverageUnits` + `pruneCoverageSessions` (see [Scheduled retention pruning](#scheduled-retention-pruning))                      |
| `qa/migrations/005_coverage_test_links_last_seen_at_idx.js` | Index supporting the retention prune's `coverage_test_links` query (coverage database)                                                                           |
| `server/src/services/coverageHealthService.ts`              | `getCoverageHealth()` — agent/DB/router-registration status (see [`GET /api/v1/admin/coverage/health`](#get-apiv1admincoveragehealth))                           |
| `server/src/controllers/coverageHealthController.ts`        | Maps health status to `200`/`503`                                                                                                                                |

### Phase 6 — Reporting & gap analysis files

| Path                                                     | Purpose                                                                                                                                      |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `qa/migrations/002_coverage_build_summary.js`            | `coverage_build_summary` table — one row per commit, incrementally rolled up (coverage database)                                             |
| `server/src/services/coverageBuildSummaryService.ts`     | Owns all DB access for `coverage_build_summary`, via `coverageDb.ts`                                                                         |
| `server/src/services/coverageReportingService.ts`        | Read-only aggregate queries: summary, trend, gaps, per-issue coverage, TIA value metrics                                                     |
| `server/src/controllers/coverageReportingController.ts`  | Request/response shaping for the reporting query endpoints                                                                                   |
| `server/src/routes/coverageReporting.ts`                 | `@openapi` routes, mounted at `/api/v1/admin/coverage/reporting`                                                                             |
| `shared/schemas/coverageReportingSchema.ts`              | Zod request/response schemas for the reporting query API                                                                                     |
| `db/migrations/160_add_coverage_reporting_query_flag.js` | Seeded the `coverage_reporting_query` feature flag; removed by migration 163 (MINCRM-685) in favor of `COVERAGE_REPORTING_QUERY`             |
| `coverage-dashboard/`                                    | Standalone React/Vite app — new npm workspace, see [Standalone Dashboard App](#standalone-dashboard-app-coverage-dashboard-mincrm-629) below |

## Reporting & Gap Analysis (MINCRM-629/630/631, `pr-tia-7`)

Read-only reporting/gap-analysis query API over `coverage_build_summary` and the
existing `coverage_units`/`coverage_test_links` tables, mounted at
`/api/v1/admin/coverage/reporting/*` — the intended (and only) caller is the
standalone coverage-dashboard app scaffolded alongside this API (a new
`coverage-dashboard` npm workspace; see that workspace's own README). Gated by
`authenticate → coverageAccessGate`, with the whole router registered only when `COVERAGE_REPORTING_QUERY` is `'true'` at boot
([Access Control](#access-control-mincrm-637)), mounted before the general `/admin/coverage`
router — same more-specific-before-general
precedent as `/coverage/sessions`, `/coverage/pipeline`, and `/coverage/mapping`.

### Per-build rollup (`coverage_build_summary`)

`coverage_units` only carries the LATEST state per `commit_sha` — there was no
time-series storage anywhere in the coverage database before this phase, and
`coverage_units` rows are also subject to `pruneCoverageUnits`' retention deletion. A
dashboard trend view re-scanning `coverage_units` for every commit at read time would be
both expensive and lossy (older builds silently drop off a trend chart as soon as their
unit-level detail is pruned). `coverage_build_summary` (one row per `commit_sha`) solves
both problems: `coverageBuildSummaryService.upsertBuildSummaryForCommit` re-derives the
full row from `coverage_units`/`coverage_test_links` and upserts it, invoked as
`coverageIngestionService`'s `onUnitsUpserted` callback — in the SAME transaction as the
`coverage_units` writes it summarizes, so the summary can never drift out of sync, and it
survives past the underlying units' own retention window. Unlike test-link attribution
(which only runs when a dump has session/test attribution), the summary rollup runs on
**every** ingestion — the reporting dashboard needs a summary for any commit with
coverage at all, not just test-attributed ones.

Per-tier (API/frontend) counts come from `coverage_units.agent` (`node-v8` = API,
`browser-istanbul` = frontend — the same two literal values `coverage_units`' own CHECK
constraint enforces). Automated-vs-manual covered-unit counts come from a separate join
through `coverage_test_links` → `coverage_session_dumps` → `coverage_sessions.source`,
since `coverage_units` itself carries no test/session attribution of its own — a unit hit
by both an automated and a manual session counts toward BOTH counters (a
coverage-BY-test-type breakdown per MINCRM-629's "filter by test type" AC, not a
mutually-exclusive partition of units).

### Query endpoints

| Method | Path                                                         | Purpose                                                                       |
| ------ | ------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| `GET`  | `/api/v1/admin/coverage/reporting/summary`                   | Overall + per-tier coverage % for one build (MINCRM-629)                      |
| `GET`  | `/api/v1/admin/coverage/reporting/trend`                     | Coverage summaries for the most recent builds, most recent first (MINCRM-629) |
| `GET`  | `/api/v1/admin/coverage/reporting/gaps`                      | Dead zones, never-taken branches, changed-but-untested units (MINCRM-630)     |
| `GET`  | `/api/v1/admin/coverage/reporting/issues/:issueKey/coverage` | Coverage rollup for one MiniCRM issue key, scoped to one build (MINCRM-631)   |
| `GET`  | `/api/v1/admin/coverage/reporting/tia-metrics`               | TIA selection value metrics over a commit range (MINCRM-631)                  |

`/gaps` reports three things: `deadZoneUnits` (any `coverage_units` row with
`hit_count = 0` at the requested commit — code no test of any kind has ever exercised),
`neverTakenBranches` (the `granularity = 'branch'` subset of the same — MINCRM-630's AC
to distinguish "nothing calls this function" from "this function IS called, but one of
its branches never is"), and `changedUntestedUnits` (only populated when `baseSha` is
supplied — re-runs the same `diffParser.parseGitDiff` → `changeUnitResolver.resolveChangedUnits`
pipeline test selection uses (MINCRM-623), then reports which changed units have no
`coverage_test_links` row at `commitSha`; `deleted` units are excluded since there is no
code left to test).

`/issues/:issueKey/coverage` joins `coverage_sessions.issue_key` (stamped at session
check-in time — the only place an issue key exists in the coverage database today) →
`coverage_session_dumps` → `coverage_test_links`, scoped to one `commitSha` like every
other endpoint here. `/tia-metrics` reports per-tier coverage trend across a commit range
as an honest proxy for selection quality over time — it does NOT report "tests skipped" /
"CI time saved" figures, since that requires CI's own test-selection run log, which
nothing persists yet (wiring selection output into CI is `pr-tia-8`, MINCRM-633/634/660 —
see [Deferred to later phases](#deferred-to-later-phases)). A follow-up story that
persists CI's own selection decisions can extend this endpoint once that data exists.

## Standalone Dashboard App (`coverage-dashboard/`, MINCRM-629)

A new top-level npm workspace (`minicrm-coverage-dashboard`), added alongside
`shared`/`server`/`client`/`qa` in the root `package.json`'s `workspaces` array — its own
`package.json`, Vite dev server (port **5174**, not 5173 — `client/`'s dev server keeps
that port; both can run simultaneously), build, and test suite. Per MINCRM-628's
architecture AC ("standalone app/service ... no shared route table with
`minicrm-client`/`minicrm-server`"), this workspace:

- Imports zero code from `client/` or `server/` — only `@shared/schemas/*` types
  (Zod schemas, the same versioned wire-contract convention `client/` itself uses via
  its own `@shared` alias), never `@shared` runtime code beyond schemas.
- Has no direct database access of any kind — every read goes through
  `server`'s reporting query API (`coverageReporting.ts`, above) or mapping query API
  (`coverageMapping.ts`) over plain HTTP.
- Reuses `minicrm-server`'s existing session-cookie auth (`POST /auth/login`) rather
  than inventing a separate credential store — its `ProtectedRoute` additionally checks
  `user.role === 'admin'` client-side (a UX nicety only; every reporting endpoint is
  independently `coverageAccessGate`-gated server-side regardless — see
  [Access Control](#access-control-mincrm-637)). Or, with `COVERAGE_DASHBOARD_NO_AUTH=true`
  set on the server AND `VITE_COVERAGE_DASHBOARD_NO_AUTH=true` set on this app's own
  build, skips login entirely — see the "No-login mode" subsection below (MINCRM-636/637).
- Is English-only, with no i18n system of its own — an internal developer/QA tool, not
  a customer-facing product surface.
- **`VITE_BUILD_SHA`** tags every session started from the Session Recorder, and is
  resolved by `coverage-dashboard/vite.config.ts` when Vite starts — for `npm run dev`
  as well as `npm run build` — from explicit `GIT_COMMIT_SHA`/`GITHUB_SHA` first, then
  `git rev-parse HEAD`. Running from a checkout needs no configuration; an environment
  with no `.git` (a container image) must pass `GIT_COMMIT_SHA` explicitly. Unset,
  empty, or malformed tags sessions `unknown`, which records fine but can never be
  matched to a commit — the recorder shows an on-screen notice rather than letting that
  pass silently. The value is inlined into the served bundle, so changing it means
  restarting Vite, not just re-exporting. (MINCRM-688)

**CORS:** since this app's dev server (5174) and the API (3001, or 5173's own dev
proxy target) are different origins, and auth relies on an httpOnly cookie
(`withCredentials: true`), the server's `CORS_ORIGIN` allowlist must include this app's
origin explicitly — see `.env.example`'s `CORS_ORIGIN` comment. The dev proxy
(`vite.config.ts`'s own `server.proxy['/api']`) makes same-origin requests work
out of the box when running via `npm run dev --workspace=minicrm-coverage-dashboard`
without any CORS configuration at all; the allowlist entry only matters for a
real cross-origin deployment or when hitting the API directly rather than through the
proxy.

**Pages (MINCRM-629's dashboard AC):** `OverviewPage` — commit-SHA lookup, overall +
per-tier (API/frontend) coverage stat tiles, automated-vs-manual test-type filter, and a
30-build trend line chart (`CoverageTrendChart`, two-series SVG chart following the
`dataviz` skill's mark specs and validated default categorical palette — blue for API,
orange for frontend, both direct-labeled with collision-avoidance when their trailing
values are equal).

### No-login mode (MINCRM-636/637)

This is a pure internal engineering tool with no customer-facing surface and no auth
system of its own — requiring a CRM admin login just to view coverage/gap data was
unwanted friction, not a deliberate security boundary. Two flags, set together, drop
the login requirement end-to-end:

- **`COVERAGE_DASHBOARD_NO_AUTH=true`** on the server (`.env`'s own comment on this var)
  drops `authenticate` + `coverageAccessGate` for the three routers this dashboard
  actually calls — `coverageReporting.ts`, `coverageSessions.ts`, and
  `coverageMapping.ts` (the last backs the Traceability tab's drill-down and typeahead).
  `coveragePipeline.ts` and `coverage.ts` do NOT opt in: they ingest and manage real
  coverage data and stay fully gated regardless.

  Since MINCRM-685 there is no feature-flag step left to keep. MINCRM-694 had narrowed
  it to `requireFeatureEnabledOrgWide` rather than dropping it, because the flag's
  org-wide `enabled` column was the last gate on an unauthenticated request here; the
  rows are now deleted and each router's boot-time env var takes over that job. That is
  harder to defeat than a mutable row an admin could flip from the product UI, at the
  cost of needing a restart rather than a toggle to change.

  **Set the env vars, not a flag row.** A server without `COVERAGE_REPORTING_QUERY` and
  `COVERAGE_MAPPING_QUERY` set to `'true'` at boot answers `404` on every dashboard
  request — the routes do not exist — rather than the `403 FEATURE_DISABLED` older
  revisions of this doc described. If the dashboard shows nothing, check those two vars
  first; `GET /admin/coverage/health`'s `routers` block reports exactly what
  registered.

- **`VITE_COVERAGE_DASHBOARD_NO_AUTH=true`** on this app's own build makes `useAuth()`
  (`src/hooks/useAuth.ts`) report `{ user: null, isAuthenticated: true, isLoading:
false }` immediately, with no `GET /auth/me` call at all. `ProtectedRoute` skips its
  role check in this mode too (there is no user to have a role), and `NavLayout` hides
  the "Sign out" button (there is no session to sign out of).

The server honors the server-side flag only when `NODE_ENV` is `development` or `test`
(same hard safety rail as `E2E=true`) — staging, production, and any unrecognized value
ignore it, so a copied `.env` file can never leave reporting data open in a real
deployment. The client flag is a Vite build-time constant and has no such rail. The two flags are meant to be set together:
the client flag alone still renders the dashboard, but every API call 401s from the
server's own (still-enforced) auth check; the server flag alone still works for direct
API/curl access, but the dashboard's own UI keeps redirecting to its login page since
its `ProtectedRoute` never learns auth was dropped.

## Mounting

In `app.ts`, alongside the other admin routers:

```ts
app.use(`${API_V1}/admin/coverage`, coverageRoutes);
```

All routes: `authenticate → coverageAccessGate → asyncHandler(handler)`, except that `coverageReporting.ts`, `coverageMapping.ts` and `coverageSessions.ts` compose that chain through `buildCoverageAccessGate`, which drops both steps under `COVERAGE_DASHBOARD_NO_AUTH` (see [No-login mode](#no-login-mode-mincrm-636637)). Every one of the five routers additionally registers its routes only when its own boot-time env var is `'true'` — the one exception being `coverage.ts`'s `GET /health`, registered unconditionally. There is no per-request feature-flag step on any of them since MINCRM-685. See [Access Control](#access-control-mincrm-637) below for what `coverageAccessGate` does.

## Access Control (MINCRM-637)

Every coverage route is gated by `coverageAccessGate`
(`server/src/middleware/coverageAccessGate.ts`), replacing a bare
`requireRole('admin')` check. By default (`COVERAGE_CAPABILITY_GATING` unset), this
behaves identically to `requireRole('admin')`. When
`COVERAGE_CAPABILITY_GATING=true`, it instead requires the `coverage:admin`
capability (`Capability.CoverageAdmin`, `shared/schemas/capabilitySchema.ts`),
seeded to the built-in `admin` role only (`db/migrations/162_add_coverage_admin_capability.js`).

**Two distinct gates on every coverage router:** each one registers zero routes at
all — with one deliberate exception, `coverage.ts`'s own `GET /health`, registered
unconditionally so it stays reachable when everything else is off (see
[Health & Observability](#health--observability-mincrm-637)) — unless its own env var
(`COVERAGE_INSTRUMENTATION`, `COVERAGE_SESSION_MANAGEMENT`, `COVERAGE_MAPPING_QUERY`,
`COVERAGE_REPORTING_QUERY`, `COVERAGE_PIPELINE_INGESTION`) is `true` at process boot — see `server/src/coverageAgent/coverageBootGate.ts`, which owns
that list and the `registerRoutesIfEnabled` helper all five call. In a deployment where
a router's env var is unset, `coverageAccessGate` and the capability-gating flag have no
observable effect on it, because there is nothing registered for them to gate: every
path 404s rather than 403ing. Where routes ARE registered, `coverageAccessGate` is the
sole access-control mechanism — MINCRM-685 removed the last per-request feature-flag
step (see [Policy Configuration](#policy-configuration-mincrm-637)).

**`coverage:admin` is deliberately excluded from `RolesSettings.tsx`'s
`CAPABILITY_GROUPS` picker** — assignable only via direct API call or migration,
never through the self-service custom-role editor, matching MINCRM-663's precedent
of keeping internal coverage tooling out of the customer-facing admin UI.

**Known gap, accepted deliberately:** the coverage-dashboard's own
`ProtectedRoute.tsx` stays role-based (`user?.role !== 'admin'`) — no endpoint
returns a user's resolved capability set today, and building one is unscoped work
neither MINCRM-636 nor MINCRM-637 calls for. A non-`admin`-role user granted
`coverage:admin` via a custom role would pass every server-side gate but still be
redirected by the dashboard's client-side check — a UX gap, not a security gap,
since every reporting endpoint the dashboard calls independently enforces its own
real check regardless of the client-side redirect.

**Rollout:** `COVERAGE_CAPABILITY_GATING` exists because `requireCapability`
resolves via `role_capabilities`/`user_custom_roles`
(`server/src/services/roleService.ts`'s `userCapabilities`), which only falls back
to a user's built-in `users.role` when they hold zero explicit custom-role
assignments — an admin user WITH an explicit custom-role assignment lacking
`coverage:admin` would be silently 403'd by an unconditional swap, where
`requireRole('admin')` (a pure JWT-claims check) currently passes them. The flag
lets this be verified against real production role-assignment data before a
follow-up ticket removes the `requireRole` fallback.

The flag's effect is not purely a narrowing, though — flipping
`COVERAGE_CAPABILITY_GATING=true` also **widens** access in one specific case: a
bearer-authenticated `service_account` user holding `coverage:admin` via a custom
role gains access under capability mode, which is impossible under
`requireRole('admin')` (`service_account` can never satisfy `role === 'admin'`).
An operator enabling the flag should verify no `service_account` unexpectedly holds
`coverage:admin` before flipping it in a security-sensitive environment. See
`server/src/__tests__/coverageAccessGate.test.ts`'s "accepted intentional widening"
cases for the exact behavior on both the cookie- and bearer-authenticated paths.

## Policy Configuration (MINCRM-637)

The framework's config surface is entirely boot-time env vars, read in two places for
two different jobs:

- **Route-registration gates** (the five `COVERAGE_*` vars below that decide whether a
  router registers at all) are read at MODULE EVALUATION, inside each route file, via
  `registerRoutesIfEnabled` (`server/src/coverageAgent/coverageBootGate.ts`). They are
  deliberately NOT resolved through `resolveCoveragePolicy()` — that decision has to
  happen as the module loads, before anything could call a resolver.
- **Policy knobs** (granularity, retention, the TIA safety-net thresholds) are
  centralized behind `resolveCoveragePolicy()`
  (`server/src/coverageAgent/coveragePolicyConfig.ts`), resolved once at boot
  (`server.ts`) or once at script start (`select-tests.ts`), never re-read per-request.

`.env.example` documents both for local setup, in two places: the route gates sit under
its "Coverage/TIA Database" section, the policy knobs under "Coverage/TIA Policy
Configuration".

### No feature flags

There are none, deliberately. Five `feature_flags` rows once gated this subsystem —
`coverage_instrumentation`, `coverage_session_management` (migrations 156/157, removed
by 161 / MINCRM-663) and `coverage_pipeline_ingestion`, `coverage_mapping_query`,
`coverage_reporting_query` (migrations 158/159/160, removed by 163 / MINCRM-685). Each
rendered in the CRM's own admin Settings page identically to a real product toggle,
because `FeatureFlagsSettings.tsx` renders every row it finds: internal CI/dev test
infrastructure was discoverable and enable-able through the product's own UI.

Every router now gates its entire route _registration_ on a boot-time env var instead
(below). Do not add a `feature_flags` row for coverage tooling — the guard in
`featureFlagService.test.ts` fails if one reappears in either the registry or the
table.

### Env vars (boot-time, resolved once)

| Env var                        | Effect                                                                                                                         | Default                        |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------ |
| `COVERAGE_INSTRUMENTATION`     | Whether the backend V8 agent starts, and whether `coverage.ts`'s routes register at all                                        | unset (off)                    |
| `COVERAGE_SESSION_MANAGEMENT`  | Whether `coverageSessions.ts`'s routes register at all                                                                         | unset (off)                    |
| `COVERAGE_MAPPING_QUERY`       | Whether `coverageMapping.ts`'s routes (`GET /coverage/mapping/*`) register at all                                              | unset (off)                    |
| `COVERAGE_REPORTING_QUERY`     | Whether `coverageReporting.ts`'s routes (`GET /coverage/reporting/*`) register at all                                          | unset (off)                    |
| `COVERAGE_PIPELINE_INGESTION`  | Whether `coveragePipeline.ts`'s route (`POST /coverage/pipeline/ingest`) registers at all                                      | unset (off)                    |
| `COVERAGE_GRANULARITY`         | V8 coverage detail: `block` or `function`                                                                                      | `block`                        |
| `COVERAGE_CAPABILITY_GATING`   | Switches every coverage route's access check to the `coverage:admin` capability ([Access Control](#access-control-mincrm-637)) | unset (`requireRole('admin')`) |
| `COVERAGE_RETENTION_DAYS`      | Days a `coverage_units`/`coverage_test_links` row survives before the daily pruning cron removes it                            | `30`                           |
| `TIA_MIN_CONFIDENCE_THRESHOLD` | Safety-net confidence floor for test selection ([Safety-net selection policy](#safety-net-selection-policy-mincrm-626))        | `0.3`                          |
| `TIA_MAX_UNMAPPED_RATIO`       | Safety-net unmapped-ratio ceiling before full-suite fallback                                                                   | `0.5`                          |
| `COVERAGE_SOURCE_ROOT`         | Root that source paths resolve against. `npm run <script> --workspace=<name>` makes `process.cwd()` the workspace directory    | `process.cwd()`                |

`COVERAGE_RETENTION_DAYS`'s default (30 days) matches `webhook_delivery_logs`' own
retention window (`docs/dev/retention.md`) — the shortest existing precedent in this
repo, and the closest match in kind to coverage/TIA data: disposable, write-heavy,
CI-tooling-consumed telemetry with no compliance/audit retention requirement (see
Coverage Database below).

`TIA_MIN_CONFIDENCE_THRESHOLD`/`TIA_MAX_UNMAPPED_RATIO` are validated to `[0, 1]` —
an out-of-range value (e.g. a negative confidence threshold, or a ratio above 1)
falls back to the default the same way an unparseable value does, rather than being
accepted silently. An out-of-range value in either direction would otherwise disable
that half of the safety net entirely: a negative confidence threshold makes the
low-confidence check never trigger, and a ratio above 1 makes the unmapped-ratio
check never trigger (the computed ratio can never itself exceed 1).

### Scheduled retention pruning

`coverageRetentionScheduler.runCoverageRetentionPruning()` runs on the schedule in
[Scheduled Jobs](../operations.md#scheduled-jobs), calling two independent prune functions — a rejection
in one does not prevent the other from running, and their counts are aggregated into
one `lastRetentionPrune` outcome:

- `coverageModelService.pruneCoverageUnits(retentionDays)` — `coverage_units`,
  `coverage_test_links`, and `coverage_ingested_dumps` (see below).
- `coverageSessionService.pruneCoverageSessions(retentionDays)` — `coverage_sessions`
  (any status, not just `'ended'` — an abandoned/never-ended session ages out the same
  way; see [Session Management](#session-management-mincrm-609612) above for why one
  can accumulate unboundedly with no cleanup otherwise) and, via `coverage_session_dumps`'
  `session_id REFERENCES ... ON DELETE CASCADE`, its dumps too. `coverage_sessions.started_by`
  is the column this ticket's own AC names as "session metadata (possible PII)" —
  before this, `coverage_sessions` had zero retention pruning at all, unlike
  `coverage_units`/`coverage_test_links`.

`coverage_build_summary` remains deliberately unpruned — a rolled-up aggregate (one row
per commit), not raw per-dump/per-unit telemetry, growing at a much slower rate than
the tables above.

`pruneCoverageUnits` was previously callable on demand only, with zero production
callers — it now also deletes any
`coverage_test_links` rows matching a `coverage_units` identity deleted by that same
prune, in the same transaction (via `DELETE ... RETURNING` on the units query, then a
chunked `DELETE ... WHERE (commit_sha, file_path, unit_key, branch_id) IN (VALUES ...)`
on the links, chunked at `MAX_UNITS_PER_LINK_DELETE_BATCH` for the same
65535-bind-parameter reason `MAX_UNITS_PER_INSERT_BATCH` already chunks ingestion):
`coverage_test_links` has no FK to `coverage_units` (cross-database FKs are impossible
in PostgreSQL, and neither table was ever given one despite living in the same coverage
database), so pruning `coverage_units` alone would eventually leave orphaned links whose
`MAPPING_RESULT_SELECT` LEFT JOIN then returns `confidence_score: null` — which
`safetyNetPolicy.hasLowConfidenceMatch` treats as "no signal to check" rather than
"below threshold," silently weakening the exact full-suite fallback retention pruning
must not undermine.

The link cleanup is scoped to "matches a unit identity deleted THIS transaction," not
to "the link's own `last_seen_at` is also past the window" — an earlier revision used
the latter and was itself a bug: `coverage_units.last_seen_at` is refreshed only by
real V8 ingestion (`upsertCoverageUnits`), while `coverage_test_links.last_seen_at` is
refreshed independently by `loadCoverageTestLinksForCommit`'s map-load path (`ON
CONFLICT ... DO UPDATE SET last_seen_at = now()` — the normal way `select-tests.ts`
gets a coverage index in CI and via `pre-push-tia.ts` locally). These are two
genuinely decoupled write paths: on a persistent deployment, a commit can stop being
actively ingested (it's no longer `HEAD`) while `pre-push-tia.ts` keeps reloading that
same base SHA's map on every push, refreshing only the link's `last_seen_at` forever
while the unit goes stale and gets pruned — "stale unit, fresh link" is a reachable,
normal state, not an edge case. Scoping the link delete by the link's own freshness
would have left that link an orphan forever; scoping it by "was this link's own unit
just deleted" closes both directions — a link whose unit still exists is never
touched, and a link whose unit really was just pruned is always removed, regardless of
the link's own independent freshness. Both prunes run regardless of
`COVERAGE_INSTRUMENTATION`, since the coverage database is populated by the
pipeline/mapping/session-recorder ingestion paths independent of the backend V8 agent.

The outcome of each run — success with counts from both prunes, or the combined error
message if either (or both) prune functions threw — is tracked in-process
(`coverageRetentionScheduler.getLastRetentionPruneOutcome()`) and surfaced on
`GET /api/v1/admin/coverage/health` as `lastRetentionPrune` (see below), so a failed
nightly prune is observable there rather than only in the process log.

## Health & Observability (MINCRM-637)

### `GET /api/v1/admin/coverage/health`

Reports the operational health of the framework's own services —
`coverageHealthService.getCoverageHealth()`
(`server/src/services/coverageHealthService.ts`):

- `agentRunning` — whether the backend V8 agent is registered
  (`coverageAgentRegistry.getCoverageAgent()`).
- `db` — `'ok'` or `'error'`, from a `SELECT 1` against `coverageDb` with a 2-second
  statement timeout. Shares one implementation with `app.ts`'s `/api/health`:
  `probeDatabase()` in `server/src/services/dbHealthProbe.ts`.
- `routers` — which coverage routers registered their routes at boot (MINCRM-685),
  from the `COVERAGE_MAPPING_QUERY`/`COVERAGE_REPORTING_QUERY`/`COVERAGE_PIPELINE_INGESTION`
  snapshot. `false` means every path under that router 404s. Only these three are
  reported: `COVERAGE_INSTRUMENTATION`/`COVERAGE_SESSION_MANAGEMENT` are deliberately
  absent, since `agentRunning` already covers the first and the sessions router is not
  part of this report's remit — do not read the block as a complete gate inventory. Replaced a `featureFlags`
  block that reported three `feature_flags` rows migration 163 deleted
  (see [Policy Configuration](#policy-configuration-mincrm-637) above). Read from an
  in-memory snapshot taken at boot, not live — registration happened once, so a later
  `process.env` change must not move this field. This report touches no database but
  the coverage one.
- `lastRetentionPrune` — the outcome of the most recent scheduled retention prune (see
  [Scheduled retention pruning](#scheduled-retention-pruning) below): `ranAt`, `status`
  (`'ok'` or `'error'`), and either `prunedUnitCount`/`prunedLinkCount`/
  `prunedIngestedDumpCount`/`prunedSessionCount` (on `'ok'`) or `error` (on `'error'`,
  a combined message if both the units-side and sessions-side prunes failed). Absent
  if the daily cron hasn't fired yet this process's lifetime — e.g. right after boot,
  before 07:00 first hits — which is the normal post-boot state, not itself degraded.
  This is the one background job MINCRM-637 introduces; without this field a failed
  nightly prune would only ever reach `logger.error`, with this endpoint continuing to
  report `status: 'ok'` indefinitely.

Returns `200` when `status: 'ok'`, `503` when `status: 'degraded'` — which means
exactly two things: the coverage database was unreachable, or the last scheduled
retention prune errored. An unregistered router and an as-yet-unrun retention prune are
both normal operational states, not degraded: every gate unset is the production
default, so degrading on it would leave every normal deployment permanently red.

**Gated by `authenticate → coverageAccessGate`, same as every other coverage route —
not a public liveness probe** like the unauthenticated `/api/health`. This endpoint
reveals router-registration state and DB reachability, which is operational detail worth
protecting the same way the rest of the coverage control surface is. Registered
**unconditionally** in `routes/coverage.ts`, outside the `registerRoutesIfEnabled`
call that gates this router's other routes.

That carve-out's original rationale — "the mapping/reporting/pipeline routers are live
independent of this env var" — stopped being true in MINCRM-685, when those three
gained boot gates of their own. It survives on a different and better one: this
endpoint is _diagnostic_. An operator asking "why is coverage not working?" needs an
answer in precisely the deployment where everything is switched off, and a health check
that 404s whenever the subsystem is disabled cannot distinguish "disabled" from
"misdeployed" — the one question it exists to settle. The `routers` block makes it
strictly more useful in that state, since it reports which gates were open at boot.
This is the standard liveness-endpoint carve-out, and
`server/src/__tests__/coverageHealthRouteGating.test.ts` pins it with every gate unset.

### Operational logging

Three high-volume/latency-risk call sites log structured fields on every call via the
shared app `logger` — no new logging infrastructure or dependency:

| Call site                                                          | Level   | Log message                                               | Fields                                                                                           |
| ------------------------------------------------------------------ | ------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `coverageIngestionService.ingestCoverageDump`                      | `info`  | `coverageIngestionService: ingested coverage dump`        | `dumpId`, `commitSha`, `alreadyIngested`, `unitCount`, `unresolvedCount`, `testId`, `durationMs` |
| `coverageMappingService.findTestsForUnitAcrossBranches` (singular) | `debug` | `coverageMappingService: findTestsForUnitAcrossBranches`  | `commitSha`, `filePath`, `unitKey`, `resultCount`, `durationMs`                                  |
| `coverageMappingService.findTestsForUnitsAcrossBranches` (batched) | `info`  | `coverageMappingService: findTestsForUnitsAcrossBranches` | `commitSha`, `inputUnitCount`, `uniqueUnitCount`, `chunkCount`, `totalMatchCount`, `durationMs`  |

The singular per-unit lookup logs at `debug`, not `info` — it fires once per changed
unit on `testSelectionService`'s inheritance-lookup fan-out, unlike the batched
function (once per selection run); logging every call at `info` would make the log
itself a measurable share of the latency it reports.

**How to alert on this:** these are plain structured `logger.info` calls (JSON to
stdout in every environment — see `logger.ts`), so they flow into whatever
log-aggregation tooling an operator already runs for this deployment (e.g. `docker
compose logs`, a hosted log pipeline). No new tooling is prescribed here — a
`durationMs` threshold alert on either mapping-query log line, or a dashboard tracking
`findTestsForUnitsAcrossBranches`'s `chunkCount`/`uniqueUnitCount` over time, are
reasonable starting points once a real log pipeline is in place, but wiring one up is
outside this ticket's scope.

## Coverage Database

Coverage/TIA data (`coverage_units`, `coverage_ingested_dumps`, `coverage_sessions`, `coverage_session_dumps`, `coverage_test_links`) lives in its own database — `minicrm_coverage` (dev), `minicrm_coverage_test` (Vitest), `minicrm_coverage_e2e` (Playwright) — separate from the product database (`minicrm`/`minicrm_test`/`minicrm_e2e`) that everything else in `server/src/services/` reads/writes via `db.ts`'s pool. Both live on the same Postgres instance in every environment this repo targets (one `db` service in `docker-compose.yml`), just under different database names.

**Why a separate database, not just a separate schema/namespace:** coverage/TIA data is disposable, write-heavy, retention-pruned telemetry consumed by CI tooling and developers — a fundamentally different access pattern, growth rate, and backup/retention policy than product data (contacts/deals/users), which needs strict backups and must never be bulk-deleted. None of the coverage tables carry a foreign key into the product schema — `coverage_sessions.started_by` is a plain `uuid` column, not an FK (cross-database foreign keys are impossible in PostgreSQL) — so there is no referential-integrity reason for them to share a connection pool, backup schedule, or migration history with product data.

**What did NOT move, and no longer exists:** the `coverage_pipeline_ingestion`, `coverage_mapping_query`, and `coverage_reporting_query` `feature_flags` rows stayed in the product database because they gated WHO may call the coverage APIs — an authorization concern belonging with the product's own `users`/`feature_flags` tables rather than with coverage data. Migration 163 (MINCRM-685) deleted all three, following 161 (MINCRM-663) which deleted `coverage_instrumentation`/`coverage_session_management`; every router is now gated at boot instead (see [Policy Configuration](#policy-configuration-mincrm-637)). Access control on the routes that do register is still a product concern — `authenticate` plus `coverageAccessGate`, both reading the product database.

**Consequence — coverage sessions are unaudited:** `coverageSessionService`'s writes used to go through the same transaction + `writeAuditEntry`/`setRlsUserId` pattern as `dealService.ts` (see CLAUDE.md). Both of those require a product-database `PoolClient` (the `audit_log` table and RLS policies live there) and cannot run against a `coverageDb` client. Coverage sessions are therefore unaudited system telemetry, exactly like `coverage_units`/`coverage_test_links` already were — derived, system-internal data with no user-facing mutation surface, not a compliance-relevant change history. `startedBy` is still recorded on `coverage_sessions` as informational attribution (who kicked off a session), just without an `audit_log` entry.

**Schema location:** `qa/migrations/` (a separate `node-pg-migrate` sequence from `db/migrations/`, starting at `001`, run via `npm run migrate:coverage --workspace=minicrm-qa`), not `db/migrations/`. This mirrors the QA workspace's own ownership of E2E-adjacent infrastructure. `qa/scripts/create-coverage-e2e-db.ts` creates + migrates `minicrm_coverage_e2e`, invoked from the root `scripts/e2e-setup.ts` alongside the product DB's own `create:e2e-db` step.

**Provisioning:** `server/src/migrate.ts`'s `runCoverageMigrations()` creates the coverage database (if it doesn't exist — `CREATE DATABASE` can't run inside a migration/transaction, so this connects to the ambient `postgres` maintenance database first, same pattern as `create-e2e-db.ts`/`create-coverage-e2e-db.ts`) and runs `qa/migrations/` against it. Called unconditionally from `server.ts`'s boot sequence right after the product database's own `runMigrations()` — a server can never finish starting up with an unprovisioned or schema-stale coverage database, regardless of which coverage routers registered. `server/src/__tests__/globalSetup.ts` (Vitest) does the equivalent for `minicrm_coverage_test` before any test file runs.

**Connection:** `server/src/coverageDb.ts` — a second `pg.Pool`, read by `coverageSessionService.ts`, `coverageModelService.ts`, `coverageMappingService.ts`, `coverageBuildSummaryService.ts`, `coverageReportingService.ts`, and `coverageHealthService.ts` (a `SELECT 1` reachability check only — no coverage-domain table reads/writes of its own) — see that file's own import-allowlist docblock for the authoritative list. Configured via `COVERAGE_DB_*` env vars, each falling back to the product DB's own `DB_USER`/`DB_PASSWORD`/`DB_HOST`/`DB_PORT` (same instance, same credentials in every environment today) except `COVERAGE_DB_NAME`, which always needs an explicit value (defaults to `minicrm_coverage`) so a misconfigured environment can never accidentally point this pool at the product database by inheriting `DB_NAME`.

## Backend Agent (MINCRM-604)

Uses the stable `node:inspector` module's `Profiler.startPreciseCoverage` / `Profiler.takePreciseCoverage`, not `node:inspector/promises` (still experimental on the Node versions this repo targets) and not the `NODE_V8_COVERAGE` env var. `NODE_V8_COVERAGE` writes raw per-process coverage files automatically on process exit — that conflicts directly with MINCRM-604's "on-demand reset/dump while process stays up" requirement, since it offers no in-process control surface. The inspector API gives real on-demand control instead, at the cost of needing to drive it from application code (`server.ts` constructs and starts the agent at boot).

**V8 constraint — reset-on-read:** `Profiler.takePreciseCoverage()` resets accumulated call counts as a side effect of reading them. There is no CDP-level non-destructive read. This means `snapshot()` is **not** a true non-destructive read despite the name — calling it clears counters just like `dump()` does, it just doesn't persist an artifact to disk. A `snapshot()` call between two `dump()` calls will make the second dump's coverage look artificially low. Treat `snapshot()` as "peek and clear," not "peek."

Enabled only when `COVERAGE_INSTRUMENTATION=true` at boot — checked once, not per-request. Coverage is at branch/block granularity by default (`COVERAGE_GRANULARITY=block`), function-level only with `COVERAGE_GRANULARITY=function`.

## Agent & Harness Adapter SDK (MINCRM-636)

`NodeV8CoverageAgent` above is the reference implementation of a formal, versioned
plugin contract — `CoverageAgentPlugin` (`server/src/coverageAgent/sdk/CoverageAgentPlugin.ts`).
Every consumer of `CoverageDump`/`CoverageDumpSource` imports directly from this
module — the original `CoverageAgent.ts` re-export shim was deleted once every call
site was migrated, rather than kept indefinitely as a second permanent import path
for the same contract. `coverageAgentRegistry.ts` is typed to the interface, not the
concrete class, so a second language's agent can register without a type error. The
harness side of the contract (`HarnessAdapterShape`,
`shared/schemas/coverageHarnessAdapterSchema.ts`) documents, against the actual
existing shape of the Playwright reference client
(`qa/e2e/framework/coverageAgent/coverage-session-control-client.ts`), what a new
test-framework integration needs to provide: start/end a session, attribute a dump,
and propagate `CORRELATION_ID_HEADER`.

This is a versioned interface plus one real implementation, not a dynamic plugin
loader — see [docs/dev/coverage-tia-sdk.md](coverage-tia-sdk.md) for the full
contribution guide, versioning policy, and the reasoning for that choice.

## Frontend Agent (MINCRM-605)

`vite-plugin-istanbul`, added to `client/vite.config.ts`'s `plugins` array only when `COVERAGE=true` at Vite config-eval time. An unset env var means the plugin is never in the array — a normal `vite build`/`vite dev` is byte-identical to an unmodified checkout.

Sourcemapping to original `.tsx` needs no extra configuration: Vite's dev/build pipeline never strips sourcemaps from its own chain, and Istanbul's injected counters ride along inside the same instrumented module output the sourcemap already describes.

Coverage is exposed on `window.__coverage__` once the served bundle is instrumented. There is no server-side "browser agent" — the server cannot reach into a browser tab it did not render. Instead, `browser-coverage-agent.ts` pulls the coverage map via `page.evaluate()` and POSTs it to `POST /api/v1/admin/coverage/dump` with `source: 'browser'`, where it's tagged and stored identically to a backend dump.

Works headless (CI, Playwright-driven) and headed (local manual exploratory) identically, since instrumentation is baked into the served bundle rather than driven by the test runner.

## Control API (MINCRM-606)

| Method | Path                                   | Purpose                                                                                                           |
| ------ | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `POST` | `/api/v1/admin/coverage/reset`         | Reset the backend agent's counters. `204`.                                                                        |
| `POST` | `/api/v1/admin/coverage/snapshot`      | Read current counters without persisting an artifact (still resets — see above). Returns dump metadata only.      |
| `POST` | `/api/v1/admin/coverage/dump`          | Persist a tagged dump. No body → backend agent. `{ source: 'browser', payload, label }` → ingest a frontend dump. |
| `GET`  | `/api/v1/admin/coverage/dumps/:dumpId` | Look up metadata for a previously produced dump.                                                                  |

`dumpId` is a `crypto.randomUUID()` generated at persist time — commit SHA is a tag _on_ the dump, not the identifier, since many dumps share a SHA across a run.

**Two distinct effects of one env var, easy to conflate:** `COVERAGE_INSTRUMENTATION` controls both _whether this router's routes register at all_ and _whether the backend agent actually started at boot_. They are not the same failure: an unset var means every path 404s (no routes), while a set var whose agent failed to start returns `409 COVERAGE_NOT_ENABLED` on `reset`/`snapshot`/`dump` — the request reaches the handler, which discovers there is no agent to operate on. The `coverage_instrumentation` feature flag that used to gate _who may call this API_ was removed by migration 161 (MINCRM-663).

**Auth:** the existing Bearer service-account token path (`authenticate` middleware) — no new auth mechanism. This is what CI and the E2E reference client use.

**Persistence:** file-based, not a DB table. Each dump writes `<dumpsRoot>/<commitSha>/<dumpId>.json` (raw payload) + `<dumpId>.meta.json` (sidecar metadata), plus an append-only `index.jsonl` for `GET /dumps/:dumpId` lookups. `dumpsRoot` defaults to `<process.cwd()>/coverage-dumps` (gitignored). Phase 1 has no per-owner semantics and no downstream consumer of a queryable dump table — a later mapping-engine phase adds one only if it actually needs to join against dump metadata.

### Reference client

```ts
import { resetCoverage, dumpCoverage } from '@framework/coverageAgent/coverage-control-client.js';

await resetCoverage(restClient);
const dump = await dumpCoverage(restClient, 'my-test-label');
```

`restClient` needs an authenticated session (e.g. `loginAsAdmin(restClient)`), and the server must have been started with `COVERAGE_INSTRUMENTATION=true` — the `coverage_instrumentation` flag this once required was deleted by migration 161 (MINCRM-663). Equivalent curl:

```bash
curl -X POST http://localhost:3001/api/v1/admin/coverage/dump \
  -H "Content-Type: application/json" \
  --cookie "minicrm_token=<jwt>" \
  -d '{"label": "my-test-label"}'
```

## Low-Overhead Mode (MINCRM-607)

Three independent, off-by-default toggles so an unmodified run pays zero overhead:

| Env var                    | Values                 | Effect                                                                                                                      | Default     |
| -------------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------- | ----------- |
| `COVERAGE_INSTRUMENTATION` | `true` / unset         | Whether the backend V8 agent starts at all, checked once at server boot                                                     | unset (off) |
| `COVERAGE_GRANULARITY`     | `block` / `function`   | V8's `detailed` flag — block/branch-level vs. function-level-only coverage                                                  | `block`     |
| `E2E_COVERAGE_GRANULARITY` | `per-test` / `per-run` | Whether the E2E fixture layer pulls+submits frontend coverage after every test, or only once at end-of-run via the reporter | `per-test`  |

"No behavioral differences (timeouts, race conditions) attributable to instrumentation" is satisfied structurally: every coverage-related call lives in a `try/finally` around the `page` fixture, in the reporter's `onEnd()`, or in `globalTeardown` — never inside a locator/action wait path, which the E2E authoring rules already forbid (`page.waitForTimeout()` and `networkidle` waits are banned outright).

### Measured overhead

Measured 2026-07-20 against a live E2E server container (then `server-e2e`, now `minicrm-test-server`), functional suite subset (`webhooks/` + `deals/`, 43 tests, desktop project, 2 local workers):

| Mode                                                                | Total test duration | Overhead |
| ------------------------------------------------------------------- | ------------------- | -------- |
| Off (baseline)                                                      | 108.8s              | —        |
| On, `E2E_COVERAGE_GRANULARITY=per-run`                              | 110.9s              | ~1.9%    |
| On, `E2E_COVERAGE_GRANULARITY=per-test` (backend-only — see caveat) | 111.3s              | ~2.3%    |

All 43 tests passed in every configuration — no failures or timeouts attributable to instrumentation.

**Caveat on the per-test number:** this measurement's client bundle was not rebuilt with `COVERAGE=true`, so the per-test frontend pull/submit hit its no-op early-return path (`window.__coverage__` absent) rather than actually pulling and POSTing a real Istanbul payload per test. The number above reflects backend-only overhead in per-test mode, not the true worst case with a fully-instrumented frontend. Re-measure with a `COVERAGE=true` client build before treating per-test mode's overhead as final. Both measured numbers are well under a proposed acceptance bar of ≤10% (per-run) / ≤25% (per-test) — re-validate the per-test bar once measured against a real instrumented frontend.

This was measured manually, not via an automated CI gate — wiring an automated regression assertion against these numbers is a reasonable follow-up once they're re-validated with a real instrumented client build, not a day-one requirement.

## Session Management (MINCRM-609..612)

A `CoverageSession` is a logical grouping of one or more coverage dumps attributed to a single automated test run or manual-exploratory-testing session. It does **not** provide physically isolated V8 counters — `NodeV8CoverageAgent` remains a single process-wide counter set (see the Shared test environment note above). Instead, attribution works by tagging dumps produced during a session with that session's `correlationId`, so overlapping sessions on the same server instance can be told apart in the _stored data_ even though the underlying counters are shared.

### Data model

- `coverage_sessions` — one row per session. `status` transitions `active` → `ended` (never reopened). `version` supports optimistic locking so two concurrent end-session requests can't both succeed. `correlation_id` (unique) is minted at start time.
- `coverage_session_dumps` — join table attributing a `dumpId` (still file-based, per Phase 1 — not FK'd, only referenced by UUID) to a session, plus optional `testId`/`testName`/`attempt` for retry attribution. `attempt` distinguishes a Playwright retry re-running the same `testId`: the first (possibly failed) attempt and the retry are two distinct rows, never overwritten or merged.

### Correlation-ID propagation

`x-coverage-correlation-id` (see `CORRELATION_ID_HEADER` in `coverageSessionSchema.ts`) is read by `correlationId` middleware — mounted globally in `app.ts`, before the route table — into `req.coverageCorrelationId`. It's a no-op for the overwhelming majority of requests, which carry no such header. The E2E harness and the manual-testing recorder are the only senders today.

**What actually consumes it:** `POST /api/v1/admin/coverage/dump` (`coverageController.ts`'s `attributeDumpToSessionIfCorrelated`) checks `req.coverageCorrelationId` after persisting a dump — if it matches a currently-_active_ session, the dump is auto-attributed to that session, exactly as if `POST /coverage/sessions/:sessionId/dumps` had been called with that `dumpId` and `correlationId`. This is best-effort and never fails the dump response itself; a stale/unknown/missing correlation ID just means no attribution happens. Callers that already propagate the header (the manual recorder) get attribution for free and must NOT also call `POST /coverage/sessions/:sessionId/dumps` explicitly — the `dumpId` unique constraint would reject the second attempt as a duplicate. The E2E harness fixture takes the opposite path: it explicitly calls the record-dump endpoint instead, because its dump POST (via the per-test `restClient`, over `pullAndSubmitBrowserCoverage`) never actually carries the header — only the browser page context and the fixture's separate `sessionClient` do.

### Session control API

| Method | Path                                               | Purpose                                                                                                                                                                                                                                                                                                                                                                             |
| ------ | -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST` | `/api/v1/admin/coverage/sessions`                  | Start a session; mints and returns a `correlationId`.                                                                                                                                                                                                                                                                                                                               |
| `GET`  | `/api/v1/admin/coverage/sessions`                  | List currently-active sessions, paginated (`page`/`limit`, same convention as every other list endpoint — `paginationParamsSchema`). Returns `{ data, total, page, limit }`.                                                                                                                                                                                                        |
| `GET`  | `/api/v1/admin/coverage/sessions/:sessionId`       | Look up a single session. `400` for a non-UUID `sessionId`.                                                                                                                                                                                                                                                                                                                         |
| `POST` | `/api/v1/admin/coverage/sessions/:sessionId/end`   | End a session (optimistic-locked on `version`). `409` on conflict (already ended or stale version).                                                                                                                                                                                                                                                                                 |
| `POST` | `/api/v1/admin/coverage/sessions/:sessionId/dumps` | Record a `dumpId`'s attribution to a session (after `POST /coverage/dump`). `409` if the session has already ended, or if `dumpId` was already recorded (anywhere — including via auto-attribution above). `400` if `correlationId` doesn't match this session's own — a caller cannot attribute a dump to `sessionId` while stamping it with a different session's correlation ID. |

Gated by `authenticate → coverageAccessGate` ([Access Control](#access-control-mincrm-637)). Like every other coverage router since MINCRM-685, these routes carry no `requireFeatureEnabled` check at all — the entire router is registered only when `COVERAGE_SESSION_MANAGEMENT` is `'true'` at boot (migration 161 removed the `coverage_session_management` product-database feature flag in favor of this boot-time env var; see [Env vars (boot-time, resolved once)](#env-vars-boot-time-resolved-once) below). `COVERAGE_SESSION_MANAGEMENT` is independent of `COVERAGE_INSTRUMENTATION` (migration 156) — a session can exist even when the backend V8 agent itself never started, e.g. a browser-only manual session. Mounted in `app.ts` **before** the general `coverage.ts` router, so a future top-level route added there can never shadow `/admin/coverage/sessions`.

A dump can only ever attribute to an **active** session whose `correlation_id` matches the caller-supplied value — `recordCoverageSessionDump`'s INSERT is scoped to `WHERE EXISTS (... status = 'active' AND correlation_id = ...)` atomically in a single statement, so there's no check-then-insert race and no way to attribute a dump to one session while stamping it with another's correlation ID.

`coverage_sessions.started_by` is nullable with `ON DELETE SET NULL` (not `CASCADE`) — deleting a user must not silently destroy their coverage/testing session history, mirroring migration 074's fix for the same anti-pattern on `import_jobs.created_by`/`webhook_subscriptions.created_by`.

### E2E harness hooks (MINCRM-609)

Wired into `qa/e2e/apps/minicrm/fixtures.ts`'s `page` fixture — the same `try/finally` block that already handles per-test coverage pull+submit. No per-spec-file edits are required. On test start the fixture starts (or joins) a session tagged with the test ID/name and build SHA and injects the correlation-ID header into the browser context; the existing `finally` block explicitly records the dump's attribution (see the correlation-ID note above for why this path can't rely on auto-attribution) and ends the session.

### Manual-testing session recorder (MINCRM-611)

An in-app admin control panel (`client/src/pages/admin/CoverageSessionRecorderPage.tsx`) to check in (name the session, optionally a MiniCRM issue key), record (sets the correlation-ID header as a default header on the shared client-side axios instance for the duration), and check out (triggers a dump — auto-attributed server-side via the correlation ID — and ends the session). Ties to the current build SHA automatically. The correlation header is cleared on check-out regardless of whether the dump/end calls succeed (`onSettled`, not `onSuccess`), since leaving it set on the shared axios instance would otherwise tag every subsequent request from that browser tab — not just this page's — until a full reload. Check-out treats a failed dump as non-fatal and still ends the session: `coverage_instrumentation` (migration 156) can be off independently of this page's own `coverage_session_management` gate, and a hard failure there must not permanently strand a recording session.

## Coverage Data Pipeline (MINCRM-614/615/616)

Turns a raw coverage dump (still file-based, per Phase 1's storage decision — this phase does not change that) into a normalized, symbolicated, version-anchored, queryable model: `coverage_units`. This is a strictly additive derived layer — no existing raw-dump persistence, control API, or session-attribution behavior from Phase 1/2 changes.

### Ingestion & normalization (MINCRM-614)

`coverageIngestionService.ingestCoverageDump(dumpId)`: looks up the raw dump via the existing `coverageDumpService.findCoverageDump`, reads its payload off disk, symbolicates it (see below), and merges the result into `coverage_units`. Both raw dump formats (`v8-script-coverage`, `istanbul`) are accepted uniformly — the format-specific handling lives entirely in the symbolication step, not here.

**Idempotency and race-safety:** a naive "check `coverage_ingested_dumps`, then separately write" pattern has a TOCTOU gap — two concurrent ingestion calls for the same `dumpId` could both pass the check before either writes, double-counting `hit_count`. Instead, `coverageModelService.upsertCoverageUnits` claims the dumpId FIRST, inside the same transaction that applies the `coverage_units` upserts: `INSERT INTO coverage_ingested_dumps ... ON CONFLICT (dump_id) DO NOTHING RETURNING dump_id`. If the `RETURNING` clause yields no row, a concurrent (or prior) call already claimed this dump, and the `coverage_units` writes are skipped entirely for this call. This makes ingestion safe to call concurrently for the same `dumpId` with no caller-side guard required — the symbolication work itself is not skipped up front (it still runs before the claim), so a losing concurrent call does real but discarded work, not an incorrect double-write.

A dump whose raw payload file is missing, unreadable, or not valid JSON is rejected with `COVERAGE_DUMP_MALFORMED` rather than silently ignored.

### Symbolication (MINCRM-615)

Both raw formats converge on `istanbul-lib-coverage`'s `FileCoverageData` shape before a shared branch/function extraction step produces `NormalizedCoverageUnit` rows:

- **Backend (`v8-script-coverage`):** resolved via `v8-to-istanbul`, which reads the actual source file's text off disk to map V8 byte offsets back to statement/branch/function positions. The script's `file://` URL is resolved to a real path via `fs.realpath`, checked for genuine containment under the dump's `sourceRoot` (not a naive string-prefix check, which would wrongly accept a sibling directory that merely shares the root as a text prefix) — both the candidate path and `sourceRoot` are realpath'd before comparison, since a symlinked source root (e.g. macOS's `/var` → `/private/var`) would otherwise make every script spuriously unresolvable or compute a garbled relative path.
- **Frontend (`istanbul`):** used directly — `vite-plugin-istanbul` (Phase 1) already instruments against original TS/JSX via Babel + sourcemaps, so `window.__coverage__` dumps arrive pre-resolved to original source positions. No separate sourcemap-resolution step runs here.

**Branch-vs-function fallback is decided per function, not per file.** A single file can freely mix a branching function (has entries in `branchMap`) and a non-branching one (a straight-line function with no `branchMap` entry of its own) — deciding the fallback at the file level would silently drop the non-branching function's `f[fnKey]` hit count entirely whenever any other function in the same file happens to branch. Each function in `fnMap` is checked individually for whether it encloses at least one of the file's own branch mappings; only functions with none fall back to a function-granularity unit.

Unresolvable regions (a script URL with no real file backing it — e.g. a `node:` builtin or `eval()`'d code, or an outright `v8-to-istanbul` conversion failure) are recorded with `resolved: false` + `unresolvedReason`, never silently dropped.

### Version-anchored storage model (MINCRM-616)

`coverage_units` — one row per `(commit_sha, file_path, unit_key, branch_id)` identity:

- `unit_key` is a qualified function/method signature (e.g. `render@42`), not a line number — chosen so the mapping-engine phase (`pr-tia-4`) that eventually consumes this table has a key stable across in-line edits, per MINCRM-619's stable-structural-key requirement. Full body-hash/AST-based key derivation is that later phase's work; this table's shape is simply built to support it.
- `branch_id` is `null` for function-granularity rows (no PG `''` sentinel — a `CHECK (branch_id IS NULL OR branch_id <> '')` constraint enforces this at the schema level, since the identity index below treats `NULL` and `''` as the same dedup slot and a real empty string would silently collide with a genuinely branch-less row).
- **Dedup/compaction:** a unique index over `(commit_sha, file_path, unit_key, COALESCE(branch_id, ''))` — `COALESCE` because a plain `UNIQUE` constraint would never treat two `NULL`-`branch_id` rows for the same unit as duplicates (SQL `NULL <> NULL`). Re-ingesting a dump for an already-seen identity accumulates `hit_count` and advances `last_seen_at` rather than duplicating the row.
- **Retention:** `coverageModelService.pruneCoverageUnits(retentionDays)` deletes rows whose `last_seen_at` is older than the window, along with any `coverage_test_links` rows matching a unit deleted by that same prune (same transaction) and any `coverage_ingested_dumps` rows past the same window. Scheduled daily via `coverageRetentionScheduler.ts` (MINCRM-637) — see [Scheduled retention pruning](#scheduled-retention-pruning) below for the full mechanism, including why the link cleanup is scoped by "was this unit just deleted," not the link's own independent freshness.
- `coverage_ingested_dumps` — tracks which `dumpId`s have already been normalized, the mechanism behind MINCRM-614's idempotency/race-safety guarantee above. Not FK'd to raw dump metadata (still file-based, per Phase 1). Retention-pruned by the same `pruneCoverageUnits` call above (MINCRM-637).

Not audited (no `AuditActor`/`writeAuditEntry`) — `coverage_units` is derived, system-internal telemetry with no owning user and no user-facing mutation surface, mirroring `coverageSessionService.recordCoverageSessionDump`'s own unaudited high-frequency writes.

### Ingestion trigger endpoint

| Method | Path                                     | Purpose                                                                                                                                                                                                         |
| ------ | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST` | `/api/v1/admin/coverage/pipeline/ingest` | Normalize + symbolicate one dump by ID into `coverage_units`. `201` on first ingestion, `200` with `alreadyIngested: true` on a repeat call, `404` for an unknown `dumpId`, `400` for a malformed payload file. |

Gated by `authenticate → coverageAccessGate` ([Access Control](#access-control-mincrm-637)), with the whole router registered only when `COVERAGE_PIPELINE_INGESTION` is `'true'` at boot (MINCRM-685 — migration 163 removed the `coverage_pipeline_ingestion` feature flag in favor of it). Mounted in `app.ts` before the general `coverage.ts` router (same more-specific-before-general precedent as `/coverage/sessions`). Independent of `COVERAGE_INSTRUMENTATION` and `COVERAGE_SESSION_MANAGEMENT` — a server can produce and attribute raw dumps while the normalization pipeline itself stays off.

No scheduled or automatic trigger exists — ingestion is manual/CI-triggered only, matching this phase's scope. Reference client: `qa/e2e/framework/coverageAgent/coverage-pipeline-client.ts`.

```ts
import { ingestCoverageDump } from '@framework/coverageAgent/coverage-pipeline-client.js';

const result = await ingestCoverageDump(restClient, dumpId);
// { dumpId, commitSha, alreadyIngested, unitCount, unresolvedCount }
```

## Local / CI / Shared-env setup

**The coverage database provisions itself automatically** — no manual step needed. `server.ts`'s own boot sequence calls `runCoverageMigrations()` right after the product database's `runMigrations()`, which creates `minicrm_coverage` (or whatever `COVERAGE_DB_NAME` resolves to) if it doesn't exist yet and runs `qa/migrations/` against it, exactly mirroring how the product database's own `POSTGRES_DB`/`runMigrations()` pairing works. This runs unconditionally on every boot, regardless of which coverage routers registered — a server can never finish starting up with an unprovisioned or schema-stale coverage database, the same fail-fast guarantee the product database already had. (A manual creation step existed briefly in an earlier revision of this doc before automatic provisioning was added — found missing during PR review, since a fresh CI run or deployment had no path to create this database at all before this fix.)

Server-side unit tests get the same treatment via `server/src/__tests__/globalSetup.ts` (Vitest's `globalSetup`), which now provisions both `minicrm_test` and `minicrm_coverage_test` before any test file runs. E2E provisions `minicrm_coverage_e2e` via `qa/scripts/create-coverage-e2e-db.ts`, invoked from `scripts/e2e-setup.ts` alongside the product E2E database's own `create-e2e-db.ts`.

**Local — backend only:**

```bash
COVERAGE_INSTRUMENTATION=true npx tsx server/src/server.ts
```

**Local — frontend only:**

```bash
COVERAGE=true npm run dev --workspace=minicrm-client
```

**Local — E2E against the coverage-enabled test server:**

```bash
docker compose -f docker-compose.test.yml up -d server
```

The test stack sets all five coverage route gates to `true` unconditionally
(`docker-compose.test.yml`), so no extra step is needed. Production
deployments must never set any of them.

The `coverage_instrumentation` feature flag this step once described is gone (migration 161, MINCRM-663): `COVERAGE_INSTRUMENTATION=true` at boot is now the only switch, and it gates both the agent and the control API's route registration. There is nothing to enable in the admin UI.

**CI:** set `COVERAGE_INSTRUMENTATION=true` in the server start step's env block for a job that opts in; no separate step — the coverage feature flags were removed in MINCRM-663/685. Dump artifacts land under `server/coverage-dumps/` and can be uploaded the same way `server/coverage/lcov.info` already is in `ci.yml`'s `server-tests` job.

**Shared test environment:** enabling this is a legitimate use case (the story explicitly calls it out), but there is no per-session isolation — the backend agent is a single process-wide counter set with no multi-tenant separation. Every concurrent request on that server instance contributes to the same counters. This is fine for a dedicated CI/E2E instance; it would produce meaningless aggregate data if naively left on for a real multi-user shared staging environment with concurrent human traffic. Turn it off when not actively collecting.

## Mapping Engine (MINCRM-618/619/620/621, `pr-tia-4`)

Turns Phase 3's version-anchored `coverage_units` into an actual bidirectional
code⇄test index, with identity stable across edits and a queryable public
surface. Strictly additive — no existing `coverage_units`, ingestion, session,
or control-API behavior from earlier phases changes.

### Stable structural keys (MINCRM-619)

`server/src/coverageAgent/pipeline/structuralKeyService.ts`. Replaces the
placeholder `${name}@${declLine}` unit key (used inline as
`qualifiedUnitKey`/`qualifiedUnitKeyForLine` inside
`coverageSymbolicationService.ts` through the Phase 3 era) with
`${qualifiedName}#${normalizedBodyHash}` — a SHA-256 (truncated to 16 hex
chars) of the function's own source text, after stripping whitespace-run
differences and comments. In-line edits elsewhere in a file (which shift a
function's declaration line but not its own body) now leave the function's
identity — and therefore its accumulated `coverage_units` history — intact.
A genuine edit to the function's own logic changes the hash and is treated
as a new identity, exactly as the AC calls for.

Deriving the hash needs the function's own source text. Both symbolication
paths attempt to read it (the backend path from the same resolved file path
`v8-to-istanbul` already reads; the frontend path from istanbul's own
`FileCoverageData#path`) and gracefully fall back to the legacy `name@line`
key when the source can't be read (wrong machine, deleted file) — coverage
counts stay valid even when identity derivation degrades for that function.

### Bidirectional code⇄test index (MINCRM-618)

`coverage_test_links` (migration 159) + `server/src/services/coverageMappingService.ts`
close a gap Phase 3 left open on purpose: `coverage_units` merges `hit_count`
across every dump ever ingested for a commit SHA, with no per-test
breakdown. At ingestion time, `coverageIngestionService` now looks up
whether the dump being ingested has session attribution (a
`coverage_session_dumps` row — see Session Management above — with a
non-null `test_id`, via the new `coverageSessionService.findCoverageSessionDumpByDumpId`)
and, if so, links the SAME units to that test via
`coverageMappingService.linkCoverageUnitsToTest`, invoked as
`coverageModelService.upsertCoverageUnits`'s new `onUnitsUpserted` callback
so both writes commit in one transaction. A dump with no session
attribution (or a null `test_id` — e.g. a manual-recorder check-in with no
single associated test) is ingested into `coverage_units` exactly as
before, simply producing no `coverage_test_links` rows for it.

`coverage_test_links` identity is `(commit_sha, unit_key, branch_id,
test_id)`, deduped the same `COALESCE(branch_id, '')` way as
`coverage_units_identity_idx` (migration 158) and for the identical reason.
Re-ingesting the same dump/test pair merges `hit_count` rather than
duplicating.

**Unresolved units are never linked.** A unit with `resolved: false` (a
`node:` builtin, `eval()`'d code, or a failed conversion — see
Symbolication below) all share the literal `unitKey: 'unknown'` with no
real `file_path` behind them. `coverageIngestionService` filters these out
before calling `linkCoverageUnitsToTest` — linking them would collapse
every unrelated unresolved unit across every file into the SAME
`(commit_sha, unitKey, branchId, testId)` identity, corrupting that slot
for any other test that also happened to touch an unresolved script.
`coverage_units` itself still records these rows unchanged (with
`resolved: false`); only the per-test mapping omits them.

**Same-batch identity collisions (both `coverage_units` and
`coverage_test_links`):** a single dump's symbolication can legitimately
produce more than one row for the same identity in one call (e.g. a
function reached via more than one V8 script) — PostgreSQL's
`ON CONFLICT DO UPDATE` rejects a multi-row `INSERT` that would update the
same conflict-target row twice within one statement
("ON CONFLICT DO UPDATE command cannot affect row a second time"). Found as
a real, previously-latent bug in `coverageModelService.insertCoverageUnitBatch`
while adding the equivalent `coverage_test_links` write — both now
pre-aggregate (sum `hit_count`) duplicate identities within a batch before
building the `INSERT`, closing the bug in both places, not just the new one.

### Confidence/freshness scoring & reconciliation (MINCRM-620)

`server/src/coverageAgent/pipeline/coverageReconciliationService.ts`. Re-validates `coverage_units` against the CURRENT source tree and git history for a given `commitSha` — not the state at ingestion time — via `reconcileCoverageUnits(commitSha, sourceRoot)`, callable on demand (mirrors `coverageModelService.pruneCoverageUnits`'s own "callable, not scheduled" precedent; wiring an automatic build-time trigger is the CI/CD Integration epic's concern, `pr-tia-7`).

Three things happen per file a commit's units reference:

- **Still exists:** every unit for that file gets a fresh `confidence_score` (linear decay from `1.0` down to a `0.1` floor over 30 days since `last_seen_at`) and `last_reconciled_at = now()`.
- **Gone, no rename detected:** pruned outright (`deleteCoverageUnitById`) — a permanently-dead row serves no purpose once its code no longer exists anywhere in the tree.
- **Gone, but renamed/moved (git's own rename detection, `git diff --find-renames`):** the SAME row is updated in place (`relocateCoverageUnit`) to the new `file_path`, carrying its `unit_key`, `hit_count`, `first_seen_at`, and id forward unchanged. `unit_key` itself never needs re-deriving here — MINCRM-619's structural key (name + normalized-body-hash) already survives content edits by construction; only `file_path` needs to catch up to where the file now lives. In the rare case the destination identity already has its own row (e.g. the rename target was already ingested separately under the same commit), `relocateCoverageUnit` merges the moving row's `hit_count` into that existing row and deletes the moving row, rather than violating `coverage_units_identity_idx` — it returns the id of whichever row actually survives, which the caller must use for the confidence-scoring step that follows (the original id no longer exists in the merge case).

**Why file-granularity rename detection, not per-function:** re-deriving each function's own body hash again during reconciliation would duplicate a guarantee MINCRM-619 already provides. Git's rename detection operates at file granularity, which is exactly the gap structural keys don't close on their own (a key survives its _file's_ content changing, not the file itself moving).

**No new git library dependency:** shells out to `git` via `execFileSync`/`execFile` with array arguments (never a shell string), mirroring the existing precedent in `coverageConfig.ts`'s `resolveCommitSha`.

**A real git pathspec gotcha, found while testing against an actual renamed file (not mocked):** `git diff <sha> HEAD -- old/path.ts` — restricting the diff to the rename's OLD-side path — reports no rename at all, even though the unrestricted `git diff <sha> HEAD` correctly reports `R100 old/path.ts new/path.ts`. `findRenamedPathViaGit` therefore asks for the full unrestricted diff and filters for the matching old-path in application code, rather than trusting git's pathspec restriction to preserve rename-pair association.

### Mapping query API (MINCRM-621)

| Method | Path                                            | Purpose                                                                |
| ------ | ----------------------------------------------- | ---------------------------------------------------------------------- |
| `GET`  | `/api/v1/admin/coverage/mapping/tests-for-unit` | Code unit → covering tests, scoped by `commitSha`, confidence attached |
| `GET`  | `/api/v1/admin/coverage/mapping/units-for-test` | Test → covered code units, scoped by `commitSha`, confidence attached  |

Gated by `authenticate → coverageAccessGate` ([Access Control](#access-control-mincrm-637)), with the whole router registered only when `COVERAGE_MAPPING_QUERY` is `'true'` at boot (MINCRM-685 — migration 163 removed the `coverage_mapping_query` feature flag in favor of it). Mounted in `app.ts` before the general `coverage.ts` router (same more-specific-before-general precedent as `/coverage/sessions` and `/coverage/pipeline`). Independent of `COVERAGE_PIPELINE_INGESTION`: a server can have ingested `coverage_test_links` data while the query API itself stays off.

Both endpoints read `coverageMappingService.findTestsForUnitWithConfidence`/`findUnitsForTestWithConfidence`, which `LEFT JOIN coverage_test_links` against `coverage_units` on the shared `(commit_sha, file_path, unit_key, branch_id)` identity — matching `coverage_units_identity_idx`'s own exact shape, so the join can never match more than one row. Both tables live in the SAME coverage database, so this is a normal same-database join, not a cross-database query. `confidenceScore`/`lastReconciledAt` are `null` in a result when no matching `coverage_units` row exists (e.g. reconciliation pruned it) — the mapping result itself is still returned, never silently dropped.

The response shape (`CoverageMappingResult`) is a deliberately separate, documented/versioned wire contract from `coverageMappingService`'s own `CoverageTestLink` DB-row type (MINCRM-621's "documented, versioned interface" AC) — `coverage_test_links`' column set is free to change independently as long as this response shape is preserved. See `shared/schemas/coverageMappingSchema.ts`.

Reference client: `qa/e2e/framework/coverageAgent/coverage-mapping-client.ts`.

```ts
import {
  findTestsForUnit,
  findUnitsForTest,
} from '@framework/coverageAgent/coverage-mapping-client.js';

const testResults = await findTestsForUnit(restClient, {
  commitSha,
  unitKey: 'render#a1b2c3d4e5f6a7b8',
});
const unitResults = await findUnitsForTest(restClient, {
  commitSha,
  testId: 'spec:deals.spec.ts::creates a deal',
});
```

## Change Impact Analysis & Test Selection (MINCRM-623/624/625/626/627, `pr-tia-6`)

Turns a git diff into a test selection decision. See
[ADR-003](../adr/003-test-impact-analysis-selection.md) for the full pipeline design,
including the safety-net/scorer decoupling invariant this section summarizes.

**Pipeline:** `diffParser.parseGitDiff` (git diff → per-file changed line ranges) →
`changeUnitResolver.resolveChangedUnits` (line ranges → `(filePath, unitKey, branchId)`
changed units, via the same TS-compiler-API function-boundary detection and
`structuralKeyService.deriveStructuralUnitKey` the mapping engine itself uses, so a
changed unit's key is byte-identical to what's already stored) →
`testSelectionService.selectTestsForChangedUnits` (changed units → affected tests via the
mapping query API, MINCRM-621) → `dependencyGraphService.resolveDependencyWideningForFiles`
(config/resource/migration file changes → widened test scopes) →
`safetyNetPolicy.applySafetyNetPolicy` (baseline union + full-suite fallback decision).

### Git-diff change detector (MINCRM-623)

`diffParser.ts` shells `git diff --unified=0 --find-renames=50%` (array-args `execFile`,
never a shell string — same precedent as `coverageReconciliationService.ts`'s rename
lookup) and parses hunk headers into per-file changed line ranges, classifying each file
added/deleted/modified/renamed. Config/resource/migration files
(`.ya?ml`/`.json`/`.env`/`db/migrations/`) are flagged `isNonSourceFile` and routed
separately — they have no function/unit identity of their own.

`changeUnitResolver.ts` walks the TypeScript AST (`ts.createSourceFile` +
`ts.forEachChild`) to find function/method boundaries, maps each changed line to its most
specific enclosing function, and derives that function's `unit_key` the same way the
mapping engine's own ingestion path does. Each resulting changed unit is classified `new`
(no corresponding function existed in the base revision), `deleted` (file removed
entirely), `in-line` (same function, changed body hash — an ordinary edit), or `refactor`
(same function, UNCHANGED body hash — the diff touched this function's range but its own
logic didn't change, signaling the real edit is likely a sibling/structural move).

### Test selection algorithm (MINCRM-624, batched lookups MINCRM-637)

`testSelectionService.selectTestsForChangedUnits` resolves every changed unit's direct
mapping in ONE batched call —
`coverageMappingService.findTestsForUnitsAcrossBranches` (MINCRM-637) — instead of the
per-unit fan-out this originally shipped with. This collapsed what was up to
`ceil(N/MAX_CONCURRENT_MAPPING_LOOKUPS)` sequential round trips into as many queries as
the batch function's own chunking needs (typically one, for any diff under its
per-batch chunk size — see `findTestsForUnitsAcrossBranches`' own docblock). A changed
unit with no direct mapping (new code, or a genuinely unmapped unit) falls through to a
SEPARATE, still-per-unit inheritance step — bounded concurrency
(`MAX_CONCURRENT_MAPPING_LOOKUPS = 5`) against `coverageDb`'s 10-connection pool cap
(see `coverageDb.ts`) — inheriting candidates from a caller-supplied enclosing/calling
unit key instead of being dropped; a unit with no mapping even after inheritance is
surfaced via `unmappedChanges` for the safety net to widen around. Batching the
inheritance step too was considered and rejected: `select-tests.ts`, the only
production caller, never supplies `enclosingUnitsByUnitKey`, so that path is
unreachable in production today. Output is deduplicated by `testId` (a `direct-hit`
occurrence is kept over an `inherited` one for the same test) before being handed to
the scorer for ranking.

### Config/infra dependency graph (MINCRM-625)

`dependencyGraphService.ts` is a deterministic `RegExp`-keyed rule table (explicitly not
ML, per its own AC) mapping non-source file changes to widened test scopes. DB/QA
migrations, CI workflow files, docker-compose files, and `.env` files are flagged
`alwaysWiden: true` — their blast radius can't be safely bounded by any targeted scope, so
the safety net's full-suite fallback fires regardless of what the mapping-based selection
otherwise found. Shared Zod schemas and i18n locale files get targeted (non-`alwaysWiden`)
scope widening instead. Rule results are always unioned into the mapping-based selection,
never subtracted from it.

### Safety-net selection policy (MINCRM-626)

`safetyNetPolicy.applySafetyNetPolicy` unions an always-run baseline set (smoke/critical
paths, supplied by the caller) into every selection unconditionally, and forces a
full-suite fallback — never a partial widening — when any of: a selected test's confidence
score is below `TIA_MIN_CONFIDENCE_THRESHOLD` (default `0.3`), the fraction of unmapped
changed units exceeds `TIA_MAX_UNMAPPED_RATIO` (default `0.5`), the dependency graph
flagged `alwaysWiden`, or the caller explicitly requests `forceFullSuite` (the periodic
nightly/pre-merge recalibration case). A test that is both baseline and independently
mapping-selected reports its reason as `'baseline'` — the stronger, unconditional
guarantee — rather than picking one label arbitrarily.

### Pluggable scoring interface (MINCRM-627)

`scorer.ts` defines `TestScorer`: `score(changedUnits, candidateTests, features) =>
SelectedTest[]`, invoked exactly ONCE per selection over the full diff and the
already-deduplicated candidate list (not once per changed unit — ranking is a
cross-candidate decision that a per-unit call could only approximate). The default
`mapBasedScorer` implements confidence-first, alphabetical-tie-break ranking.
`selectTestsForChangedUnits` accepts an optional `scorer` parameter defaulting to
`mapBasedScorer`, so existing callers are unaffected.

**Critical invariant:** `safetyNetPolicy.ts` never imports or references `scorer.ts`/
`TestScorer` — the baseline set is `applySafetyNetPolicy`'s own separate parameter, never
derived from or filtered by a scorer's output. A future ML ranker (`pr-tia-10`,
MINCRM-638-640) can therefore replace `mapBasedScorer` freely: it can reorder or cap
non-baseline candidates, but has no code path to suppress a baseline test or bypass the
full-suite fallback decision. Verified in `scorer.test.ts` both behaviorally (an adversarial
drop-all scorer still leaves baseline tests present after `applySafetyNetPolicy`) and
structurally (a source-text scan asserting `safetyNetPolicy.ts` contains no reference to
"scorer").

## Record Mode — the authoritative run (MINCRM-633/687)

`.github/workflows/tia-record-mode.yml` runs the full `@functional` suite with coverage
instrumentation on every push to `main` — and only on that, plus `workflow_dispatch`. A
nightly 03:00 UTC cron was removed (MINCRM-699): the map is a function of the code on
`main`, so on a day with no merges it recomputed an identical map, while accounting for
half of this workflow's runs. It ingests every dump it
produces, and — only if the run is clean — exports `qa/coverage-map.jsonl` and commits it
back to `main`. It is the **authoritative** signal the PR-time gating defers to;
`ci.yml`'s own `tia-selection` job is fast, advisory feedback only.

### The environment contract

The suite step's `env:` block must track `ci.yml`'s E2E jobs (`ci.yml:1443-1452` is the
closest analogue). This is not optional polish — MINCRM-687 was a five-week outage of this
workflow caused by one missing variable:

| Variable                             | Consequence if unset                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `E2E_ADMIN_PASSWORD`                 | **Hard failure.** No default anywhere. Eleven `@functional` specs `throw` at module scope, so Playwright collects **0 tests**.                                                                                                                                                                                                                                                                           |
| `E2E_ADMIN_EMAIL`                    | Silently defaults to `admin@example.com`; login 401s if the seeded admin differs.                                                                                                                                                                                                                                                                                                                        |
| `E2E_API_URL`                        | `globalSetup.ts` falls back to `:3001` under CI, but `apps/minicrm/apiBaseUrl.ts` defaults to `:3002` — set it so the two cannot disagree.                                                                                                                                                                                                                                                               |
| `E2E_BASE_URL`, `E2E`, `MAILHOG_URL` | CI-only fallbacks happen to be correct; set explicitly for parity.                                                                                                                                                                                                                                                                                                                                       |
| `PW_GLOBAL_TIMEOUT_MS`               | Falls back to the config's 20-minute default, calibrated for a _sharded_ run. A single-worker full-suite run needs far more.                                                                                                                                                                                                                                                                             |
| `GIT_COMMIT_SHA`                     | Coverage sessions fall back to `GITHUB_SHA` (when it is non-empty), which for a `workflow_dispatch` against a non-`main` ref is not the SHA the job checked out — the gate then queries one SHA while sessions carry another and fails with `no-session-attribution`. With neither variable usable, sessions are tagged `unknown` and the harness emits a `[coverage-session]` warning naming the cause. |

**The failure is silent, which is what made it expensive.** With `E2E_ADMIN_PASSWORD`
absent, `globalSetup.ts`'s `!adminPassword` branch does not throw — it writes an empty `storageState` and
returns. The run then fails three steps later at the attestation gate with
`no-session-attribution`, which reads like a coverage-plumbing fault rather than "nothing
ran". A zero-test guard now fails the job immediately after the suite step so the real
cause is named at the point it occurs.

AI healing is **deliberately off** here, unlike `ci.yml`'s E2E jobs. Healing repairs
drifted locators at runtime; the authoritative source of coverage attribution must record
what selectors actually resolve to, not what an LLM patched them into.

### Both Playwright projects run

The suite is invoked with `--project=desktop --project=mobile-web`. This is required, not
thoroughness for its own sake: the suite guards viewport-specific tests in **both**
directions, so no single project selection produces a skip-free run, and
`verify-test-attestation.ts` reports tests that never ran an assertion anywhere. Running
one project would leave the other's tests uncovered and the gate would report them.

Do not narrow this to one project. Doing so does not avoid the problem — it relocates it.

### How the attestation gate treats skips (MINCRM-687)

`verify-test-attestation.ts` raises **integrity** (the tests that ran, genuinely passed),
not **completeness**. A viewport-conditional skip is a test correctly declining to run
where it does not apply, which is not an integrity failure. So the gate reconciles each
test **across the project runs present in the results file**:

- passed in at least one project, failed in none → **attested**
- skipped in every project present → reported as `skipped-tests`
- failed in any project → reported as `test-failures`

Playwright emits one `<testsuite>` per (spec file, project) and puts the project name in
`hostname`, which is what makes this reconciliation possible.

Two properties worth knowing. First, the gate reconciles what the file _contains_ — it
cannot know which projects the caller intended, so a single-project invocation gets
exactly the guarantee it always had. Second, the reporter's declared `<testsuites tests="N">`
is cross-checked against the rows recovered; a disagreement is reported as
`results-file-unparseable` rather than passed over, because an all-pass gate must never
pass on evidence it failed to read.

This gate is shared with `scripts/pre-push-tia.ts`, so the same rules govern the local
pre-push hook.

### Why the run is slow, and what that does not affect

The full suite at `--workers=1` across two projects is 1322 tests (661 per project) and is
budgeted at 150 minutes via `PW_GLOBAL_TIMEOUT_MS`. That figure comes from this repo's
measured single-worker throughput of ~21–22 tests/min (see `playwright.config.ts`'s
`globalTimeout` comment),
which projects to ~60–63 minutes, plus margin for a CI runner slower than the dev machine
that rate was measured on. `scripts/pre-push-tia.ts` budgets 85 minutes for the same
two-project set. Single-worker is deliberate: this run mixes `@functional` and `@serial` in
one invocation, and `@serial` specs mutate shared `system_settings` rows. `ci.yml` gets
away with more parallelism (4 workers per shard on today's runners) only because it
_splits_ the suite across jobs, keeping `@serial` work in its own single-group invocations.

The attestation script's `--max-age-minutes` (default 120) is **not** a competing budget:
it stats the results file's mtime, written when the suite _finishes_, and the gate runs
seconds later. It guards against a stale results file left from an earlier run of the same
commit, not against a long job.

A **malformed flag value fails the gate outright** rather than falling back to a default
(MINCRM-696). `--max-age-minutes` requires a non-negative integer: `abc`, `5x`, `2.9`, `-5`
and a bare `--max-age-minutes=` are all rejected. Previously each of these silently
resolved to the 120-minute default — so an operator _narrowing_ the window who typo'd the
value got the widest one instead, with no signal. A bare `--selection=` is rejected the
same way. Note what this looks like in a red job: argument parsing happens before the gate
runs, so there is **no JSON on stdout and no `reasons` array** — just a non-zero exit and
an `InvalidArgError`/`MissingArgsError` on stderr naming the flag and the value it read.
The local pre-push hook surfaces that as its own synthetic `attestation-script-error`
rather than one of the reasons below, so if you see that string, read the stderr above it.

### Reading a failed run

- `results-file-missing` / the zero-test guard → the suite never ran; check the env block.
- `no-session-attribution` → coverage sessions were not recorded for this SHA; check that
  `coverage-instrumentation` is `'true'` on the `e2e-infra` step. **Locally, the usual
  cause is a buildSha mismatch rather than missing instrumentation**: the gate queries
  `coverage_sessions.build_sha` for the SHA passed as `--sha`, so a run that recorded
  sessions under a different value finds nothing. Since MINCRM-688 this announces itself
  rather than failing silently — grep the Playwright output for
  `[coverage-session]`, which names the reason (neither variable set, or a malformed
  value) and the fix. See "Local buildSha provenance" below.
- `results-file-stale` → the results file's mtime is older than `--max-age-minutes`
  (default 120). Re-run the suite; the artifact on disk predates the commit under test.
- `test-failures` → at least one test failed, or the reporter's own
  `<testsuites failures=/errors=>` totals are non-zero. The failing tests are named
  individually in the output.
- `skipped-tests` → a test was skipped under every project; usually a project was dropped
  from the invocation.
- `results-file-unparseable` → the results file could not be fully read. This is a
  parser/reporter disagreement, _not_ a test outcome — do not infer pass or fail from it.
- `zero-tests-executed` → the results file is well-formed but reports zero tests. An empty
  run is not a passing run. The usual cause is every selected spec being filtered out by
  `--grep`/`--grep-invert` — the failure mode that let a wholly-`@serial` selected spec
  produce no tests and still pass the local hook before MINCRM-705. Note this reason is
  only reachable when the SHA already has attributed dumps from an earlier run; otherwise
  `no-session-attribution` fires first.
- `selection-file-unreadable` → a `--selection` file was supplied but could not be read as
  a requirement list, so run-vs-selection reconciliation did not happen. The message names
  the specific cause: a missing path, an unreadable file, malformed JSON, or no `specFiles`
  array of strings. Like `results-file-unparseable` this is an _input_ failure, not a test
  outcome — the required tests may or may not have run. A `--selection` naming
  `mode: 'full-suite'`, or no `--selection` at all, is _not_ this reason: both legitimately
  mean "nothing targeted to reconcile".
- `missing-required-tests` → a `--selection` file was supplied and readable, and the run
  did not cover every spec it required. Only the local pre-push hook passes `--selection`;
  record mode runs the full suite and has nothing to reconcile against. Mutually exclusive
  with `selection-file-unreadable` — an unreadable selection yields no requirement list to
  fall short of.

This list must name every member of `AttestationFailureReason`, and that is **enforced**,
not left to reviewers: `verifyTestAttestation.test.ts` reads this section and fails if any
reason exported from `ATTESTATION_FAILURE_REASONS` is missing a backticked entry above.
The reasons and their operator-facing text are defined together in `FAILURE_MESSAGES`
(`server/src/scripts/verify-test-attestation.ts`), where the type already makes a reason
without a message a compile error. (MINCRM-691)

### Is attestation per-test or per-file? (MINCRM-705)

Both, on two independent axes — and knowing which is which explains what the gate can and
cannot catch:

- **Pass/fail is per-test.** `findFailedTests` and `findTestsSkippedEverywhere` operate on
  rows in `results.xml`, reconciled across projects by `hostname`. They have no notion of
  an _expected_ test, so they can only judge rows that exist.
- **Run-vs-selection is per-file**, and does not read `results.xml` at all. It diffs the
  `--selection` file's `specFiles` against `ranFiles`, which is built from
  **coverage-session dumps for the SHA** — so it answers "did this file run at any point
  under this SHA", not "did it run in this invocation".

Two consequences worth holding onto. First, a selected spec whose tests are _all_ filtered
out does get caught, but only in targeted mode, and it surfaces as
`missing-required-tests` — a per-file reason — rather than as anything about the tests
themselves. Second, because `ranFiles` is SHA-scoped rather than invocation-scoped, a
caller may legitimately run several Playwright invocations and attest once at the end;
that is what the local hook's targeted path does for its non-serial/serial split.

The export and commit steps are gated on the suite, the zero-test guard, and the
attestation all succeeding, which is why no incomplete map has ever been committed.

### Local buildSha provenance (MINCRM-688)

A local run stamps a commit SHA in **two independent places**, from two processes, at
two different times. They are consumed by different things, so they fail differently:

| Aspect            | Coverage **sessions**                                             | Coverage **dumps**                                                   |
| ----------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------- |
| Resolved in       | the Playwright harness, on the **host**                           | the test server, in the **container**                                |
| Reads             | `GIT_COMMIT_SHA` from the harness's own environment, at test time | `GIT_COMMIT_SHA` from Compose, at **`docker compose up` time**       |
| Consumed by       | the attestation gate (`--sha`)                                    | `dump:coverage-map` → the committed `qa/coverage-map.jsonl`          |
| Wrong value means | the gate fails with `no-session-attribution`                      | the gate is fine, but the generated map is keyed to the wrong commit |

Both resolve `GIT_COMMIT_SHA`, then `GITHUB_SHA`, then degrade — each variable tested
for a non-empty value independently, so an empty string falls through rather than
winning. Neither degrades silently any more:

- The harness prints a `[coverage-session]` warning naming the reason and the fix.
- `pre-push-tia.ts` passes the resolved HEAD SHA to every Playwright child it spawns,
  so sessions and the gate cannot disagree on the pre-push path, and warns when the
  running container's SHA is not HEAD.

The container's value is the one that goes stale: it is read once at `up` and never
re-read, so a stack outliving a branch switch keeps stamping the old SHA. Realigning
means rebuilding and recreating the server, which **wipes the dumps inside it** — copy
them out first if a run you care about has already produced them.

A third path, the coverage dashboard's manual Session Recorder, resolves its own
`VITE_BUILD_SHA` at build time and shows an on-screen notice when the result is
unusable; see [the dashboard README](../../coverage-dashboard/README.md).

> **Note:** `.github/actions/e2e-infra` is record mode's setup action, but `ci.yml`'s E2E
> jobs still inline their own equivalent sequence rather than calling it. Changing a step
> in one place means checking the other — MINCRM-687's missing SMTP seeding was caused by
> exactly that drift.

`qa/coverage-map.jsonl` is the artifact this workflow produces. It is loaded into a fresh
database by `npm run load:coverage-map --workspace=minicrm-server`, which is how CI — having no persistent coverage
database — restores the committed map before a selection run.

Because both projects run, `coverage_test_links` holds roughly twice the rows a
single-project run would produce: `testInfo.testId` is project-scoped, so the same test
contributes one row per project. Selection is unaffected — `select-tests.ts` resolves
through `testFile`, and both testIds converge on the same file — but expect the committed
map to be about twice the size of a desktop-only one.

### Map format (MINCRM-703)

Line-delimited JSON, normalized into three sections:

```text
{"generatedAt":"…","format":2}                      ← header
{"t":0,"testId":"…","testName":"…","testFile":"…"}  ← one per test
{"u":0,"filePath":"…","unitKey":"…","branchId":…}   ← one per code unit
{"l":[0,0,7]}                                        ← one per link: [test, unit, hits]
…
{"entryCount":24001}                                 ← trailer
```

**Why normalized.** A denormalized entry repeats its test's name, its test's
file path, and the covered file's path — none of which vary per entry for a
given test or unit. Measured on a realistic corpus (600 tests × 40 units drawn
from a 1500-unit pool): 308 bytes per link denormalized versus **30.7
normalized, a 10× reduction**. That matters because the map must fit under
GitHub's 100MB per-file push limit or it cannot be committed at all — 3.4M links
fit at the normalized size, against ~340k before.

Both dictionaries are bounded by _entity_ count; only the link lines scale with
the product. Section order is load-bearing: the reader resolves references as it
streams, so a dictionary line must precede any link naming it.

`format` lets the reader reject a layout it does not understand rather than
misparse one. A file with no `format` key is version 1, the denormalized
layout.

Both ends stream it, so neither ever holds the whole map in memory. The previous
single-object format was buffered and pretty-printed, and died permanently on
`RangeError: Invalid string length` once the serialized form crossed V8's 512MB
maximum string length — with the reader hitting the identical wall.

**The trailer is a completeness check, not decoration.** A streaming writer can be
killed mid-file, leaving a valid header and valid entries but no trailer. The reader
treats a missing or mismatched trailer as a hard failure, because loading a truncated
map would silently narrow every later test selection.

**Entries are commit-agnostic.** The table accumulates a row per (mapping,
`commit_sha`) forever, but the load re-keys every entry to one caller-supplied SHA and
merges duplicates — so the per-commit copies have no consumer and are collapsed away on
export. `hit_count` is the MAX across commits rather than the sum: ingestion already
accumulates it within a commit, so summing across commits would grow it without bound.

### Reading a failed load

| Symptom                                                   | Meaning                                                                                             |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `No committed map at …` (exit 0)                          | No map has been committed yet. Legitimate; selection falls back to the unmapped-changes safety net. |
| `… is present but unusable: no entry-count trailer`       | The export was interrupted. The file is truncated — re-run record mode.                             |
| `… entry-count mismatch`                                  | The file was modified after export, or the write was partial.                                       |
| `… line N is not valid JSON` / `missing a required field` | The file is corrupt at that line.                                                                   |

Only the first is survivable. Every other case exits non-zero rather than degrading
silently, which is the behaviour this replaced: a bare `catch` previously turned all of
them into "no map found" and exit 0.

## Deferred to later phases

Not built here — later `pr-tia-*` phases:

- ML-based test selection (the `TestScorer` interface exists as the extension point;
  the actual ML ranker is `pr-tia-10`, MINCRM-638-640)
- Wiring test selection's output into CI (`gen-shards.ts`, the CI plugin/PR gating) —
  `pr-tia-8`, MINCRM-633/634/660
- "Tests skipped" / "CI time saved" TIA value metrics — `/tia-metrics` (MINCRM-631,
  see [Reporting & Gap Analysis](#reporting--gap-analysis-mincrm-629630631-pr-tia-7))
  reports coverage trend as a proxy today; the real figures need CI's own
  test-selection run log, which nothing persists until `pr-tia-8` wires selection
  output into CI (MINCRM-633/634/660)
- Coverage-driven CI gating (failing a build on coverage drop)
- Cross-shard dump merging/aggregation — CI currently uploads per-shard dump directories as-is
- An automated overhead-regression CI gate (the measurement above is manual)
- Physically isolated per-session V8 counters — sessions group and attribute dumps; the backend agent's counters remain process-wide (see Session Management above)
