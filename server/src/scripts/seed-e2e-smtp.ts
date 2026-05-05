/**
 * seed-e2e-smtp.ts — Write Mailhog SMTP config into system_settings for E2E.
 *
 * Inserts (or overwrites) the smtp_* keys so the E2E server process sends
 * transactional email to Mailhog rather than a real SMTP server. Mailhog
 * captures messages and exposes them via HTTP API at port 8025.
 *
 * Usage:
 *   npm run seed:e2e-smtp --workspace=minicrm-server
 *
 * Required environment variables:
 *   DB_USER, DB_PASSWORD, DB_NAME, DB_HOST, DB_PORT
 *   NODE_ENCRYPTION_KEY   — 64-char hex string (32 bytes)
 *
 * Optional environment variables (defaults to Mailhog standard ports):
 *   E2E_SMTP_HOST         — default: localhost
 *   E2E_SMTP_PORT         — default: 1025
 *
 * MINCRM-306
 */

import pg from 'pg';

const { Pool } = pg;

// ── Main ──────────────────────────────────────────────────────────────────────

const pool = new Pool({
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT) || 5432,
});

async function main(): Promise<void> {
  const smtpHost = process.env.E2E_SMTP_HOST ?? 'localhost';
  const smtpPort = process.env.E2E_SMTP_PORT ?? '1025';

  const upserts: Array<[string, string]> = [
    ['smtp_host', smtpHost],
    ['smtp_port', smtpPort],
    ['smtp_user', ''],
    ['smtp_enabled', 'true'],
    ['email_notifications_enabled', 'true'],
  ];

  const client = await pool.connect();
  try {
    for (const [key, value] of upserts) {
      await client.query(
        `INSERT INTO system_settings (key, value, updated_at)
         VALUES ($1, $2, now())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
        [key, value],
      );
    }
    console.log(
      `[seed-e2e-smtp] SMTP config written: host=${smtpHost} port=${smtpPort} enabled=true`,
    );
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err: unknown) => {
  throw err;
});
