/**
 * Integration tests for accountService.
 *
 * Runs against a real PostgreSQL test database.
 * A single test user is created in beforeAll and reused as owner_id.
 * The accounts table is truncated before each test to ensure isolation.
 *
 * Run: npm test (from /server)
 */

import 'dotenv/config';
import {
  createAccount,
  findAccountById,
  listAccounts,
  updateAccount,
  deleteAccount,
} from '../services/accountService.js';
import { createUser } from '../services/userService.js';
import pool from '../db.js';

/** Minimal user fixture used as account owner */
const OWNER_USER = {
  email: 'account-owner@example.com',
  name: 'Account Owner',
  role: 'rep' as const,
  passwordHash: '$2b$12$placeholder_hash',
  status: 'active' as const,
};

/** Minimal account fixture */
const BASE_ACCOUNT = {
  name: 'Acme Corp',
  industry: 'Technology',
  website: 'https://acme.example.com',
  employee_range: '51-200',
  revenue_range: '10M-50M',
};

let ownerId: string;

beforeAll(async () => {
  await pool.query('DELETE FROM contacts');
  await pool.query('DELETE FROM accounts');
  await pool.query('DELETE FROM users WHERE email = $1', [OWNER_USER.email]);
  const owner = await createUser(OWNER_USER);
  ownerId = owner.id;
});

beforeEach(async () => {
  await pool.query('DELETE FROM contacts');
  await pool.query('DELETE FROM accounts');
});

afterAll(async () => {
  await pool.query('DELETE FROM contacts');
  await pool.query('DELETE FROM accounts');
  await pool.query('DELETE FROM users WHERE email = $1', [OWNER_USER.email]);
  await pool.end();
});

// ── createAccount ───────────────────────────────────────────────────────────────

describe('createAccount', () => {
  it('inserts an account and returns the full row', async () => {
    const account = await createAccount({ ...BASE_ACCOUNT, owner_id: ownerId });

    expect(account.id).toBeDefined();
    expect(account.name).toBe('Acme Corp');
    expect(account.industry).toBe('Technology');
    expect(account.website).toBe('https://acme.example.com');
    expect(account.employee_range).toBe('51-200');
    expect(account.revenue_range).toBe('10M-50M');
    expect(account.owner_id).toBe(ownerId);
    expect(account.created_at).toBeInstanceOf(Date);
  });

  it('stores null for optional fields when omitted', async () => {
    const account = await createAccount({ name: 'Minimal Co', owner_id: ownerId });

    expect(account.industry).toBeNull();
    expect(account.website).toBeNull();
    expect(account.employee_range).toBeNull();
    expect(account.revenue_range).toBeNull();
  });

  it('throws when owner_id does not reference a real user', async () => {
    await expect(
      createAccount({ ...BASE_ACCOUNT, owner_id: '00000000-0000-0000-0000-000000000000' }),
    ).rejects.toThrow();
  });
});

// ── findAccountById ─────────────────────────────────────────────────────────────

describe('findAccountById', () => {
  it('returns the account row when found', async () => {
    const created = await createAccount({ ...BASE_ACCOUNT, owner_id: ownerId });
    const found = await findAccountById(created.id);

    expect(found).not.toBeNull();
    expect(found!.id).toBe(created.id);
    expect(found!.name).toBe('Acme Corp');
  });

  it('returns null for a non-existent UUID', async () => {
    const found = await findAccountById('00000000-0000-0000-0000-000000000000');
    expect(found).toBeNull();
  });
});

// ── listAccounts ────────────────────────────────────────────────────────────────

describe('listAccounts', () => {
  it('returns an empty array when no accounts exist', async () => {
    const accounts = await listAccounts();
    expect(accounts).toEqual([]);
  });

  it('returns all accounts ordered by created_at', async () => {
    await createAccount({ ...BASE_ACCOUNT, name: 'Alpha Corp', owner_id: ownerId });
    await createAccount({ ...BASE_ACCOUNT, name: 'Beta Corp', owner_id: ownerId });

    const accounts = await listAccounts();
    expect(accounts).toHaveLength(2);
    expect(accounts[0].name).toBe('Alpha Corp');
    expect(accounts[1].name).toBe('Beta Corp');
  });

  it('filters by ownerId when provided', async () => {
    const other = await createUser({
      ...OWNER_USER,
      email: 'other-account-owner@example.com',
    });

    await createAccount({ ...BASE_ACCOUNT, name: 'Mine LLC', owner_id: ownerId });
    await createAccount({ ...BASE_ACCOUNT, name: 'Theirs LLC', owner_id: other.id });

    const mine = await listAccounts({ ownerId });
    expect(mine).toHaveLength(1);
    expect(mine[0].name).toBe('Mine LLC');
  });
});

// ── listAccounts — search and industry filters ──────────────────────────────────

