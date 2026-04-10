/**
 * Integration tests for searchService.
 *
 * Runs against a real PostgreSQL test database.
 * Creates isolated test users, contacts, accounts, and deals before each test.
 *
 * Run: npm test (from /server)
 */

import 'dotenv/config';
import { globalSearch, SEARCH_MIN_LENGTH } from '../services/searchService.js';
import { createContact } from '../services/contactService.js';
import { createAccount } from '../services/accountService.js';
import { createDeal } from '../services/dealService.js';
import { createUser } from '../services/userService.js';
import pool from '../db.js';

/** Minimal user fixture */
const ADMIN_USER = {
  email: 'search-admin@example.com',
  name: 'Search Admin',
  role: 'admin' as const,
  passwordHash: '$2b$12$placeholder_hash',
  status: 'active' as const,
};

const REP_USER = {
  email: 'search-rep@example.com',
  name: 'Search Rep',
  role: 'rep' as const,
  passwordHash: '$2b$12$placeholder_hash',
  status: 'active' as const,
};

let adminId: string;
let repId: string;
let accountId: string;

beforeAll(async () => {
  await pool.query('DELETE FROM deal_contacts');
  await pool.query('DELETE FROM activities');
  await pool.query('DELETE FROM deals');
  await pool.query('DELETE FROM contacts');
  await pool.query('DELETE FROM accounts');
  await pool.query("DELETE FROM users WHERE email LIKE 'search-%'");

  const admin = await createUser(ADMIN_USER);
  adminId = admin.id;
  const rep = await createUser(REP_USER);
  repId = rep.id;

  const account = await createAccount({ name: 'Search Test Account', owner_id: adminId });
  accountId = account.id;
});

beforeEach(async () => {
  await pool.query('DELETE FROM deal_contacts');
  await pool.query('DELETE FROM deals');
  await pool.query('DELETE FROM contacts');
  await pool.query("DELETE FROM accounts WHERE name <> 'Search Test Account'");
});

afterAll(async () => {
  await pool.query('DELETE FROM deal_contacts');
  await pool.query('DELETE FROM deals');
  await pool.query('DELETE FROM contacts');
  await pool.query('DELETE FROM accounts');
  await pool.query("DELETE FROM users WHERE email LIKE 'search-%'");
  await pool.end();
});

describe('SEARCH_MIN_LENGTH', () => {
  it('is 2', () => {
    expect(SEARCH_MIN_LENGTH).toBe(2);
  });
});

describe('globalSearch — contacts', () => {
  it('returns a contact matching by first_name', async () => {
    await createContact({
      first_name: 'Zara',
      last_name: 'Findme',
      email: 'zara@example.com',
      owner_id: adminId,
    });

    const results = await globalSearch('Zara', { userId: adminId, role: 'admin' });
    expect(results.contacts).toHaveLength(1);
    expect(results.contacts[0].first_name).toBe('Zara');
  });

  it('returns a contact matching by last_name', async () => {
    await createContact({
      first_name: 'Test',
      last_name: 'Finnable',
      email: 'finnable@example.com',
      owner_id: adminId,
    });

    const results = await globalSearch('Finnable', { userId: adminId, role: 'admin' });
    expect(results.contacts).toHaveLength(1);
    expect(results.contacts[0].last_name).toBe('Finnable');
  });

  it('returns a contact matching by email', async () => {
    await createContact({
      first_name: 'Email',
      last_name: 'Match',
      email: 'uniqueemail123@example.com',
      owner_id: adminId,
    });

    const results = await globalSearch('uniqueemail123', { userId: adminId, role: 'admin' });
    expect(results.contacts).toHaveLength(1);
    expect(results.contacts[0].email).toBe('uniqueemail123@example.com');
  });

  it('is case-insensitive', async () => {
    await createContact({
      first_name: 'CaseSensitive',
      last_name: 'Test',
      email: 'casesensitive@example.com',
      owner_id: adminId,
    });

    const upper = await globalSearch('CASESENSITIVE', { userId: adminId, role: 'admin' });
    const lower = await globalSearch('casesensitive', { userId: adminId, role: 'admin' });
    expect(upper.contacts).toHaveLength(1);
    expect(lower.contacts).toHaveLength(1);
  });

  it('supports partial-word matching', async () => {
    await createContact({
      first_name: 'PartialMatch',
      last_name: 'Test',
      email: 'partial@example.com',
      owner_id: adminId,
    });

    const results = await globalSearch('artial', { userId: adminId, role: 'admin' });
    expect(results.contacts).toHaveLength(1);
  });

  it('returns empty array when no contact matches', async () => {
    const results = await globalSearch('zzznomatch999', { userId: adminId, role: 'admin' });
    expect(results.contacts).toHaveLength(0);
  });

  it('does not return contacts owned by others when role is rep', async () => {
    await createContact({
      first_name: 'OtherOwner',
      last_name: 'Contact',
      email: 'otherowner@example.com',
      owner_id: adminId,
    });

    const results = await globalSearch('OtherOwner', { userId: repId, role: 'rep' });
    expect(results.contacts).toHaveLength(0);
  });

  it('returns own contacts when role is rep', async () => {
    await createContact({
      first_name: 'RepOwned',
      last_name: 'Contact',
      email: 'repowned@example.com',
      owner_id: repId,
    });

    const results = await globalSearch('RepOwned', { userId: repId, role: 'rep' });
    expect(results.contacts).toHaveLength(1);
  });

  it('admin sees all contacts regardless of owner', async () => {
    await createContact({
      first_name: 'AdminVisible',
      last_name: 'One',
      email: 'adminvisible1@example.com',
      owner_id: repId,
    });
    await createContact({
      first_name: 'AdminVisible',
      last_name: 'Two',
      email: 'adminvisible2@example.com',
      owner_id: adminId,
    });

    const results = await globalSearch('AdminVisible', { userId: adminId, role: 'admin' });
    expect(results.contacts).toHaveLength(2);
  });
});

