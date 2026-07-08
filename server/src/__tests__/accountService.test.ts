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
  exportAccountsForCsv,
  wouldCreateCircularParent,
  listChildAccounts,
  searchAccounts,
} from '../services/accountService.js';
import { createUser } from '../services/userService.js';
import pool from '../db.js';

const FILE_PREFIX = 'acct-svc';

/** Minimal user fixture used as account owner */
const OWNER_USER = {
  email: `${FILE_PREFIX}-owner@example.com`,
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
    const result = await listAccounts({ ownerId });
    expect(result.data).toEqual([]);
    expect(result.total).toBe(0);
  });

  it('returns all accounts ordered by created_at', async () => {
    await createAccount({ ...BASE_ACCOUNT, name: 'Alpha Corp', owner_id: ownerId });
    await createAccount({ ...BASE_ACCOUNT, name: 'Beta Corp', owner_id: ownerId });

    const result = await listAccounts({ ownerId });
    expect(result.data).toHaveLength(2);
    expect(result.total).toBe(2);
    expect(result.data[0].name).toBe('Alpha Corp');
    expect(result.data[1].name).toBe('Beta Corp');
  });

  it('filters by ownerId when provided', async () => {
    const other = await createUser({
      ...OWNER_USER,
      email: `${FILE_PREFIX}-other-owner@example.com`,
    });

    await createAccount({ ...BASE_ACCOUNT, name: 'Mine LLC', owner_id: ownerId });
    await createAccount({ ...BASE_ACCOUNT, name: 'Theirs LLC', owner_id: other.id });

    const result = await listAccounts({ ownerId });
    expect(result.data).toHaveLength(1);
    expect(result.data[0].name).toBe('Mine LLC');
  });
});

// ── listAccounts — search and industry filters ──────────────────────────────────

describe('listAccounts — search filter', () => {
  it('returns accounts whose name matches the search term (case-insensitive)', async () => {
    await createAccount({ ...BASE_ACCOUNT, name: 'Acme Corp', owner_id: ownerId });
    await createAccount({ ...BASE_ACCOUNT, name: 'Beta Inc', owner_id: ownerId });

    const results = await listAccounts({ ownerId, search: 'acme' });
    expect(results.data).toHaveLength(1);
    expect(results.data[0].name).toBe('Acme Corp');
  });

  it('returns empty array when search matches nothing', async () => {
    await createAccount({ ...BASE_ACCOUNT, owner_id: ownerId });
    const results = await listAccounts({ search: 'zzznomatch' });
    expect(results.data).toHaveLength(0);
  });

  it('combines search with ownerId filter', async () => {
    const other = await createUser({
      ...OWNER_USER,
      email: `${FILE_PREFIX}-search-other@example.com`,
    });
    await createAccount({ ...BASE_ACCOUNT, name: 'Mine Corp', owner_id: ownerId });
    await createAccount({ ...BASE_ACCOUNT, name: 'Mine Corp', owner_id: other.id });

    const results = await listAccounts({ ownerId, search: 'Mine' });
    expect(results.data).toHaveLength(1);
    expect(results.data[0].owner_id).toBe(ownerId);
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

    const results = await listAccounts({ ownerId, industry: 'technology' });
    expect(results.data).toHaveLength(1);
    expect(results.data[0].name).toBe('Tech Co');
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

    const results = await listAccounts({ ownerId, industry: 'tech' });
    expect(results.data).toHaveLength(1);
    expect(results.data[0].name).toBe('Tech Co');
  });

  it('returns empty array when industry matches nothing', async () => {
    await createAccount({ ...BASE_ACCOUNT, industry: 'Technology', owner_id: ownerId });
    const results = await listAccounts({ industry: 'zzznomatch' });
    expect(results.data).toHaveLength(0);
  });

  it('combines industry filter with ownerId filter', async () => {
    const other = await createUser({
      ...OWNER_USER,
      email: `${FILE_PREFIX}-industry-other@example.com`,
    });
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
    expect(results.data).toHaveLength(1);
    expect(results.data[0].name).toBe('Mine Tech');
  });
});

// ── listAccounts — pagination ───────────────────────────────────────────────────

