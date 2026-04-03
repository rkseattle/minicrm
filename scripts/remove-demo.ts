/**
 * remove-demo.ts — Remove all demo data from MiniCRM.
 *
 * Deletes every row where is_demo = true from activities, deal_contacts, deals,
 * contacts, and accounts. Real (non-demo) data is never touched.
 *
 * Usage:
 *   npm run remove:demo
 *
 * Requires a running PostgreSQL instance and a .env file (or environment variables)
 * that configure DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME.
 *
 * MINCRM-102
 */

import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;

/** Connect using the same env vars as the server. */
const pool = new Pool({
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT) || 5432,
});

async function main(): Promise<void> {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Delete activities linked to demo deals or demo contacts first (FK constraint)
    const activities = await client.query<{ count: string }>(
      `DELETE FROM activities WHERE is_demo = true RETURNING id`,
    );
    console.log(`[remove-demo] Deleted ${activities.rowCount} activities`);

    // Remove deal_contacts rows for demo deals
    const dealContacts = await client.query<{ count: string }>(
      `DELETE FROM deal_contacts
       WHERE deal_id IN (SELECT id FROM deals WHERE is_demo = true)`,
    );
    console.log(`[remove-demo] Deleted ${dealContacts.rowCount} deal_contact links`);

    // Delete demo deals
    const deals = await client.query(`DELETE FROM deals WHERE is_demo = true RETURNING id`);
    console.log(`[remove-demo] Deleted ${deals.rowCount} deals`);

    // Delete demo contacts
    const contacts = await client.query(`DELETE FROM contacts WHERE is_demo = true RETURNING id`);
    console.log(`[remove-demo] Deleted ${contacts.rowCount} contacts`);

    // Delete demo accounts
    const accounts = await client.query(`DELETE FROM accounts WHERE is_demo = true RETURNING id`);
    console.log(`[remove-demo] Deleted ${accounts.rowCount} accounts`);

    await client.query('COMMIT');
    console.log('[remove-demo] Done.');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('[remove-demo] Fatal error:', err);
  process.exit(1);
});