describe('globalSearch — accounts', () => {
  it('returns an account matching by name', async () => {
    await createAccount({ name: 'Unique Account Findme', owner_id: adminId });

    const results = await globalSearch('Findme', { userId: adminId, role: 'admin' });
    expect(results.accounts.some((a) => a.name === 'Unique Account Findme')).toBe(true);
  });

  it('supports partial matching on account name', async () => {
    await createAccount({ name: 'Acme Corporation', owner_id: adminId });

    const results = await globalSearch('Acm', { userId: adminId, role: 'admin' });
    expect(results.accounts.some((a) => a.name === 'Acme Corporation')).toBe(true);
  });

  it('does not return accounts owned by others when role is rep', async () => {
    await createAccount({ name: 'RepHidden Account', owner_id: adminId });

    const results = await globalSearch('RepHidden', { userId: repId, role: 'rep' });
    expect(results.accounts).toHaveLength(0);
  });
});

describe('globalSearch — deals', () => {
  it('returns a deal matching by name', async () => {
    await createDeal({
      name: 'Unique Deal Findme',
      stage: 'Prospecting',
      account_id: accountId,
      owner_id: adminId,
    });

    const results = await globalSearch('Findme', { userId: adminId, role: 'admin' });
    expect(results.deals.some((d) => d.name === 'Unique Deal Findme')).toBe(true);
  });

  it('does not return deals owned by others when role is rep', async () => {
    await createDeal({
      name: 'RepHidden Deal',
      stage: 'Prospecting',
      account_id: accountId,
      owner_id: adminId,
    });

    const results = await globalSearch('RepHidden', { userId: repId, role: 'rep' });
    expect(results.deals).toHaveLength(0);
  });
});

describe('globalSearch — multi-entity', () => {
  it('returns results across all three entity types in a single call', async () => {
    const suffix = 'MultiEntity';
    await createContact({
      first_name: suffix,
      last_name: 'Contact',
      email: `multientity@example.com`,
      owner_id: adminId,
    });
    await createAccount({ name: `${suffix} Account`, owner_id: adminId });
    await createDeal({
      name: `${suffix} Deal`,
      stage: 'Prospecting',
      account_id: accountId,
      owner_id: adminId,
    });

    const results = await globalSearch(suffix, { userId: adminId, role: 'admin' });
    expect(results.contacts.length).toBeGreaterThanOrEqual(1);
    expect(results.accounts.length).toBeGreaterThanOrEqual(1);
    expect(results.deals.length).toBeGreaterThanOrEqual(1);
  });
});

describe('globalSearch — special characters', () => {
  it("handles apostrophes in names without error (e.g., O'Brien)", async () => {
    await createContact({
      first_name: "O'Brien",
      last_name: 'Test',
      email: 'obrien@example.com',
      owner_id: adminId,
    });

    const results = await globalSearch("O'Brien", { userId: adminId, role: 'admin' });
    expect(results.contacts).toHaveLength(1);
  });

  it('handles ampersands in account names without error', async () => {
    await createAccount({ name: 'Smith & Co', owner_id: adminId });

    const results = await globalSearch('Smith & Co', { userId: adminId, role: 'admin' });
    expect(results.accounts.some((a) => a.name === 'Smith & Co')).toBe(true);
  });

  it('handles a very long query without error', async () => {
    const longQuery = 'a'.repeat(500);
    await expect(
      globalSearch(longQuery, { userId: adminId, role: 'admin' }),
    ).resolves.toBeDefined();
  });

  it('treats % as a literal character, not a wildcard', async () => {
    await createContact({
      first_name: 'Percent',
      last_name: 'Test',
      email: 'percent@example.com',
      owner_id: adminId,
    });

    // Searching for '%' should not match 'Percent' — it must be escaped
    const results = await globalSearch('%', { userId: adminId, role: 'admin' });
    expect(results.contacts.some((c) => c.first_name === 'Percent')).toBe(false);
  });

  it('treats _ as a literal character, not a single-character wildcard', async () => {
    await createContact({
      first_name: 'Underscore',
      last_name: 'Test',
      email: 'underscore@example.com',
      owner_id: adminId,
    });
    await createContact({
      first_name: 'AB',
      last_name: 'Test',
      email: 'ab@example.com',
      owner_id: adminId,
    });

    // Searching '_B' should not match 'AB' (single-char wildcard) when properly escaped
    const results = await globalSearch('_B', { userId: adminId, role: 'admin' });
    expect(results.contacts.some((c) => c.first_name === 'AB')).toBe(false);
  });
});
