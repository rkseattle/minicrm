/**
 * PostgreSQL connection pool for the Coverage/TIA database.
 *
 * Coverage/TIA tables (coverage_units, coverage_sessions,
 * coverage_session_dumps, coverage_ingested_dumps, coverage_test_links)
 * live in their OWN database — separate from the product database db.ts
 * connects to — because this data is disposable, write-heavy,
 * retention-pruned CI/developer telemetry with a fundamentally different
 * access pattern, growth rate, and backup/retention policy than product
 * data (contacts/deals/users). None of these tables carry a foreign key
 * into the product schema (coverage_sessions.started_by is a plain uuid,
 * not an FK — see qa/migrations/001_coverage_baseline.js's column comment),
 * so there is no referential-integrity reason for them to share a
 * connection pool with product data. Schema for this database lives under
 * qa/migrations/, not db/migrations/ — see that migration file's docblock.
 *
 * Only services whose own data actually lives in the coverage database
 * should import this pool: coverageSessionService, coverageModelService,
 * coverageMappingService, coverageBuildSummaryService,
 * coverageReportingService (reads coverage_units/coverage_test_links/
 * coverage_build_summary for the reporting query API), and
 * coverageHealthService (a SELECT 1 reachability check, MINCRM-637 — no
 * coverage-domain table reads/writes of its own). Everything else in
 * server/src/services/ continues to use db.ts's product-database pool, which
 * is unchanged by the coverage split.
 *
 * Nothing in the product database gates these endpoints any more (MINCRM-685):
 * the coverage_pipeline_ingestion/coverage_mapping_query/
 * coverage_reporting_query feature_flags rows that used to are deleted, and
 * each router now decides whether to register its routes from a boot-time env
 * var instead. Access control on what does get registered is still a product
 * concern — authenticate plus coverageAccessGate, both reading the product
 * database via db.ts — so that pool is still very much in play here; it just
 * no longer has a coverage-specific row to consult.
 */

import pg from 'pg';
import 'dotenv/config';

const { Pool, types } = pg;

// pg returns bigint (OID 20, e.g. coverage_units.hit_count/coverage_test_links.hit_count)
// as a string by default to avoid JS number precision loss above 2^53. Set
// independently here, NOT inherited from db.ts's own identical call — pg's
// type parser registry is global per-process, so relying on db.ts having
// already been imported somewhere first would make this pool's numeric
// typing depend on unrelated module import order elsewhere in the process
// (e.g. whether a given test file happens to import db.ts too). Calling
// setTypeParser(20, ...) twice with an identical parser is a harmless no-op,
// not a conflict — see coverage_units/coverage_test_links hit_count fields,
// which fit safely within Number.MAX_SAFE_INTEGER for this app's purposes.
types.setTypeParser(20, (val: string) => parseInt(val, 10));

const DEFAULT_DB_PORT = 5432;
const DEFAULT_POOL_MAX = 10;
const STATEMENT_TIMEOUT_MS = 30_000;

/**
 * Shared connection pool instance for the coverage database.
 *
 * Falls back to the product DB's own DB_USER/DB_PASSWORD/DB_HOST/DB_PORT
 * when the COVERAGE_DB_* equivalents are unset. The invariant this relies on is
 * per-stack, not repo-wide: within any one environment the product and coverage
 * databases share a Postgres instance, credentials and port, differing only by
 * database name. Since MINCRM-684 there are two such stacks locally — dev on
 * :5432 (minicrm / minicrm_coverage, docker-compose.yml) and test on :5433
 * (minicrm_e2e / minicrm_coverage_e2e, docker-compose.test.yml) — so the
 * fallback is what keeps a test process's coverage pool on the same port as its
 * product pool. Splitting the two across different hosts or ports would break
 * that and require COVERAGE_DB_HOST/COVERAGE_DB_PORT to be set explicitly.
 *
 * COVERAGE_DB_NAME has no such fallback — it must be set explicitly (or defaults
 * to 'minicrm_coverage' below) so a misconfigured environment can never
 * accidentally point this pool at the product database by inheriting DB_NAME.
 */
const coverageDb = new Pool({
  user: process.env.COVERAGE_DB_USER ?? process.env.DB_USER,
  password: process.env.COVERAGE_DB_PASSWORD ?? process.env.DB_PASSWORD,
  database: process.env.COVERAGE_DB_NAME ?? 'minicrm_coverage',
  host: process.env.COVERAGE_DB_HOST ?? process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.COVERAGE_DB_PORT) || Number(process.env.DB_PORT) || DEFAULT_DB_PORT,
  max: Number(process.env.COVERAGE_DB_POOL_MAX) || DEFAULT_POOL_MAX,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  statement_timeout: STATEMENT_TIMEOUT_MS,
});

coverageDb.on('error', (err) => {
  throw new Error(`Unexpected coverage PostgreSQL pool error: ${err.message}`);
});

export default coverageDb;
