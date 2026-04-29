/**
 * Integration tests for contact-linking behaviour in accountService.
 *
 * Tests the setAccountContacts helper and the contact_ids wiring
 * in createAccount / updateAccount.
 *
 * Runs against a real PostgreSQL test database.
 */

import 'dotenv/config';
import { createAccount, updateAccount, setAccountContacts } from '../services/accountService.js';
import { createUser } from '../services/userService.js';
import pool from '../db.js';
import type { PoolClient } from 'pg';

const FILE_PREFIX = 'acct-link-svc';

const OWNER_USER = {
  email: `${FILE_PREFIX}-owner@example.com`,
  name: 'Account Link Owner',
  role: 'rep' as const,
  passwordHash: '$2b$12$placeholder_hash',
  status: 'active' as const,
};

const BASE_ACCOUNT = {
  name: 'Link Test Corp',
};

let ownerId: string;

/** Helper — inserts a bare contact row and returns its id */
async function insertContact(email: string): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `INSERT INTO contacts (first_name, last_name, email, owner_id)
     VALUES ('Test', 'Contact', $1, $2)
     RETURNING id`,
    [email, ownerId],
  );
  return result.rows[0].id;
}

/** Helper — fetches account_id for a contact */
async function getContactAccountId(contactId: string): Promise<string | null> {
  const result = await pool.query<{ account_id: string | null }>(
    'SELECT account_id FROM contacts WHERE id = $1',
    [contactId],
  );
  return result.rows[0]?.account_id ?? null;
}

