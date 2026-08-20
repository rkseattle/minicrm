/**
 * e2e-setup.ts — Initialise local E2E infrastructure before running the functional suite.
 *
 * Prerequisites:
 *   docker compose -f docker-compose.test.yml up -d
 *
 * Steps:
 *   1. Create minicrm_e2e database and run migrations
 *   2. Seed E2E admin user into minicrm_e2e
 *   3. Wait for MinIO readiness (polls /minio/health/live, 30 s timeout)
 *   4. Create the test bucket idempotently via mc inside the MinIO container
 *   5. Seed MinIO storage config into system_settings (delegates to seed:e2e-storage)
 *   6. [STUB — activate ] Seed Mailhog SMTP config into system_settings
 *
 * Usage:
 *   npm run e2e:setup
 *
 *
 */

import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
// Shared with scripts/pre-push-tia.ts so the two dev-port guards cannot drift,
// and so the rule has a test runner (root scripts/ has none).
import {
  resolveTestStackDbEnv,
  parseEnvFileContents,
  pickDbCoordinates,
  pickAdminCredentials,
  resolveTestStackAdmin,
  DevDatabaseRefusedError,
  DEV_DB_PORT,
  TEST_DB_PORT,
  type TestStackDbSource,
  type TestStackAdminSource,
} from '../qa/scripts/test-stack-db-env.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * DB coordinates as they existed in the REAL environment, captured BEFORE the
 * root .env load below.
 *
 * resolveTestDbEnv() consults these rather than process.env, for the same reason
 * pre-push-tia.ts does: root .env legitimately names the DEV database
 * (DB_PORT=5432) and is loaded here for NODE_ENCRYPTION_KEY, not for its
 * database coordinates. Reading the post-load value made the dev-port guard
 * refuse `npm run e2e:setup` outright on a standard local setup — the command
 * docs/operations.md documents as the bare invocation. It only appeared to work
 * via .claude/gates/e2e-run.md, whose `env $(cat qa/e2e/.env ...)` prefix
 * exports DB_PORT=5433 into the real environment first.
 *
 * The guard's real contract is preserved: an operator who deliberately EXPORTS
 * DB_PORT=5432 is still refused, which is the case that exists to stop this
 * script truncating the dev database.
 */
const EXPORTED_DB_PORT = process.env.DB_PORT;
const EXPORTED_DB_HOST = process.env.DB_HOST;
const EXPORTED_DB_USER = process.env.DB_USER;
const EXPORTED_DB_PASSWORD = process.env.DB_PASSWORD;
const EXPORTED_ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL;
const EXPORTED_ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD;

/**
 * Reads qa/e2e/.env directly, bypassing process.env — root .env is loaded below
 * for NODE_ENCRYPTION_KEY and its DEV coordinates would otherwise shadow the
 * test stack's.
 */
function readE2eEnvFile(): Record<string, string> {
  try {
    return parseEnvFileContents(
      readFileSync(resolve(__dirname, '..', 'qa', 'e2e', '.env'), 'utf8'),
    );
  } catch {
    return {};
  }
}

function readE2eEnvFileDbSource(): TestStackDbSource {
  return pickDbCoordinates(readE2eEnvFile());
}

/** Admin credentials live in qa/e2e/.env, so the bare `npm run e2e:setup` works. */
function resolveAdminCredentials(): TestStackAdminSource {
  return resolveTestStackAdmin(
    { E2E_ADMIN_EMAIL: EXPORTED_ADMIN_EMAIL, E2E_ADMIN_PASSWORD: EXPORTED_ADMIN_PASSWORD },
    pickAdminCredentials(readE2eEnvFile()),
  );
}

/**
 * Resolves the credentials or exits. Returns them non-optional so callers use them
 * directly instead of repeating the same presence check — which is what let the two
 * call sites drift apart in wording before they were shared.
 */
function requireAdminCredentials(): { email: string; password: string } {
  const { E2E_ADMIN_EMAIL: email, E2E_ADMIN_PASSWORD: password } = resolveAdminCredentials();

  if (!email || !password) {
    console.error(
      '[e2e:setup] ERROR: E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD must be set.\n' +
        '  Copy qa/e2e/.env.example to qa/e2e/.env and fill in the credentials.',
    );
    process.exit(1);
  }

  return { email, password };
}