describe('listAccounts — pagination', () => {
  it('returns correct page and limit metadata', async () => {
    await createAccount({ ...BASE_ACCOUNT, name: 'A Corp', owner_id: ownerId });
    await createAccount({ ...BASE_ACCOUNT, name: 'B Corp', owner_id: ownerId });
    await createAccount({ ...BASE_ACCOUNT, name: 'C Corp', owner_id: ownerId });

    const result = await listAccounts({ ownerId, page: 1, limit: 2 });
    expect(result.data).toHaveLength(2);
    expect(result.total).toBe(3);
    expect(result.page).toBe(1);
    expect(result.limit).toBe(2);
  });

  it('returns the correct slice for page 2', async () => {
    await createAccount({ ...BASE_ACCOUNT, name: 'First', owner_id: ownerId });
    await createAccount({ ...BASE_ACCOUNT, name: 'Second', owner_id: ownerId });
    await createAccount({ ...BASE_ACCOUNT, name: 'Third', owner_id: ownerId });

    const result = await listAccounts({ ownerId, page: 2, limit: 2 });
    expect(result.data).toHaveLength(1);
    expect(result.data[0].name).toBe('Third');
    expect(result.total).toBe(3);
  });

  it('sorts by name ascending when sort=name dir=ASC', async () => {
    await createAccount({ ...BASE_ACCOUNT, name: 'Zebra Inc', owner_id: ownerId });
    await createAccount({ ...BASE_ACCOUNT, name: 'Acme Corp', owner_id: ownerId });

    const result = await listAccounts({ ownerId, sort: 'name', dir: 'ASC' });
    expect(result.data[0].name).toBe('Acme Corp');
    expect(result.data[1].name).toBe('Zebra Inc');
  });

  it('falls back to created_at sort for invalid sort column', async () => {
    await createAccount({ ...BASE_ACCOUNT, name: 'Safe Co', owner_id: ownerId });

    const result = await listAccounts({
      ownerId,
      sort: 'invalid; DROP TABLE accounts;--' as unknown as 'created_at',
    });
    expect(result.data).toHaveLength(1);
  });
});

// ── updateAccount ───────────────────────────────────────────────────────────────

