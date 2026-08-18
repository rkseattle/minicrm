/**
 * Integration tests for bulkService.
 *
 * Runs against a real PostgreSQL test database.
 * Two test users are created: an owner (rep) and another rep.
 * Tables are truncated before each test to ensure isolation.
 *
 *
 */

import 'dotenv/config';
import { bulkContacts, bulkAccounts, bulkDeals } from '../services/bulkService.js';
import { createContact } from '../services/contactService.js';
import { createAccount } from '../services/accountService.js';
import { createDeal } from '../services/dealService.js';
import { createUser } from '../services/userService.js';
import pool from '../db.js';
import { uid } from './testUtils.js';

const FILE_PREFIX = 'bulk-svc';

const OWNER_USER = {
  email: `${FILE_PREFIX}-owner@example.com`,
  name: 'Bulk Owner',
  role: 'rep' as const,
  passwordHash: '$2b$12$placeholder_hash',
  status: 'active' as const,
};

const OTHER_USER = {
  email: `${FILE_PREFIX}-other@example.com`,
  name: 'Bulk Other',
  role: 'rep' as const,
  passwordHash: '$2b$12$placeholder_hash',
  status: 'active' as const,
};

const ADMIN_USER = {
  email: `${FILE_PREFIX}-admin@example.com`,
  name: 'Bulk Admin',
  role: 'admin' as const,
  passwordHash: '$2b$12$placeholder_hash',
  status: 'active' as const,
};

let ownerId: string;
let otherUserId: string;
let adminId: string;

