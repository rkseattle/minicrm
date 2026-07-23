/**
 * e2e-setup.ts — Initialise local E2E infrastructure before running the functional suite.
 *
 * Prerequisites:
 *   docker compose -f docker-compose.dev.yml --profile e2e up -d
 *
 * Steps:
 *   1. Create minicrm_e2e database and run migrations (MINCRM-330)
 *   2. Seed E2E admin user into minicrm_e2e (MINCRM-330)
 *   3. Wait for MinIO readiness (polls /minio/health/live, 30 s timeout)
 *   4. Create the test bucket idempotently via mc inside the MinIO container
 *   5. Seed MinIO storage config into system_settings (delegates to seed:e2e-storage)
 *   6. [STUB — activate with MINCRM-306] Seed Mailhog SMTP config into system_settings
 *
 * Usage:
 *   npm run e2e:setup
 *
 * MINCRM-317, MINCRM-318, MINCRM-330
 */

import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

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

const MINIO_HEALTH_URL = 'http://localhost:9000/minio/health/live';
const MINIO_IMAGE = 'minio/minio:latest';
const MINIO_BUCKET = 'minicrm-test-bucket';
const MINIO_ALIAS = 'local';
// Host-side endpoint (used by mc for bucket creation and health checks)
const MINIO_ENDPOINT = 'http://localhost:9000';
// Docker-internal endpoint written into system_settings so the server-e2e
// container can reach MinIO via the Docker service name rather than localhost.
const MINIO_SERVER_ENDPOINT = 'http://minio:9000';
const MINIO_ROOT_USER = 'minioadmin';
const MINIO_ROOT_PASSWORD = 'minioadmin';

// Docker-internal SMTP host written into system_settings so the server-e2e
// container can reach Mailhog via the Docker service name rather than localhost.
const MAILHOG_SERVER_HOST = 'mailhog';
const MAILHOG_SMTP_PORT = '1025';

const READINESS_TIMEOUT_MS = 30_000;
const READINESS_POLL_INTERVAL_MS = 1_000;

// ── Step 1: Create minicrm_e2e database and run migrations ───────────────────

