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
 *   npm run seed:e2e-admin --workspace=minicrm-server
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
import { assertTestDatabaseTarget } from './assertTestDatabaseTarget.js';

const { Pool } = pg;

// Refuse to run against anything but a test database — this script is destructive.
// The returned target IS the connection config: resolving DB_PORT/DB_NAME again from
// process.env would reintroduce the `|| 5432` fallback the guard exists to remove.
const testDbTarget = assertTestDatabaseTarget('seed-e2e-admin');

const pool = new Pool({
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: testDbTarget.database,
  host: testDbTarget.host,
  port: Number(testDbTarget.port),
});

const SALT_ROUNDS = 10;

async function main(adminEmail: string, adminPassword: string): Promise<void> {
  const client = await pool.connect();
  try {
    const existing = await client.query<{ id: string }>(
      `SELECT id FROM users WHERE email = $1 LIMIT 1`,
      [adminEmail],
    );

    if (existing.rows.length > 0) {
      console.log(
        `[seed-e2e-admin] Admin user already exists (id=${existing.rows[0].id}) — skipping.`,
      );
    } else {
      const passwordHash = await bcrypt.hash(adminPassword, SALT_ROUNDS);
      const result = await client.query<{ id: string }>(
        `INSERT INTO users (email, password_hash, name, role, status, must_change_password)
         VALUES ($1, $2, 'E2E Admin', 'admin', 'active', false)
         RETURNING id`,
        [adminEmail, passwordHash],
      );
      console.log(
        `[seed-e2e-admin] Admin user created (id=${result.rows[0].id}, email=${adminEmail}).`,
      );
    }
  } finally {
    client.release();
    await pool.end();
  }
}

const adminEmail = process.env.E2E_ADMIN_EMAIL;
const adminPassword = process.env.E2E_ADMIN_PASSWORD;

if (!adminEmail || !adminPassword) {
  throw new Error('[seed-e2e-admin] E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD must be set.');
}

main(adminEmail, adminPassword).catch((err: unknown) => {
  throw err;
});