beforeAll(async () => {
  await pool.query(
    'DELETE FROM deals WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
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

  const other = await createUser(OTHER_USER);
  otherUserId = other.id;

  const admin = await createUser(ADMIN_USER);
  adminId = admin.id;
});

beforeEach(async () => {
  await pool.query('DELETE FROM deals WHERE owner_id = ANY($1)', [[ownerId, otherUserId, adminId]]);
  await pool.query('DELETE FROM contacts WHERE owner_id = ANY($1)', [
    [ownerId, otherUserId, adminId],
  ]);
  await pool.query('DELETE FROM accounts WHERE owner_id = ANY($1)', [
    [ownerId, otherUserId, adminId],
  ]);
});

afterAll(async () => {
  await pool.query('DELETE FROM deals WHERE owner_id = ANY($1)', [[ownerId, otherUserId, adminId]]);
  await pool.query('DELETE FROM contacts WHERE owner_id = ANY($1)', [
    [ownerId, otherUserId, adminId],
  ]);
  await pool.query('DELETE FROM accounts WHERE owner_id = ANY($1)', [
    [ownerId, otherUserId, adminId],
  ]);
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
});

const ownerActor = () => ({ id: ownerId, name: OWNER_USER.name, role: 'rep' as const });
const adminActor = () => ({ id: adminId, name: ADMIN_USER.name, role: 'admin' as const });

// ── bulkContacts ────────────────────────────────────────────────────────────

describe('bulkContacts — delete', () => {
  it('deletes all selected contacts and writes audit entries', async () => {
    const c1 = await createContact(
      {
        first_name: 'Alice',
        last_name: 'A',
        email: `${FILE_PREFIX}-${uid()}-ba1@example.com`,
        owner_id: ownerId,
      },
      ownerActor(),
    );
    const c2 = await createContact(
      {
        first_name: 'Bob',
        last_name: 'B',
        email: `${FILE_PREFIX}-${uid()}-ba2@example.com`,
        owner_id: ownerId,
      },
      ownerActor(),
    );

    const result = await bulkContacts({ action: 'delete', ids: [c1.id, c2.id] }, ownerActor());

    expect(result).toEqual({ affected: 2 });

    const remaining = await pool.query('SELECT id FROM contacts WHERE id = ANY($1)', [
      [c1.id, c2.id],
    ]);
    expect(remaining.rowCount).toBe(0);

    const audit = await pool.query(
      "SELECT * FROM audit_log WHERE record_id = ANY($1) AND event_type = 'deleted'",
      [[c1.id, c2.id]],
    );
    expect(audit.rowCount).toBe(2);
  });

  it('returns affected: 0 when no IDs match', async () => {
    const fakeId = '00000000-0000-0000-0000-000000000001';
    const result = await bulkContacts({ action: 'delete', ids: [fakeId] }, ownerActor());
    expect(result).toEqual({ affected: 0 });
  });
});

describe('bulkContacts — reassign', () => {
  it('updates owner_id on all selected contacts and writes audit entries', async () => {
    const c1 = await createContact(
      {
        first_name: 'Carol',
        last_name: 'C',
        email: `${FILE_PREFIX}-${uid()}-bc1@example.com`,
        owner_id: ownerId,
      },
      ownerActor(),
    );
    const c2 = await createContact(
      {
        first_name: 'Dave',
        last_name: 'D',
        email: `${FILE_PREFIX}-${uid()}-bc2@example.com`,
        owner_id: ownerId,
      },
      ownerActor(),
    );

    const result = await bulkContacts(
      { action: 'reassign', ids: [c1.id, c2.id], owner_id: otherUserId },
      ownerActor(),
    );

    expect(result).toEqual({ affected: 2 });

    const updated = await pool.query('SELECT owner_id FROM contacts WHERE id = ANY($1)', [
      [c1.id, c2.id],
    ]);
    expect(updated.rows.every((r) => r.owner_id === otherUserId)).toBe(true);

    const audit = await pool.query(
      "SELECT * FROM audit_log WHERE record_id = ANY($1) AND event_type = 'ownership_reassigned'",
      [[c1.id, c2.id]],
    );
    expect(audit.rowCount).toBe(2);
  });
});

describe('bulkContacts — ownership enforcement', () => {
  it('returns forbidden when rep includes an ID owned by another rep', async () => {
    const owned = await createContact(
      {
        first_name: 'Eve',
        last_name: 'E',
        email: `${FILE_PREFIX}-${uid()}-be1@example.com`,
        owner_id: ownerId,
      },
      ownerActor(),
    );
    const unowned = await createContact(
      {
        first_name: 'Frank',
        last_name: 'F',
        email: `${FILE_PREFIX}-${uid()}-be2@example.com`,
        owner_id: otherUserId,
      },
      { id: otherUserId, name: OTHER_USER.name },
    );

    const result = await bulkContacts(
      { action: 'delete', ids: [owned.id, unowned.id] },
      ownerActor(),
    );

    expect(result).toEqual({ forbidden: true });

    // Both records should still exist — transaction was rolled back
    const remaining = await pool.query('SELECT id FROM contacts WHERE id = ANY($1)', [
      [owned.id, unowned.id],
    ]);
    expect(remaining.rowCount).toBe(2);
  });

  it('admin can delete contacts owned by any rep', async () => {
    const c1 = await createContact(
      {
        first_name: 'Grace',
        last_name: 'G',
        email: `${FILE_PREFIX}-${uid()}-bg1@example.com`,
        owner_id: ownerId,
      },
      ownerActor(),
    );
    const c2 = await createContact(
      {
        first_name: 'Henry',
        last_name: 'H',
        email: `${FILE_PREFIX}-${uid()}-bg2@example.com`,
        owner_id: otherUserId,
      },
      { id: otherUserId, name: OTHER_USER.name },
    );

    const result = await bulkContacts({ action: 'delete', ids: [c1.id, c2.id] }, adminActor());

    expect(result).toEqual({ affected: 2 });

    const remaining = await pool.query('SELECT id FROM contacts WHERE id = ANY($1)', [
      [c1.id, c2.id],
    ]);
    expect(remaining.rowCount).toBe(0);
  });
});

// ── bulkAccounts ────────────────────────────────────────────────────────────

describe('bulkAccounts — delete', () => {
  it('deletes all selected accounts and writes audit entries', async () => {
    const a1 = await createAccount({ name: 'Bulk Acct 1', owner_id: ownerId });
    const a2 = await createAccount({ name: 'Bulk Acct 2', owner_id: ownerId });

    const result = await bulkAccounts({ action: 'delete', ids: [a1.id, a2.id] }, ownerActor());

    expect(result).toEqual({ affected: 2 });

    const remaining = await pool.query('SELECT id FROM accounts WHERE id = ANY($1)', [
      [a1.id, a2.id],
    ]);
    expect(remaining.rowCount).toBe(0);

    const audit = await pool.query(
      "SELECT * FROM audit_log WHERE record_id = ANY($1) AND event_type = 'deleted'",
      [[a1.id, a2.id]],
    );
    expect(audit.rowCount).toBe(2);
  });
});

describe('bulkAccounts — ownership enforcement', () => {
  it('returns forbidden when rep includes an ID owned by another rep', async () => {
    const ownedAccount = await createAccount({ name: 'My Account', owner_id: ownerId });
    const unownedAccount = await createAccount({ name: 'Their Account', owner_id: otherUserId });

    const result = await bulkAccounts(
      { action: 'delete', ids: [ownedAccount.id, unownedAccount.id] },
      ownerActor(),
    );

    expect(result).toEqual({ forbidden: true });

    const remaining = await pool.query('SELECT id FROM accounts WHERE id = ANY($1)', [
      [ownedAccount.id, unownedAccount.id],
    ]);
    expect(remaining.rowCount).toBe(2);
  });
});

// ── bulkDeals ────────────────────────────────────────────────────────────────

async function seedDeal(ownerIdParam: string, name: string) {
  return createDeal(
    { name, stage: 'Prospecting', owner_id: ownerIdParam },
    { id: ownerIdParam, name: 'Seed Actor' },
  );
}

describe('bulkDeals — delete', () => {
  it('deletes all selected deals and writes audit entries', async () => {
    const d1 = await seedDeal(ownerId, 'Deal 1');
    const d2 = await seedDeal(ownerId, 'Deal 2');

    const result = await bulkDeals({ action: 'delete', ids: [d1.id, d2.id] }, ownerActor());

    expect(result).toEqual({ affected: 2 });

    const remaining = await pool.query('SELECT id FROM deals WHERE id = ANY($1)', [[d1.id, d2.id]]);
    expect(remaining.rowCount).toBe(0);

    const audit = await pool.query(
      "SELECT * FROM audit_log WHERE record_id = ANY($1) AND event_type = 'deleted'",
      [[d1.id, d2.id]],
    );
    expect(audit.rowCount).toBe(2);
  });
});

describe('bulkDeals — change_stage', () => {
  it('updates stage on all selected deals and writes audit entries', async () => {
    const d1 = await seedDeal(ownerId, 'Stage Deal 1');
    const d2 = await seedDeal(ownerId, 'Stage Deal 2');

    const result = await bulkDeals(
      { action: 'change_stage', ids: [d1.id, d2.id], stage: 'Qualification' },
      ownerActor(),
    );

    expect(result).toEqual({ affected: 2 });

    const updated = await pool.query('SELECT stage FROM deals WHERE id = ANY($1)', [
      [d1.id, d2.id],
    ]);
    expect(updated.rows.every((r) => r.stage === 'Qualification')).toBe(true);

    const audit = await pool.query(
      "SELECT * FROM audit_log WHERE record_id = ANY($1) AND event_type = 'updated' AND field_name = 'Stage'",
      [[d1.id, d2.id]],
    );
    expect(audit.rowCount).toBe(2);
  });

  it('returns invalidStage for a non-existent stage name', async () => {
    const d1 = await seedDeal(ownerId, 'Stage Deal Invalid');

    const result = await bulkDeals(
      { action: 'change_stage', ids: [d1.id], stage: 'NonExistentStage' },
      ownerActor(),
    );

    expect(result).toEqual({ invalidStage: true });
  });
});

describe('bulkDeals — ownership enforcement', () => {
  it('returns forbidden when rep includes a deal owned by another rep', async () => {
    const owned = await seedDeal(ownerId, 'My Deal');
    const unowned = await seedDeal(otherUserId, 'Their Deal');

    const result = await bulkDeals({ action: 'delete', ids: [owned.id, unowned.id] }, ownerActor());

    expect(result).toEqual({ forbidden: true });

    const remaining = await pool.query('SELECT id FROM deals WHERE id = ANY($1)', [
      [owned.id, unowned.id],
    ]);
    expect(remaining.rowCount).toBe(2);
  });

  it('admin can delete deals owned by any rep', async () => {
    const d1 = await seedDeal(ownerId, 'Admin Can Delete 1');
    const d2 = await seedDeal(otherUserId, 'Admin Can Delete 2');

    const result = await bulkDeals({ action: 'delete', ids: [d1.id, d2.id] }, adminActor());

    expect(result).toEqual({ affected: 2 });
  });
});