function ensureE2eDatabase(): void {
  console.log(`[e2e:setup] Ensuring ${E2E_DB_NAME} database exists and is migrated...`);

  const dbUser = process.env.DB_USER ?? 'minicrm';
  const dbPassword = process.env.DB_PASSWORD ?? 'password';
  const dbHost = process.env.DB_HOST ?? 'localhost';
  const dbPort = process.env.DB_PORT ?? '5432';

  execSync('npm run create:e2e-db --workspace=minicrm-server', {
    stdio: 'inherit',
    env: {
      ...process.env,
      DB_USER: dbUser,
      DB_PASSWORD: dbPassword,
      DB_HOST: dbHost,
      DB_PORT: dbPort,
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

  const dbUser = process.env.DB_USER ?? 'minicrm';
  const dbPassword = process.env.DB_PASSWORD ?? 'password';
  const dbHost = process.env.DB_HOST ?? 'localhost';
  const dbPort = process.env.DB_PORT ?? '5432';

  execSync('npm run create:coverage-e2e-db --workspace=minicrm-qa', {
    stdio: 'inherit',
    env: {
      ...process.env,
      DB_USER: dbUser,
      DB_PASSWORD: dbPassword,
      DB_HOST: dbHost,
      DB_PORT: dbPort,
    },
  });

  console.log(`[e2e:setup] ${COVERAGE_E2E_DB_NAME} is ready.`);
}

// ── Step 2: Reset accumulated test data ──────────────────────────────────────
// Without this step, test users accumulate across runs (50k+ users observed),
// causing user-list pagination to time out and cascade failures across many
// test suites. Runs before seedE2eAdmin so the admin row is always present
// after the reset. (MINCRM-544)

function resetE2eData(): void {
  const adminEmail = process.env.E2E_ADMIN_EMAIL;
  const adminPassword = process.env.E2E_ADMIN_PASSWORD;

  if (!adminEmail || !adminPassword) {
    console.error(
      '[e2e:setup] ERROR: E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD must be set.\n' +
        '  Copy qa/e2e/.env.example to qa/e2e/.env and fill in the credentials.',
    );
    process.exit(1);
  }

  console.log('[e2e:setup] Resetting accumulated E2E test data...');

  const dbUser = process.env.DB_USER ?? 'minicrm';
  const dbPassword = process.env.DB_PASSWORD ?? 'password';
  const dbHost = process.env.DB_HOST ?? 'localhost';
  const dbPort = process.env.DB_PORT ?? '5432';

  execSync('npm run reset:e2e-data --workspace=minicrm-server', {
    stdio: 'inherit',
    env: {
      ...process.env,
      DB_USER: dbUser,
      DB_PASSWORD: dbPassword,
      DB_NAME: E2E_DB_NAME,
      DB_HOST: dbHost,
      DB_PORT: dbPort,
      E2E_ADMIN_EMAIL: adminEmail,
    },
  });

  console.log('[e2e:setup] E2E test data reset complete.');
}

// ── Step 3: Seed E2E admin user ───────────────────────────────────────────────

function seedE2eAdmin(): void {
  const adminEmail = process.env.E2E_ADMIN_EMAIL;
  const adminPassword = process.env.E2E_ADMIN_PASSWORD;

  if (!adminEmail || !adminPassword) {
    console.error(
      '[e2e:setup] ERROR: E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD must be set.\n' +
        '  Copy qa/e2e/.env.example to qa/e2e/.env and fill in the credentials.',
    );
    process.exit(1);
  }

  console.log('[e2e:setup] Seeding E2E admin user...');

  const dbUser = process.env.DB_USER ?? 'minicrm';
  const dbPassword = process.env.DB_PASSWORD ?? 'password';
  const dbHost = process.env.DB_HOST ?? 'localhost';
  const dbPort = process.env.DB_PORT ?? '5432';

  execSync('npm run seed:e2e-admin', {
    stdio: 'inherit',
    env: {
      ...process.env,
      DB_USER: dbUser,
      DB_PASSWORD: dbPassword,
      DB_NAME: E2E_DB_NAME,
      DB_HOST: dbHost,
      DB_PORT: dbPort,
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
      '    docker compose -f docker-compose.dev.yml --profile e2e up -d',
  );
  process.exit(1);
}

// ── Step 4: Create the test bucket idempotently ───────────────────────────────

function createMinioBucket(): void {
  console.log('[e2e:setup] Locating MinIO container...');

  const containerId = execSync(`docker ps --filter "ancestor=${MINIO_IMAGE}" --format "{{.ID}}"`)
    .toString()
    .trim();

  if (!containerId) {
    console.error(
      `[e2e:setup] ERROR: No running container found for image "${MINIO_IMAGE}".\n` +
        '  Make sure the e2e Compose profile is running:\n' +
        '    docker compose -f docker-compose.dev.yml --profile e2e up -d',
    );
    process.exit(1);
  }

  console.log(`[e2e:setup] Found MinIO container: ${containerId}`);

  execSync(
    `docker exec ${containerId} mc alias set ${MINIO_ALIAS} ${MINIO_ENDPOINT} ${MINIO_ROOT_USER} ${MINIO_ROOT_PASSWORD}`,
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

  const dbUser = process.env.DB_USER ?? 'minicrm';
  const dbPassword = process.env.DB_PASSWORD ?? 'password';
  const dbHost = process.env.DB_HOST ?? 'localhost';
  const dbPort = process.env.DB_PORT ?? '5432';

  execSync('npm run seed:e2e-storage', {
    stdio: 'inherit',
    env: {
      ...process.env,
      DB_USER: dbUser,
      DB_PASSWORD: dbPassword,
      DB_NAME: E2E_DB_NAME,
      DB_HOST: dbHost,
      DB_PORT: dbPort,
      E2E_STORAGE_ENDPOINT: MINIO_SERVER_ENDPOINT,
      E2E_STORAGE_BUCKET: MINIO_BUCKET,
      E2E_STORAGE_ACCESS_KEY_ID: MINIO_ROOT_USER,
      E2E_STORAGE_SECRET_ACCESS_KEY: MINIO_ROOT_PASSWORD,
    },
  });

  console.log('[e2e:setup] Storage config seeded.');
}

// ── Step 6: Seed Mailhog SMTP config into smtp_configuration ──────────────────
// MINCRM-306: Configures the E2E server to send transactional email to Mailhog
// on port 1025. E2E tests can then assert on delivery via the Mailhog HTTP API.

function seedSmtpConfig(): void {
  console.log('[e2e:setup] Seeding Mailhog SMTP config into smtp_configuration...');

  const dbUser = process.env.DB_USER ?? 'minicrm';
  const dbPassword = process.env.DB_PASSWORD ?? 'password';
  const dbHost = process.env.DB_HOST ?? 'localhost';
  const dbPort = process.env.DB_PORT ?? '5432';

  execSync('npm run seed:e2e-smtp', {
    stdio: 'inherit',
    env: {
      ...process.env,
      DB_USER: dbUser,
      DB_PASSWORD: dbPassword,
      DB_NAME: E2E_DB_NAME,
      DB_HOST: dbHost,
      DB_PORT: dbPort,
      E2E_SMTP_HOST: MAILHOG_SERVER_HOST,
      E2E_SMTP_PORT: MAILHOG_SMTP_PORT,
    },
  });

  console.log('[e2e:setup] SMTP config seeded.');
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  ensureE2eDatabase(); // MINCRM-330: create + migrate minicrm_e2e
  ensureCoverageE2eDatabase(); // create + migrate minicrm_coverage_e2e (separate DB, see coverageDb.ts)
  resetE2eData(); // MINCRM-544: truncate accumulated test data before seeding
  seedE2eAdmin(); // MINCRM-330: re-seed admin after reset
  await waitForMinio();
  createMinioBucket();
  seedStorageConfig();
  seedSmtpConfig(); // MINCRM-306: seed Mailhog SMTP config

  console.log('[e2e:setup] Done. Local E2E infrastructure is ready.');
}

main().catch((err: unknown) => {
  console.error('[e2e:setup] Fatal error:', err);
  process.exit(1);
});
