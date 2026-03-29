/**
 * Integration tests for dealService.
 *
 * Runs against a real PostgreSQL test database.
 * A single test user and account are created in beforeAll and reused.
 * The deals table is truncated before each test to ensure isolation.
 *
 * Run: npm test (from /server)
 */

import 'dotenv/config';
import {
  createDeal,
  findDealById,
  listDeals,
  updateDeal,
  deleteDeal,
  listDealContacts,
} from '../services/dealService.js';
import { createUser } from '../services/userService.js';
import pool from '../db.js';

/** Minimal user fixture used as deal owner */
const OWNER_USER = {
  email: 'deal-owner@example.com',
  name: 'Deal Owner',
  role: 'rep' as const,
  passwordHash: '$2b$12$placeholder_hash',
  status: 'active' as const,
};

/** Minimal deal fixture */
const BASE_DEAL = {
  name: 'Acme Enterprise Deal',
  stage: 'Prospecting' as const,
  value: 50000,
  close_date: '2026-12-31',
};

let ownerId: string;
let accountId: string;

beforeAll(async () => {
  await pool.query('DELETE FROM deal_contacts');
  await pool.query('DELETE FROM deals');
  await pool.query('DELETE FROM contacts');
  await pool.query('DELETE FROM accounts');
  await pool.query('DELETE FROM users WHERE email = $1', [OWNER_USER.email]);

  const owner = await createUser(OWNER_USER);
  ownerId = owner.id;

  // Create a test account for FK tests
  const accountResult = await pool.query<{ id: string }>(
    `INSERT INTO accounts (name, owner_id) VALUES ($1, $2) RETURNING id`,
    ['Test Account', ownerId],
  );
  accountId = accountResult.rows[0].id;
});

beforeEach(async () => {
  await pool.query('DELETE FROM deal_contacts');
  await pool.query('DELETE FROM deals');
});

afterAll(async () => {
  await pool.query('DELETE FROM deal_contacts');
  await pool.query('DELETE FROM deals');
  await pool.query('DELETE FROM contacts');
  await pool.query('DELETE FROM accounts');
  await pool.query('DELETE FROM users WHERE email = $1', [OWNER_USER.email]);
  await pool.end();
});

// ── createDeal ──────────────────────────────────────────────────────────────────

describe('createDeal', () => {
  it('inserts a deal and returns the full row', async () => {
    const deal = await createDeal({ ...BASE_DEAL, owner_id: ownerId });

    expect(deal.id).toBeDefined();
    expect(deal.name).toBe('Acme Enterprise Deal');
    expect(deal.stage).toBe('Prospecting');
    expect(deal.value).toBe('50000.00');
    expect(deal.close_date).toBe('2026-12-31');
    expect(deal.owner_id).toBe(ownerId);
    expect(deal.created_at).toBeInstanceOf(Date);
  });

  it('stores null for optional fields when omitted', async () => {
    const deal = await createDeal({
      name: 'Minimal Deal',
      stage: 'Qualification',
      owner_id: ownerId,
    });

    expect(deal.value).toBeNull();
    expect(deal.close_date).toBeNull();
    expect(deal.account_id).toBeNull();
    expect(deal.loss_reason).toBeNull();
  });

  it('stores account_id when provided', async () => {
    const deal = await createDeal({ ...BASE_DEAL, account_id: accountId, owner_id: ownerId });
    expect(deal.account_id).toBe(accountId);
  });

  it('throws when owner_id does not reference a real user', async () => {
    await expect(
      createDeal({ ...BASE_DEAL, owner_id: '00000000-0000-0000-0000-000000000000' }),
    ).rejects.toThrow();
  });
});

// ── findDealById ────────────────────────────────────────────────────────────────

describe('findDealById', () => {
  it('returns the deal row when found', async () => {
    const created = await createDeal({ ...BASE_DEAL, owner_id: ownerId });
    const found = await findDealById(created.id);

    expect(found).not.toBeNull();
    expect(found!.id).toBe(created.id);
    expect(found!.name).toBe('Acme Enterprise Deal');
  });

  it('returns null for a non-existent UUID', async () => {
    const found = await findDealById('00000000-0000-0000-0000-000000000000');
    expect(found).toBeNull();
  });
});

// ── listDeals ───────────────────────────────────────────────────────────────────

