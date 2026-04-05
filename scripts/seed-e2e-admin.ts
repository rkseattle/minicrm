/**
 * seed-e2e-admin.ts — Insert a single admin user into the E2E database.
 *
 * Used by CI to bootstrap the minicrm_e2e database before running the BVT
 * test. The admin credentials are read from E2E_ADMIN_EMAIL and
 * E2E_ADMIN_PASSWORD environment variables.
 *
 * The script is idempotent — if a user with the given email already exists,
 * the existing record is left untouched.
 *
 * Usage:
 *   tsx scripts/seed-e2e-admin.ts
 *
 * Required environment variables:
 *   DB_USER, DB_PASSWORD, DB_NAME, DB_HOST, DB_PORT
 *   E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD
 *
 * MINCRM-131
 */

import 'dotenv/config';
import pg from 'pg';
import bcrypt from 'bcryptjs';

const { Pool } = pg;

const pool = new Pool({
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT) || 5432,
});

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD;

if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
  console.error('[seed-e2e-admin] E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD must be set.');
  process.exit(1);
}

const SALT_ROUNDS = 10;

const client = await pool.connect();
try {
  const existing = await client.query<{ id: string }>(
    `SELECT id FROM users WHERE email = $1 LIMIT 1`,
    [ADMIN_EMAIL],
  );

  if (existing.rows.length > 0) {
    console.log(
      `[seed-e2e-admin] Admin user already exists (id=${existing.rows[0].id}) — skipping.`,
    );
  } else {
    const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, SALT_ROUNDS);
    const result = await client.query<{ id: string }>(
      `INSERT INTO users (email, password_hash, name, role, status, must_change_password)
       VALUES ($1, $2, 'E2E Admin', 'admin', 'active', false)
       RETURNING id`,
      [ADMIN_EMAIL, passwordHash],
    );
    console.log(
      `[seed-e2e-admin] Admin user created (id=${result.rows[0].id}, email=${ADMIN_EMAIL}).`,
    );
  }
} finally {
  client.release();
  await pool.end();
}