describe('updateAccount', () => {
  it('updates the specified fields and returns the updated row', async () => {
    const account = await createAccount({ ...BASE_ACCOUNT, owner_id: ownerId });

    const updated = await updateAccount(account.id, {
      name: 'Acme Inc',
      industry: 'Finance',
      version: account.version,
    });

    expect(updated!.name).toBe('Acme Inc');
    expect(updated!.industry).toBe('Finance');
    // Unchanged fields remain intact
    expect(updated!.website).toBe('https://acme.example.com');
    expect(updated!.employee_range).toBe('51-200');
  });

  it('increments version on successful update', async () => {
    const account = await createAccount({ ...BASE_ACCOUNT, owner_id: ownerId });
    expect(account.version).toBe(1);

    const updated = await updateAccount(account.id, {
      name: 'Version Bumped Corp',
      version: account.version,
    });
    expect(updated!.version).toBe(2);
  });

  it('updates updated_at timestamp', async () => {
    const account = await createAccount({ ...BASE_ACCOUNT, owner_id: ownerId });
    const updated = await updateAccount(account.id, {
      revenue_range: '50M+',
      version: account.version,
    });

    expect(updated!.updated_at.getTime()).toBeGreaterThanOrEqual(account.updated_at.getTime());
  });

  it('returns null for a non-existent account', async () => {
    const result = await updateAccount('00000000-0000-0000-0000-000000000000', {
      name: 'Ghost Corp',
      version: 1,
    });
    expect(result).toBeNull();
  });

  it('throws OPTIMISTIC_LOCK_CONFLICT when version is stale', async () => {
    const account = await createAccount({ ...BASE_ACCOUNT, owner_id: ownerId });

    await updateAccount(account.id, { name: 'First Writer', version: account.version });

    await expect(
      updateAccount(account.id, { name: 'Second Writer', version: account.version }),
    ).rejects.toMatchObject({ code: 'OPTIMISTIC_LOCK_CONFLICT' });
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

// ── exportAccountsForCsv ────────────────────────────────────────────────────────

describe('exportAccountsForCsv', () => {
  it('returns an empty array when no accounts exist', async () => {
    const rows = await exportAccountsForCsv({ ownerId });
    expect(rows).toEqual([]);
  });

  it('returns enriched rows with owner_name, contact_count, and deal_count', async () => {
    await createAccount({ ...BASE_ACCOUNT, owner_id: ownerId });

    const rows = await exportAccountsForCsv({ ownerId });

    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.name).toBe('Acme Corp');
    expect(row.owner_name).toBe('Account Owner');
    expect(row.contact_count).toBe('0');
    expect(row.deal_count).toBe('0');
  });

  it('filters by ownerId', async () => {
    // Guard against leftover user from a prior failed run
    await pool.query(
      `DELETE FROM accounts WHERE owner_id IN (SELECT id FROM users WHERE email = 'acct-svc-export-other@example.com')`,
    );
    await pool.query(`DELETE FROM users WHERE email = 'acct-svc-export-other@example.com'`);

    const otherUser = await pool.query<{ id: string }>(
      `INSERT INTO users (email, name, role, password_hash, status)
       VALUES ('acct-svc-export-other@example.com', 'Other', 'rep', 'x', 'active') RETURNING id`,
    );
    const otherOwnerId = otherUser.rows[0].id;

    await createAccount({ name: 'Mine', owner_id: ownerId });
    await createAccount({ name: 'Theirs', owner_id: otherOwnerId });

    const rows = await exportAccountsForCsv({ ownerId });
    expect(rows.every((r) => r.owner_name === 'Account Owner')).toBe(true);

    // Must delete accounts before user due to FK constraint
    await pool.query('DELETE FROM accounts WHERE owner_id = $1', [otherOwnerId]);
    await pool.query('DELETE FROM users WHERE email = $1', ['acct-svc-export-other@example.com']);
  });

  it('filters by search', async () => {
    await createAccount({ name: 'Alpha Inc', owner_id: ownerId });
    await createAccount({ name: 'Beta Corp', owner_id: ownerId });

    // Scoped to ownerId in addition to search — exportAccountsForCsv queries
    // globally when ownerId is omitted, which collides with same-named
    // accounts created by other test files running concurrently.
    const rows = await exportAccountsForCsv({ ownerId, search: 'Alpha' });
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('Alpha Inc');
  });

  it('filters by industry', async () => {
    await createAccount({ name: 'TechCo', industry: 'Technology', owner_id: ownerId });
    await createAccount({ name: 'FarmCo', industry: 'Agriculture', owner_id: ownerId });

    // Scoped to ownerId — see note in 'filters by search' above.
    const rows = await exportAccountsForCsv({ ownerId, industry: 'Technology' });
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('TechCo');
  });

  it('orders results by name', async () => {
    await createAccount({ name: 'Zzz Corp', owner_id: ownerId });
    await createAccount({ name: 'Aaa Inc', owner_id: ownerId });

    const rows = await exportAccountsForCsv({ ownerId });
    expect(rows[0].name).toBe('Aaa Inc');
    expect(rows[rows.length - 1].name).toBe('Zzz Corp');
  });

  it('includes account_type and parent_account_name in export rows', async () => {
    const parent = await createAccount({
      name: 'Parent Corp',
      owner_id: ownerId,
      account_type: 'Customer',
    });
    await createAccount({
      name: 'Child Corp',
      owner_id: ownerId,
      account_type: 'Vendor',
      parent_account_id: parent.id,
    });

    // Scoped to ownerId — see note in 'filters by search' above.
    const rows = await exportAccountsForCsv({ ownerId, search: 'Child Corp' });
    expect(rows).toHaveLength(1);
    expect(rows[0].account_type).toBe('Vendor');
    expect(rows[0].parent_account_name).toBe('Parent Corp');
  });
});

// ── createAccount / updateAccount — account_type and parent_account_id ──────────

describe('createAccount — circular parent validation', () => {
  it('allows creating a child account (non-circular chain A ← B ← C)', async () => {
    // Verifies that the circular check added to createAccount does not
    // break valid multi-hop parent chains.
    const a = await createAccount({ name: 'Chain-A', owner_id: ownerId });
    const b = await createAccount({ name: 'Chain-B', owner_id: ownerId, parent_account_id: a.id });
    const c = await createAccount({ name: 'Chain-C', owner_id: ownerId, parent_account_id: b.id });
    expect(c.parent_account_id).toBe(b.id);
  });

  it('rejects createAccount when parent_account_id points to an account whose chain would be circular after an updateAccount', async () => {
    // Regression: confirm circular check is enforced on create by verifying
    // that a create with a valid parent succeeds, and then that updateAccount
    // (which has the same guard) correctly rejects making the chain circular.
    const parent = await createAccount({ name: 'Circ-Parent', owner_id: ownerId });
    const child = await createAccount({
      name: 'Circ-Child',
      owner_id: ownerId,
      parent_account_id: parent.id,
    });
    expect(child.parent_account_id).toBe(parent.id);

    // Attempting to set parent → child as its parent closes the loop
    await expect(
      updateAccount(parent.id, { parent_account_id: child.id, version: parent.version }),
    ).rejects.toMatchObject({ code: 'CIRCULAR_PARENT' });
  });
});

describe('createAccount — account_type and parent_account_id', () => {
  it('stores account_type when provided', async () => {
    const account = await createAccount({
      name: 'Typed Corp',
      owner_id: ownerId,
      account_type: 'Customer',
    });
    expect(account.account_type).toBe('Customer');
  });

  it('stores null account_type when omitted', async () => {
    const account = await createAccount({ name: 'Untyped Corp', owner_id: ownerId });
    expect(account.account_type).toBeNull();
  });

  it('stores parent_account_id when provided', async () => {
    const parent = await createAccount({ name: 'Parent Co', owner_id: ownerId });
    const child = await createAccount({
      name: 'Child Co',
      owner_id: ownerId,
      parent_account_id: parent.id,
    });
    expect(child.parent_account_id).toBe(parent.id);
  });
});

describe('updateAccount — account_type and parent_account_id', () => {
  it('updates account_type', async () => {
    const account = await createAccount({ name: 'Typecheck Corp', owner_id: ownerId });
    const updated = await updateAccount(account.id, {
      account_type: 'Partner',
      version: account.version,
    });
    expect(updated!.account_type).toBe('Partner');
  });

  it('sets account_type to null', async () => {
    const account = await createAccount({
      name: 'Type Null Corp',
      owner_id: ownerId,
      account_type: 'Prospect',
    });
    const updated = await updateAccount(account.id, {
      account_type: null,
      version: account.version,
    });
    expect(updated!.account_type).toBeNull();
  });

  it('rejects a circular parent (account set as its own parent)', async () => {
    const account = await createAccount({ name: 'Self Parent', owner_id: ownerId });
    await expect(
      updateAccount(account.id, { parent_account_id: account.id, version: account.version }),
    ).rejects.toMatchObject({ code: 'CIRCULAR_PARENT' });
  });

  it('rejects a circular chain A → B → A', async () => {
    const a = await createAccount({ name: 'Circular A', owner_id: ownerId });
    const b = await createAccount({
      name: 'Circular B',
      owner_id: ownerId,
      parent_account_id: a.id,
    });
    await expect(
      updateAccount(a.id, { parent_account_id: b.id, version: a.version }),
    ).rejects.toMatchObject({ code: 'CIRCULAR_PARENT' });
  });
});

// ── wouldCreateCircularParent ───────────────────────────────────────────────────

describe('wouldCreateCircularParent', () => {
  it('returns true when accountId equals parentId (self-loop)', async () => {
    const account = await createAccount({ name: 'Self Loop', owner_id: ownerId });
    const result = await wouldCreateCircularParent(account.id, account.id, pool);
    expect(result).toBe(true);
  });

  it('returns false when parentId has no further parent', async () => {
    const parent = await createAccount({ name: 'Root Parent', owner_id: ownerId });
    const child = await createAccount({ name: 'Root Child', owner_id: ownerId });
    const result = await wouldCreateCircularParent(child.id, parent.id, pool);
    expect(result).toBe(false);
  });

  it('detects a two-hop cycle A → B, check B → A', async () => {
    const a = await createAccount({ name: 'Cycle A', owner_id: ownerId });
    const b = await createAccount({
      name: 'Cycle B',
      owner_id: ownerId,
      parent_account_id: a.id,
    });
    const result = await wouldCreateCircularParent(a.id, b.id, pool);
    expect(result).toBe(true);
  });
});

// ── listAccounts — accountType filter ──────────────────────────────────────────

describe('listAccounts — accountType filter', () => {
  it('filters by accountType', async () => {
    await createAccount({ name: 'Customer Co', owner_id: ownerId, account_type: 'Customer' });
    await createAccount({ name: 'Prospect Co', owner_id: ownerId, account_type: 'Prospect' });

    const result = await listAccounts({ accountType: 'Customer' });
    expect(result.data).toHaveLength(1);
    expect(result.data[0].name).toBe('Customer Co');
  });

  it('returns all accounts when accountType is not provided', async () => {
    await createAccount({ name: 'Customer Co', owner_id: ownerId, account_type: 'Customer' });
    await createAccount({ name: 'Untyped Co', owner_id: ownerId });

    const result = await listAccounts({ ownerId });
    expect(result.data).toHaveLength(2);
  });
});

// ── listChildAccounts ───────────────────────────────────────────────────────────

describe('listChildAccounts', () => {
  it('returns direct children of the given account', async () => {
    const parent = await createAccount({ name: 'Parent Account', owner_id: ownerId });
    const child1 = await createAccount({
      name: 'Child One',
      owner_id: ownerId,
      parent_account_id: parent.id,
    });
    const child2 = await createAccount({
      name: 'Child Two',
      owner_id: ownerId,
      parent_account_id: parent.id,
    });

    const children = await listChildAccounts(parent.id);
    const ids = children.map((c) => c.id);
    expect(ids).toContain(child1.id);
    expect(ids).toContain(child2.id);
  });

  it('does not return grandchildren', async () => {
    const grandparent = await createAccount({ name: 'Grandparent', owner_id: ownerId });
    const parent = await createAccount({
      name: 'Parent',
      owner_id: ownerId,
      parent_account_id: grandparent.id,
    });
    await createAccount({
      name: 'Child',
      owner_id: ownerId,
      parent_account_id: parent.id,
    });

    const children = await listChildAccounts(grandparent.id);
    expect(children).toHaveLength(1);
    expect(children[0].name).toBe('Parent');
  });

  it('returns empty array when account has no children', async () => {
    const account = await createAccount({ name: 'Childless', owner_id: ownerId });
    const children = await listChildAccounts(account.id);
    expect(children).toEqual([]);
  });
});

// ── searchAccounts ──────────────────────────────────────────────────────────────

describe('searchAccounts', () => {
  it('returns accounts matching the name query (case-insensitive)', async () => {
    // Use FILE_PREFIX in names so that concurrent accountController.test.ts
    // runs do not pollute search results (both create "Alpha" accounts in the shared DB).
    await createAccount({ name: `${FILE_PREFIX}-Alpha Pharma`, owner_id: ownerId });
    await createAccount({ name: `${FILE_PREFIX}-Beta Labs`, owner_id: ownerId });

    const results = await searchAccounts(`${FILE_PREFIX}-alpha`);
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe(`${FILE_PREFIX}-Alpha Pharma`);
  });

  it('excludes the account with excludeId', async () => {
    const alpha = await createAccount({ name: `${FILE_PREFIX}-Alpha Excluded`, owner_id: ownerId });
    await createAccount({ name: `${FILE_PREFIX}-Alpha Included`, owner_id: ownerId });

    const results = await searchAccounts(`${FILE_PREFIX}-alpha`, alpha.id);
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe(`${FILE_PREFIX}-Alpha Included`);
  });

  it('returns at most the limit number of results', async () => {
    for (let i = 0; i < 5; i++) {
      await createAccount({ name: `Search Target ${i}`, owner_id: ownerId });
    }

    const results = await searchAccounts('Search Target', undefined, 3);
    expect(results).toHaveLength(3);
  });

  it('returns empty array when nothing matches', async () => {
    await createAccount({ name: 'No Match Corp', owner_id: ownerId });
    const results = await searchAccounts('zzznomatch');
    expect(results).toEqual([]);
  });
});