// Load root .env so NODE_ENCRYPTION_KEY and other server-side vars are available
// to child scripts (e.g. seed:e2e-storage needs NODE_ENCRYPTION_KEY to encrypt secrets).
try {
  const rootEnv = readFileSync(resolve(__dirname, '..', '.env'), 'utf8');
  for (const line of rootEnv.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx);
    const value = trimmed.slice(eqIdx + 1);
    if (!(key in process.env)) process.env[key] = value;
  }
} catch {
  // Root .env is optional — CI supplies vars via the environment directly
}

// ── Constants ─────────────────────────────────────────────────────────────────

const E2E_DB_NAME = 'minicrm_e2e';

// Host-side MinIO port. The test stack publishes MinIO on 9002 (docker-compose.test.yml)
// so it cannot collide with anything already bound to 9000. Container-side stays 9000 —
// see MINIO_SERVER_ENDPOINT below.
const MINIO_HEALTH_URL = 'http://localhost:9002/minio/health/live';
const MINIO_IMAGE = 'minio/minio:latest';
const MINIO_BUCKET = 'minicrm-test-bucket';
const MINIO_ALIAS = 'local';
// CONTAINER-side endpoint. `mc alias set` runs via `docker exec` inside the MinIO
// container itself (see createMinioBucket below), so this localhost is the container's
// own loopback, where MinIO listens on 9000 — NOT the published host port. It only ever
// looked host-side because the two used to be the same number.
const MINIO_CONTAINER_ENDPOINT = 'http://localhost:9000';
// Docker-internal endpoint written into system_settings so the test server container
// can reach MinIO via the Docker service name rather than localhost. Unaffected by the
// host-side port change above — this is the in-network port.
const MINIO_SERVER_ENDPOINT = 'http://minio:9000';
/** Compose project owning the test stack — scopes container lookups below. */
const TEST_COMPOSE_PROJECT = 'minicrm-test';
const MINIO_ROOT_USER = 'minioadmin';
const MINIO_ROOT_PASSWORD = 'minioadmin';

// Docker-internal SMTP host written into system_settings so the test server
// container can reach Mailhog via the Docker service name rather than localhost.
const MAILHOG_SERVER_HOST = 'mailhog';
const MAILHOG_SMTP_PORT = '1025';

const READINESS_TIMEOUT_MS = 30_000;
const READINESS_POLL_INTERVAL_MS = 1_000;

/**
 * Resolves the DB connection settings injected into every child process below.
 *
 * Defaults DB_PORT to the TEST stack (5433), never 5432. With a 5432 fallback, every
 * child here would connect to the dev database, and resetE2eData() runs TRUNCATE
 * audit_log CASCADE plus mass DELETEs. That is precisely how the dev database was
 * wiped.
 *
 * Explicitly rejects an EXPORTED DB_PORT=5432 rather than silently proceeding: a
 * caller that exports it has almost certainly sourced the dev .env by mistake, and
 * continuing would destroy their data. DB_NAME is forced to the test databases at
 * each call site.
 *
 * "Exported" is literal — this reads the pre-.env snapshot, not process.env. An
 * earlier version read process.env and so could not tell a deliberate export from
 * root .env's own DB_PORT=5432, which this script loads for NODE_ENCRYPTION_KEY.
 * That refused every bare `npm run e2e:setup`. The docblock also asserted "neither
 * .env nor qa/e2e/.env sets DB_PORT" — both set it today.
 *
 * The port/guard rule itself lives in qa/scripts/test-stack-db-env.ts, shared with
 * pre-push-tia.ts, so the two cannot drift and the rule has a test runner.
 */
function resolveTestDbEnv(): {
  DB_USER: string;
  DB_PASSWORD: string;
  DB_HOST: string;
  DB_PORT: string;
} {
  let resolved;
  try {
    resolved = resolveTestStackDbEnv(
      {
        DB_PORT: EXPORTED_DB_PORT,
        DB_HOST: EXPORTED_DB_HOST,
        DB_USER: EXPORTED_DB_USER,
        DB_PASSWORD: EXPORTED_DB_PASSWORD,
      },
      readE2eEnvFileDbSource(),
    );
  } catch (err) {
    if (err instanceof DevDatabaseRefusedError) {
      console.error(
        `[e2e:setup] REFUSING TO RUN: DB_PORT=${DEV_DB_PORT} is the dev database.\n` +
          '  This script truncates and reseeds every table it touches. Running it against\n' +
          `  the dev stack destroys your data. The test stack listens on ${TEST_DB_PORT}:\n` +
          '    docker compose -f docker-compose.test.yml up -d\n' +
          '  Unset DB_PORT (or set it to 5433) and re-run.',
      );
      process.exit(1);
    }
    throw err;
  }
  // Every field comes from the shared resolver, so none can be inherited from
  // root .env's dev values — credentials included, which the pre-push hook
  // needs too and which therefore live in the resolver rather than here.
  return {
    DB_USER: resolved.DB_USER,
    DB_PASSWORD: resolved.DB_PASSWORD,
    DB_HOST: resolved.DB_HOST,
    DB_PORT: resolved.DB_PORT,
  };
}

