/**
 * Demo-suite teardown through the product's own removal body, so it clears exactly what
 * seeding creates.
 */
import pool from '../db.js';
import { DEMO_SEEDED_USER_EMAILS, removeDemoData } from '../services/demoService.js';
import { purgeFixtureUsers } from './testUtils.js';

/**
 * Removes all demo data and every user the seed creates. Calls the removal body directly:
 * removeDemo() skips when no demo account remains, which would leave partial leftovers.
 */
export async function clearDemoRecords(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await removeDemoData(client);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
  await purgeFixtureUsers({ emails: DEMO_SEEDED_USER_EMAILS });
}
