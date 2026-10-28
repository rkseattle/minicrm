/**
 * Integration tests for the version guard a late AI writer checks before saving.
 *
 * Run: npm test (from /server)
 */

import 'dotenv/config';
import pool from '../db.js';
import { createUser } from '../services/userService.js';
import { activitiesUnchangedSince } from '../services/activityDerivedText.js';
import { purgeFixtureUsers } from './testUtils.js';

const FILE_PREFIX = 'activity-derived-text';
const INSERTED_VERSION = 1;

let ownerId: string;
let accountId: string;

async function insertActivity(): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO activities (type, subject, notes, account_id, owner_id)
     VALUES ('Call', 'Guarded call', 'Guarded notes', $1, $2) RETURNING id`,
    [accountId, ownerId],
  );
  return result.rows[0].id;
}

async function scrub(activityId: string): Promise<void> {
  await pool.query('UPDATE activities SET notes = NULL, version = version + 1 WHERE id = $1', [
    activityId,
  ]);
}

async function unchangedSince(read: { id: string; version: number }[]): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    return await activitiesUnchangedSince(client, read);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
}

beforeAll(async () => {
  await purgeFixtureUsers({ emailLike: `${FILE_PREFIX}-%` });
  const owner = await createUser({
    email: `${FILE_PREFIX}-owner@example.com`,
    name: 'Derived Text Owner',
    role: 'rep',
    passwordHash: '$2b$12$placeholder_hash',
    status: 'active',
  });
  ownerId = owner.id;
  const account = await pool.query<{ id: string }>(
    `INSERT INTO accounts (name, owner_id) VALUES ('Derived Text Account', $1) RETURNING id`,
    [ownerId],
  );
  accountId = account.rows[0].id;
});

afterAll(async () => {
  await pool.query('DELETE FROM activities WHERE owner_id = $1', [ownerId]);
  await pool.query('DELETE FROM accounts WHERE owner_id = $1', [ownerId]);
  await purgeFixtureUsers({ emailLike: `${FILE_PREFIX}-%` });
});

describe('activitiesUnchangedSince', () => {
  it('accepts a source read twice at the version it still has', async () => {
    const task = await insertActivity();
    const call = await insertActivity();

    const unchanged = await unchangedSince([
      { id: task, version: INSERTED_VERSION },
      { id: call, version: INSERTED_VERSION },
      { id: task, version: INSERTED_VERSION },
    ]);

    expect(unchanged).toBe(true);
  });

  it('rejects a scrubbed source even when another source was read twice', async () => {
    const task = await insertActivity();
    const email = await insertActivity();
    await scrub(email);

    const unchanged = await unchangedSince([
      { id: task, version: INSERTED_VERSION },
      { id: task, version: INSERTED_VERSION },
      { id: email, version: INSERTED_VERSION },
    ]);

    expect(unchanged).toBe(false);
  });

  it('rejects one source read at two different versions', async () => {
    const call = await insertActivity();

    const unchanged = await unchangedSince([
      { id: call, version: INSERTED_VERSION },
      { id: call, version: INSERTED_VERSION + 1 },
    ]);

    expect(unchanged).toBe(false);
  });
});