describe('listAccounts — search filter', () => {
  it('returns accounts whose name matches the search term (case-insensitive)', async () => {
    await createAccount({ ...BASE_ACCOUNT, name: 'Acme Corp', owner_id: ownerId });
    await createAccount({ ...BASE_ACCOUNT, name: 'Beta Inc', owner_id: ownerId });

    const results = await listAccounts({ search: 'acme' });
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('Acme Corp');
  });

  it('returns empty array when search matches nothing', async () => {
    await createAccount({ ...BASE_ACCOUNT, owner_id: ownerId });
    const results = await listAccounts({ search: 'zzznomatch' });
    expect(results).toHaveLength(0);
  });

  it('combines search with ownerId filter', async () => {
    const other = await createUser({ ...OWNER_USER, email: 'acct-search-other@example.com' });
    await createAccount({ ...BASE_ACCOUNT, name: 'Mine Corp', owner_id: ownerId });
    await createAccount({ ...BASE_ACCOUNT, name: 'Mine Corp', owner_id: other.id });

    const results = await listAccounts({ ownerId, search: 'Mine' });
    expect(results).toHaveLength(1);
    expect(results[0].owner_id).toBe(ownerId);
  });
});

describe('listAccounts — industry filter', () => {
  it('returns only accounts with a matching industry (case-insensitive)', async () => {
    await createAccount({
      ...BASE_ACCOUNT,
      name: 'Tech Co',
      industry: 'Technology',
      owner_id: ownerId,
    });
    await createAccount({
      ...BASE_ACCOUNT,
      name: 'Finance Co',
      industry: 'Finance',
      owner_id: ownerId,
    });

    const results = await listAccounts({ industry: 'technology' });
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('Tech Co');
  });

  it('returns accounts matching a partial industry substring', async () => {
    await createAccount({
      ...BASE_ACCOUNT,
      name: 'Tech Co',
      industry: 'Technology',
      owner_id: ownerId,
    });
    await createAccount({
      ...BASE_ACCOUNT,
      name: 'Finance Co',
      industry: 'Finance',
      owner_id: ownerId,
    });

    const results = await listAccounts({ industry: 'tech' });
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('Tech Co');
  });

  it('returns empty array when industry matches nothing', async () => {
    await createAccount({ ...BASE_ACCOUNT, industry: 'Technology', owner_id: ownerId });
    const results = await listAccounts({ industry: 'zzznomatch' });
    expect(results).toHaveLength(0);
  });

  it('combines industry filter with ownerId filter', async () => {
    const other = await createUser({ ...OWNER_USER, email: 'industry-other@example.com' });
    await createAccount({
      ...BASE_ACCOUNT,
      name: 'Mine Tech',
      industry: 'Technology',
      owner_id: ownerId,
    });
    await createAccount({
      ...BASE_ACCOUNT,
      name: 'Theirs Tech',
      industry: 'Technology',
      owner_id: other.id,
    });

    const results = await listAccounts({ ownerId, industry: 'Technology' });
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('Mine Tech');
  });
});

// ── updateAccount ───────────────────────────────────────────────────────────────

describe('updateAccount', () => {
  it('updates the specified fields and returns the updated row', async () => {
    const account = await createAccount({ ...BASE_ACCOUNT, owner_id: ownerId });

    const updated = await updateAccount(account.id, { name: 'Acme Inc', industry: 'Finance' });

    expect(updated!.name).toBe('Acme Inc');
    expect(updated!.industry).toBe('Finance');
    // Unchanged fields remain intact
    expect(updated!.website).toBe('https://acme.example.com');
    expect(updated!.employee_range).toBe('51-200');
  });

  it('updates updated_at timestamp', async () => {
    const account = await createAccount({ ...BASE_ACCOUNT, owner_id: ownerId });
    const updated = await updateAccount(account.id, { revenue_range: '50M+' });

    expect(updated!.updated_at.getTime()).toBeGreaterThanOrEqual(account.updated_at.getTime());
  });

  it('returns null for a non-existent account', async () => {
    const result = await updateAccount('00000000-0000-0000-0000-000000000000', {
      name: 'Ghost Corp',
    });
    expect(result).toBeNull();
  });
});

// ── deleteAccount ───────────────────────────────────────────────────────────────

describe('deleteAccount', () => {
  it('removes the account and returns the deleted row', async () => {
    const account = await createAccount({ ...BASE_ACCOUNT, owner_id: ownerId });

    const deleted = await deleteAccount(account.id);
    expect(deleted!.id).toBe(account.id);

    const found = await findAccountById(account.id);
    expect(found).toBeNull();
  });

  it('unlinks associated contacts rather than deleting them', async () => {
    const account = await createAccount({ ...BASE_ACCOUNT, owner_id: ownerId });

    // Create a contact linked to this account
    const contactResult = await pool.query(
      `INSERT INTO contacts (first_name, last_name, email, account_id, owner_id)
       VALUES ('Test', 'Contact', 'linked@example.com', $1, $2)
       RETURNING id`,
      [account.id, ownerId],
    );
    const contactId = contactResult.rows[0].id as string;

    await deleteAccount(account.id);

    // Contact should still exist with account_id = NULL
    const contactRow = await pool.query('SELECT * FROM contacts WHERE id = $1', [contactId]);
    expect(contactRow.rows[0]).toBeDefined();
    expect(contactRow.rows[0].account_id).toBeNull();
  });

  it('returns null for a non-existent account', async () => {
    const result = await deleteAccount('00000000-0000-0000-0000-000000000000');
    expect(result).toBeNull();
  });
});