// ── Step 1: Create minicrm_e2e database and run migrations ───────────────────

function ensureE2eDatabase(): void {
  console.log(`[e2e:setup] Ensuring ${E2E_DB_NAME} database exists and is migrated...`);

  const dbEnv = resolveTestDbEnv();

  execSync('npm run create:e2e-db --workspace=minicrm-server', {
    stdio: 'inherit',
    env: {
      ...process.env,
      ...dbEnv,
    },
  });

  console.log(`[e2e:setup] ${E2E_DB_NAME} is ready.`);
}

// ── Step 1b: Create minicrm_coverage_e2e database and run coverage migrations ─
// Coverage/TIA tables live in their own database, separate from minicrm_e2e
// above — see qa/migrations/001_coverage_baseline.js and server/src/coverageDb.ts.

const COVERAGE_E2E_DB_NAME = 'minicrm_coverage_e2e';

function ensureCoverageE2eDatabase(): void {
  console.log(`[e2e:setup] Ensuring ${COVERAGE_E2E_DB_NAME} database exists and is migrated...`);

  const dbEnv = resolveTestDbEnv();

  execSync('npm run create:coverage-e2e-db --workspace=minicrm-qa', {
    stdio: 'inherit',
    env: {
      ...process.env,
      ...dbEnv,
    },
  });

  console.log(`[e2e:setup] ${COVERAGE_E2E_DB_NAME} is ready.`);
}

// ── Step 2: Reset accumulated test data ──────────────────────────────────────
// Without this step, test users accumulate across runs (50k+ users observed),
// causing user-list pagination to time out and cascade failures across many
// test suites. Runs before seedE2eAdmin so the admin row is always present
// after the reset.

function resetE2eData(): void {
  // Both are required even though only the email is forwarded: the reset and the
  // reseed that follows it must agree on the account, so failing here rather than
  // midway through is what keeps a half-reset stack from being left behind.
  const { email: adminEmail } = requireAdminCredentials();

  console.log('[e2e:setup] Resetting accumulated E2E test data...');

  const dbEnv = resolveTestDbEnv();

  execSync('npm run reset:e2e-data --workspace=minicrm-server', {
    stdio: 'inherit',
    env: {
      ...process.env,
      ...dbEnv,
      DB_NAME: E2E_DB_NAME,
      E2E_ADMIN_EMAIL: adminEmail,
    },
  });

  console.log('[e2e:setup] E2E test data reset complete.');
}

// ── Step 3: Seed E2E admin user ───────────────────────────────────────────────

function seedE2eAdmin(): void {
  const { email: adminEmail, password: adminPassword } = requireAdminCredentials();

  console.log('[e2e:setup] Seeding E2E admin user...');

  const dbEnv = resolveTestDbEnv();

  execSync('npm run seed:e2e-admin', {
    stdio: 'inherit',
    env: {
      ...process.env,
      ...dbEnv,
      DB_NAME: E2E_DB_NAME,
      E2E_ADMIN_EMAIL: adminEmail,
      E2E_ADMIN_PASSWORD: adminPassword,
    },
  });

  console.log('[e2e:setup] E2E admin user seeded.');
}

// ── Step 3: Wait for MinIO readiness ─────────────────────────────────────────

async function waitForMinio(): Promise<void> {
  console.log('[e2e:setup] Waiting for MinIO to be ready...');

  const deadline = Date.now() + READINESS_TIMEOUT_MS;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(MINIO_HEALTH_URL);
      if (response.ok) {
        console.log('[e2e:setup] MinIO is ready.');
        return;
      }
    } catch {
      // MinIO not yet reachable — keep polling
    }

    await new Promise<void>((resolve) => setTimeout(resolve, READINESS_POLL_INTERVAL_MS));
  }

  console.error(
    `[e2e:setup] ERROR: MinIO did not become ready within ${READINESS_TIMEOUT_MS / 1000} seconds.\n` +
      '  Make sure the e2e Compose profile is running:\n' +
      '    docker compose -f docker-compose.test.yml up -d',
  );
  process.exit(1);
}