beforeAll(async () => {
  await pool.query(
    'DELETE FROM contacts WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    'DELETE FROM accounts WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
  const owner = await createUser(OWNER_USER);
  ownerId = owner.id;
});

beforeEach(async () => {
  await pool.query(
    'DELETE FROM contacts WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    'DELETE FROM accounts WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
});

afterAll(async () => {
  await pool.query(
    'DELETE FROM contacts WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    'DELETE FROM accounts WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
});

// ── setAccountContacts ──────────────────────────────────────────────────────────

describe('setAccountContacts', () => {
  it('links specified contacts to the account', async () => {
    const account = await createAccount({ ...BASE_ACCOUNT, owner_id: ownerId });
    const contactId = await insertContact('link1@example.com');

    const client: PoolClient = await pool.connect();
    try {
      await client.query('BEGIN');
      await setAccountContacts(account.id, [contactId], client);
      await client.query('COMMIT');
    } finally {
      client.release();
    }

    expect(await getContactAccountId(contactId)).toBe(account.id);
  });

  it('unlinks contacts not in the new list', async () => {
    const account = await createAccount({ ...BASE_ACCOUNT, owner_id: ownerId });
    const keepId = await insertContact('keep@example.com');
    const removeId = await insertContact('remove@example.com');

    // First link both
    const client1: PoolClient = await pool.connect();
    try {
      await client1.query('BEGIN');
      await setAccountContacts(account.id, [keepId, removeId], client1);
      await client1.query('COMMIT');
    } finally {
      client1.release();
    }

    // Now update to keep only one
    const client2: PoolClient = await pool.connect();
    try {
      await client2.query('BEGIN');
      await setAccountContacts(account.id, [keepId], client2);
      await client2.query('COMMIT');
    } finally {
      client2.release();
    }

    expect(await getContactAccountId(keepId)).toBe(account.id);
    expect(await getContactAccountId(removeId)).toBeNull();
  });

  it('unlinks all contacts when given an empty array', async () => {
    const account = await createAccount({ ...BASE_ACCOUNT, owner_id: ownerId });
    const contactId = await insertContact('unlink-all@example.com');

    const client1: PoolClient = await pool.connect();
    try {
      await client1.query('BEGIN');
      await setAccountContacts(account.id, [contactId], client1);
      await client1.query('COMMIT');
    } finally {
      client1.release();
    }

    const client2: PoolClient = await pool.connect();
    try {
      await client2.query('BEGIN');
      await setAccountContacts(account.id, [], client2);
      await client2.query('COMMIT');
    } finally {
      client2.release();
    }

    expect(await getContactAccountId(contactId)).toBeNull();
  });

  it('does not unlink contacts belonging to a different account', async () => {
    const accountA = await createAccount({ name: 'Account A', owner_id: ownerId });
    const accountB = await createAccount({ name: 'Account B', owner_id: ownerId });
    const contactForB = await insertContact('for-b@example.com');

    // Link contactForB to accountB
    const client1: PoolClient = await pool.connect();
    try {
      await client1.query('BEGIN');
      await setAccountContacts(accountB.id, [contactForB], client1);
      await client1.query('COMMIT');
    } finally {
      client1.release();
    }

    // Now call setAccountContacts on accountA with empty list
    const client2: PoolClient = await pool.connect();
    try {
      await client2.query('BEGIN');
      await setAccountContacts(accountA.id, [], client2);
      await client2.query('COMMIT');
    } finally {
      client2.release();
    }

    // contactForB should still be linked to accountB
    expect(await getContactAccountId(contactForB)).toBe(accountB.id);
  });

  it('does not steal a contact that is already linked to a different account', async () => {
    const accountA = await createAccount({ name: 'Account A', owner_id: ownerId });
    const accountB = await createAccount({ name: 'Account B', owner_id: ownerId });
    const contactForB = await insertContact('steal-test@example.com');

    // Link contactForB to accountB
    const client1: PoolClient = await pool.connect();
    try {
      await client1.query('BEGIN');
      await setAccountContacts(accountB.id, [contactForB], client1);
      await client1.query('COMMIT');
    } finally {
      client1.release();
    }

    // Try to link the same contact to accountA
    const client2: PoolClient = await pool.connect();
    try {
      await client2.query('BEGIN');
      await setAccountContacts(accountA.id, [contactForB], client2);
      await client2.query('COMMIT');
    } finally {
      client2.release();
    }

    // Contact remains with accountB — accountA cannot steal it
    expect(await getContactAccountId(contactForB)).toBe(accountB.id);
  });
});

// ── createAccount with contact_ids ─────────────────────────────────────────────

describe('createAccount with contact_ids', () => {
  it('links contacts atomically on account creation', async () => {
    const contactId = await insertContact('on-create@example.com');
    const account = await createAccount({
      ...BASE_ACCOUNT,
      owner_id: ownerId,
      contact_ids: [contactId],
    });

    expect(await getContactAccountId(contactId)).toBe(account.id);
  });

  it('creates account successfully when no contact_ids provided', async () => {
    const account = await createAccount({ ...BASE_ACCOUNT, owner_id: ownerId });
    expect(account.id).toBeDefined();
  });

  it('creates account with empty contact_ids array without linking anything', async () => {
    const contactId = await insertContact('no-link@example.com');
    const account = await createAccount({
      ...BASE_ACCOUNT,
      owner_id: ownerId,
      contact_ids: [],
    });

    expect(account.id).toBeDefined();
    expect(await getContactAccountId(contactId)).toBeNull();
  });
});

// ── updateAccount with contact_ids ─────────────────────────────────────────────

describe('updateAccount with contact_ids', () => {
  it('links new contacts on update', async () => {
    const account = await createAccount({ ...BASE_ACCOUNT, owner_id: ownerId });
    const contactId = await insertContact('on-update@example.com');

    await updateAccount(account.id, { contact_ids: [contactId] });

    expect(await getContactAccountId(contactId)).toBe(account.id);
  });

  it('replaces existing contact links on update', async () => {
    const contactA = await insertContact('replace-a@example.com');
    const contactB = await insertContact('replace-b@example.com');
    const account = await createAccount({
      ...BASE_ACCOUNT,
      owner_id: ownerId,
      contact_ids: [contactA],
    });

    await updateAccount(account.id, { contact_ids: [contactB] });

    expect(await getContactAccountId(contactA)).toBeNull();
    expect(await getContactAccountId(contactB)).toBe(account.id);
  });

  it('updates account fields and contact links in the same call', async () => {
    const contactId = await insertContact('field-and-link@example.com');
    const account = await createAccount({ ...BASE_ACCOUNT, owner_id: ownerId });

    const updated = await updateAccount(account.id, {
      name: 'Renamed Corp',
      contact_ids: [contactId],
    });

    expect(updated!.name).toBe('Renamed Corp');
    expect(await getContactAccountId(contactId)).toBe(account.id);
  });

  it('does not modify contact links when contact_ids is omitted', async () => {
    const contactId = await insertContact('no-change@example.com');
    const account = await createAccount({
      ...BASE_ACCOUNT,
      owner_id: ownerId,
      contact_ids: [contactId],
    });

    // Update only the name — contact link should be preserved
    await updateAccount(account.id, { name: 'Still Linked Corp' });

    expect(await getContactAccountId(contactId)).toBe(account.id);
  });
});