describe('listDeals', () => {
  it('returns an empty array when no deals exist', async () => {
    const deals = await listDeals();
    expect(deals).toEqual([]);
  });

  it('returns all deals ordered by created_at', async () => {
    await createDeal({ ...BASE_DEAL, name: 'Alpha Deal', owner_id: ownerId });
    await createDeal({ ...BASE_DEAL, name: 'Beta Deal', owner_id: ownerId });

    const deals = await listDeals();
    expect(deals).toHaveLength(2);
    expect(deals[0].name).toBe('Alpha Deal');
    expect(deals[1].name).toBe('Beta Deal');
  });

  it('filters by ownerId when provided', async () => {
    const other = await createUser({ ...OWNER_USER, email: 'other-deal-owner@example.com' });

    await createDeal({ ...BASE_DEAL, name: 'My Deal', owner_id: ownerId });
    await createDeal({ ...BASE_DEAL, name: 'Their Deal', owner_id: other.id });

    const mine = await listDeals({ ownerId });
    expect(mine).toHaveLength(1);
    expect(mine[0].name).toBe('My Deal');
  });

  it('filters by accountId when provided', async () => {
    await createDeal({
      ...BASE_DEAL,
      name: 'Account Deal',
      account_id: accountId,
      owner_id: ownerId,
    });
    await createDeal({ ...BASE_DEAL, name: 'No Account Deal', owner_id: ownerId });

    const accountDeals = await listDeals({ accountId });
    expect(accountDeals).toHaveLength(1);
    expect(accountDeals[0].name).toBe('Account Deal');
  });
});

// ── updateDeal ──────────────────────────────────────────────────────────────────

describe('updateDeal', () => {
  it('updates the specified fields and returns the updated row', async () => {
    const deal = await createDeal({ ...BASE_DEAL, owner_id: ownerId });

    const updated = await updateDeal(deal.id, { name: 'Updated Deal', stage: 'Qualification' });

    expect(updated!.name).toBe('Updated Deal');
    expect(updated!.stage).toBe('Qualification');
    // Unchanged fields remain intact
    expect(updated!.value).toBe('50000.00');
  });

  it('updates updated_at timestamp', async () => {
    const deal = await createDeal({ ...BASE_DEAL, owner_id: ownerId });
    const updated = await updateDeal(deal.id, { stage: 'Proposal' });

    expect(updated!.updated_at.getTime()).toBeGreaterThanOrEqual(deal.updated_at.getTime());
  });

  it('returns null for a non-existent deal', async () => {
    const result = await updateDeal('00000000-0000-0000-0000-000000000000', { name: 'Ghost' });
    expect(result).toBeNull();
  });
});

// ── deleteDeal ──────────────────────────────────────────────────────────────────

describe('deleteDeal', () => {
  it('removes the deal and returns the deleted row', async () => {
    const deal = await createDeal({ ...BASE_DEAL, owner_id: ownerId });

    const deleted = await deleteDeal(deal.id);
    expect(deleted!.id).toBe(deal.id);

    const found = await findDealById(deal.id);
    expect(found).toBeNull();
  });

  it('cascades deletion to deal_contacts without deleting the contact', async () => {
    const deal = await createDeal({ ...BASE_DEAL, owner_id: ownerId });

    // Create a contact and link it to the deal
    const contactResult = await pool.query<{ id: string }>(
      `INSERT INTO contacts (first_name, last_name, email, owner_id)
       VALUES ('Test', 'Contact', 'dc-test@example.com', $1)
       RETURNING id`,
      [ownerId],
    );
    const contactId = contactResult.rows[0].id;

    await pool.query('INSERT INTO deal_contacts (deal_id, contact_id) VALUES ($1, $2)', [
      deal.id,
      contactId,
    ]);

    await deleteDeal(deal.id);

    // deal_contacts row should be gone
    const dcRow = await pool.query(
      'SELECT * FROM deal_contacts WHERE deal_id = $1 AND contact_id = $2',
      [deal.id, contactId],
    );
    expect(dcRow.rows).toHaveLength(0);

    // Contact itself should still exist
    const contactRow = await pool.query('SELECT * FROM contacts WHERE id = $1', [contactId]);
    expect(contactRow.rows[0]).toBeDefined();
  });

  it('returns null for a non-existent deal', async () => {
    const result = await deleteDeal('00000000-0000-0000-0000-000000000000');
    expect(result).toBeNull();
  });
});

// ── listDealContacts ────────────────────────────────────────────────────────────

describe('listDealContacts', () => {
  it('returns an empty array when no contacts are linked', async () => {
    const deal = await createDeal({ ...BASE_DEAL, owner_id: ownerId });
    const contacts = await listDealContacts(deal.id);
    expect(contacts).toEqual([]);
  });

  it('returns contacts linked to the deal', async () => {
    const deal = await createDeal({ ...BASE_DEAL, owner_id: ownerId });

    const contactResult = await pool.query<{ id: string }>(
      `INSERT INTO contacts (first_name, last_name, email, owner_id)
       VALUES ('Alice', 'Smith', 'alice-dc@example.com', $1)
       RETURNING id`,
      [ownerId],
    );
    const contactId = contactResult.rows[0].id;

    await pool.query('INSERT INTO deal_contacts (deal_id, contact_id) VALUES ($1, $2)', [
      deal.id,
      contactId,
    ]);

    const contacts = await listDealContacts(deal.id);
    expect(contacts).toHaveLength(1);
    expect(contacts[0].first_name).toBe('Alice');
    expect(contacts[0].last_name).toBe('Smith');
    expect(contacts[0].email).toBe('alice-dc@example.com');
  });
});
