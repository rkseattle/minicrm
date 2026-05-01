/**
 * e2e-setup.ts — Initialise local E2E infrastructure before running the functional suite.
 *
 * Prerequisites:
 *   docker compose -f docker-compose.dev.yml --profile e2e up -d
 *
 * Steps:
 *   1. Wait for MinIO readiness (polls /minio/health/live, 30 s timeout)
 *   2. Create the test bucket idempotently via mc inside the MinIO container
 *   3. Seed MinIO storage config into system_settings (delegates to seed:e2e-storage)
 *   4. [STUB — activate with MINCRM-306] Seed Mailhog SMTP config into system_settings
 *
 * Usage:
 *   npm run e2e:setup
 *
 * MINCRM-317, MINCRM-318
 */

import { execSync } from 'child_process';

// ── Constants ─────────────────────────────────────────────────────────────────

const MINIO_HEALTH_URL = 'http://localhost:9000/minio/health/live';
const MINIO_IMAGE = 'minio/minio:latest';
const MINIO_BUCKET = 'minicrm-test-bucket';
const MINIO_ALIAS = 'local';
const MINIO_ENDPOINT = 'http://localhost:9000';
const MINIO_ROOT_USER = 'minioadmin';
const MINIO_ROOT_PASSWORD = 'minioadmin';

const READINESS_TIMEOUT_MS = 30_000;
const READINESS_POLL_INTERVAL_MS = 1_000;

// ── Step 1: Wait for MinIO readiness ─────────────────────────────────────────

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

// ── Step 2: Create the test bucket idempotently ───────────────────────────────

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

// ── Step 3: Seed MinIO storage config into system_settings ───────────────────

function seedStorageConfig(): void {
  console.log('[e2e:setup] Seeding MinIO storage config into system_settings...');

  execSync('npm run seed:e2e-storage', {
    stdio: 'inherit',
    env: {
      ...process.env,
      E2E_STORAGE_ENDPOINT: MINIO_ENDPOINT,
      E2E_STORAGE_BUCKET: MINIO_BUCKET,
      E2E_STORAGE_ACCESS_KEY_ID: MINIO_ROOT_USER,
      E2E_STORAGE_SECRET_ACCESS_KEY: MINIO_ROOT_PASSWORD,
    },
  });

  console.log('[e2e:setup] Storage config seeded.');
}

// ── Step 4 [STUB]: Seed Mailhog SMTP config into system_settings ──────────────
//
// Activate this block when MINCRM-306 ships. At that point:
//   - Uncomment the seedSmtpConfig() call in main()
//   - Implement the upsert queries for smtp_host, smtp_port, email_notifications_enabled
//   - Remove this comment block
//
// function seedSmtpConfig(): void {
//   console.log('[e2e:setup] Seeding Mailhog SMTP config into system_settings...');
//
//   // Upsert smtp_host = 'localhost', smtp_port = '1025',
//   // email_notifications_enabled = 'true' into system_settings.
//   //
//   // Use the same upsert pattern as seed-e2e-storage.ts:
//   //   INSERT INTO system_settings (key, value, updated_at) VALUES (...)
//   //   ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
//
//   console.log('[e2e:setup] SMTP config seeded.');
// }

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  await waitForMinio();
  createMinioBucket();
  seedStorageConfig();
  // seedSmtpConfig();  // MINCRM-306: uncomment when Mailhog SMTP support ships

  console.log('[e2e:setup] Done. Local E2E infrastructure is ready.');
}

main().catch((err: unknown) => {
  console.error('[e2e:setup] Fatal error:', err);
  process.exit(1);
});
