/**
 * seed-e2e-smtp.ts — Write Mailhog SMTP config into smtp_configuration for E2E.
 *
 * Updates the smtp_configuration singleton row so the E2E server process sends
 * transactional email to Mailhog rather than a real SMTP server. Mailhog
 * captures messages and exposes them via HTTP API at port 8025.
 *
 * Usage:
 *   npm run seed:e2e-smtp --workspace=minicrm-server
 *
 * Required environment variables:
 *   DB_USER, DB_PASSWORD, DB_NAME, DB_HOST, DB_PORT
 *
 * Optional environment variables (defaults to Mailhog standard ports):
 *   E2E_SMTP_HOST         — default: localhost
 *   E2E_SMTP_PORT         — default: 1025
 *
 * MINCRM-306, MINCRM-502
 */

import pg from 'pg';
import { assertTestDatabaseTarget } from './assertTestDatabaseTarget.js';

const { Pool } = pg;

// ── Main ──────────────────────────────────────────────────────────────────────

// Refuse to run against anything but a test database — this script is destructive.
// The returned target IS the connection config: resolving DB_PORT/DB_NAME again from
// process.env would reintroduce the `|| 5432` fallback the guard exists to remove.
const testDbTarget = assertTestDatabaseTarget('seed-e2e-smtp');

const pool = new Pool({
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: testDbTarget.database,
  host: testDbTarget.host,
  port: Number(testDbTarget.port),
});

async function main(): Promise<void> {
  const smtpHost = process.env.E2E_SMTP_HOST ?? 'localhost';
  const smtpPort = Number(process.env.E2E_SMTP_PORT ?? '1025');

  const client = await pool.connect();
  try {
    // Update the smtp_configuration singleton row (guaranteed to exist post-migration 087).
    await client.query(
      `UPDATE smtp_configuration SET
         host = $1, port = $2, username = '', pass_encrypted = '',
         enabled = true, updated_at = now()`,
      [smtpHost, smtpPort],
    );

    // email_notifications_enabled remains in system_settings (not moved to smtp_configuration).
    await client.query(
      `INSERT INTO system_settings (key, value, updated_at)
       VALUES ('email_notifications_enabled', 'true', now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    );

    console.log(
      `[seed-e2e-smtp] SMTP config written to smtp_configuration: host=${smtpHost} port=${smtpPort} enabled=true`,
    );
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err: unknown) => {
  throw err;
});