// ── Step 4: Create the test bucket idempotently ───────────────────────────────

function createMinioBucket(): void {
  console.log('[e2e:setup] Locating MinIO container...');

  // Scoped to the test Compose project, not just the image: an `ancestor=` filter alone
  // matches every running MinIO on the machine and returns them newline-joined, which
  // would interpolate into a malformed `docker exec`.
  const containerId = execSync(
    `docker ps --filter "label=com.docker.compose.project=${TEST_COMPOSE_PROJECT}" ` +
      `--filter "ancestor=${MINIO_IMAGE}" --format "{{.ID}}"`,
  )
    .toString()
    .trim();

  if (!containerId) {
    console.error(
      `[e2e:setup] ERROR: No running MinIO container found in the "${TEST_COMPOSE_PROJECT}" ` +
        'Compose project.\n' +
        '  Start the test stack first:\n' +
        '    docker compose -f docker-compose.test.yml up -d',
    );
    process.exit(1);
  }

  console.log(`[e2e:setup] Found MinIO container: ${containerId}`);

  execSync(
    `docker exec ${containerId} mc alias set ${MINIO_ALIAS} ${MINIO_CONTAINER_ENDPOINT} ${MINIO_ROOT_USER} ${MINIO_ROOT_PASSWORD}`,
    { stdio: 'pipe' },
  );

  // --ignore-existing makes this idempotent: safe to re-run in subsequent sessions.
  execSync(`docker exec ${containerId} mc mb --ignore-existing ${MINIO_ALIAS}/${MINIO_BUCKET}`, {
    stdio: 'pipe',
  });

  console.log(`[e2e:setup] Bucket "${MINIO_BUCKET}" is ready.`);
}

// ── Step 5: Seed MinIO storage config into system_settings ───────────────────

function seedStorageConfig(): void {
  console.log('[e2e:setup] Seeding MinIO storage config into system_settings...');

  const dbEnv = resolveTestDbEnv();

  execSync('npm run seed:e2e-storage', {
    stdio: 'inherit',
    env: {
      ...process.env,
      ...dbEnv,
      DB_NAME: E2E_DB_NAME,
      E2E_STORAGE_ENDPOINT: MINIO_SERVER_ENDPOINT,
      E2E_STORAGE_BUCKET: MINIO_BUCKET,
      E2E_STORAGE_ACCESS_KEY_ID: MINIO_ROOT_USER,
      E2E_STORAGE_SECRET_ACCESS_KEY: MINIO_ROOT_PASSWORD,
    },
  });

  console.log('[e2e:setup] Storage config seeded.');
}

// ── Step 6: Seed Mailhog SMTP config into smtp_configuration ──────────────────
// Configures the E2E server to send transactional email to Mailhog
// on port 1025. E2E tests can then assert on delivery via the Mailhog HTTP API.

function seedSmtpConfig(): void {
  console.log('[e2e:setup] Seeding Mailhog SMTP config into smtp_configuration...');

  const dbEnv = resolveTestDbEnv();

  execSync('npm run seed:e2e-smtp', {
    stdio: 'inherit',
    env: {
      ...process.env,
      ...dbEnv,
      DB_NAME: E2E_DB_NAME,
      E2E_SMTP_HOST: MAILHOG_SERVER_HOST,
      E2E_SMTP_PORT: MAILHOG_SMTP_PORT,
    },
  });

  console.log('[e2e:setup] SMTP config seeded.');
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  ensureE2eDatabase(); // create + migrate minicrm_e2e
  ensureCoverageE2eDatabase(); // create + migrate minicrm_coverage_e2e (separate DB, see coverageDb.ts)
  resetE2eData(); // truncate accumulated test data before seeding
  seedE2eAdmin(); // re-seed admin after reset
  await waitForMinio();
  createMinioBucket();
  seedStorageConfig();
  seedSmtpConfig(); // seed Mailhog SMTP config

  console.log('[e2e:setup] Done. Local E2E infrastructure is ready.');
}

main().catch((err: unknown) => {
  console.error('[e2e:setup] Fatal error:', err);
  process.exit(1);
});
