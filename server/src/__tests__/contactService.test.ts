/**
 * Integration tests for contactService.
 *
 * Runs against a real PostgreSQL test database.
 * A single test user is created in beforeAll and reused as owner_id.
 * The contacts table is truncated before each test to ensure isolation.
 *
 * Run: npm test (from /server)
 */

import 'dotenv/config';
import {
  createContact,
  findContactByEmail,
  findContactById,
  listContacts,
  updateContact,
  deleteContact,
} from '../services/contactService.js';
import { createAccount } from '../services/accountService.js';
import { createUser } from '../services/userService.js';
import pool from '../db.js';

/** Minimal user fixture used as contact owner */
const OWNER_USER = {
  email: 'owner@example.com',
  name: 'Owner User',
  role: 'rep' as const,
  passwordHash: '$2b$12$placeholder_hash',
  status: 'active' as const,
};

/** Minimal contact fixture */
const BASE_CONTACT = {
  first_name: 'Alice',
  last_name: 'Smith',
  email: 'alice@example.com',
  phone: '+1-555-0100',
  title: 'VP Sales',
  department: 'Sales',
};

let ownerId: string;

let accountId: string;

beforeAll(async () => {
  await pool.query(
    'DELETE FROM deal_contacts WHERE deal_id IN (SELECT id FROM deals WHERE owner_id IN (SELECT id FROM users WHERE email = $1))',
    [OWNER_USER.email],
  );
  await pool.query(
    'DELETE FROM activities WHERE owner_id IN (SELECT id FROM users WHERE email = $1)',
    [OWNER_USER.email],
  );
  await pool.query('DELETE FROM deals WHERE owner_id IN (SELECT id FROM users WHERE email = $1)', [
    OWNER_USER.email,
  ]);
  await pool.query(
    'DELETE FROM contacts WHERE owner_id IN (SELECT id FROM users WHERE email = $1)',
    [OWNER_USER.email],
  );
  await pool.query(
    'DELETE FROM accounts WHERE owner_id IN (SELECT id FROM users WHERE email = $1)',
    [OWNER_USER.email],
  );
  await pool.query('DELETE FROM users WHERE email = $1', [OWNER_USER.email]);
  const owner = await createUser(OWNER_USER);
  ownerId = owner.id;
  const account = await createAccount({ name: 'Test Account', owner_id: ownerId });
  accountId = account.id;
});

beforeEach(async () => {
  await pool.query('DELETE FROM contacts');
});

afterAll(async () => {
  await pool.query(
    'DELETE FROM contacts WHERE owner_id IN (SELECT id FROM users WHERE email = $1)',
    [OWNER_USER.email],
  );
  await pool.query(
    'DELETE FROM accounts WHERE owner_id IN (SELECT id FROM users WHERE email = $1)',
    [OWNER_USER.email],
  );
  await pool.query('DELETE FROM users WHERE email = $1', [OWNER_USER.email]);
});

// ── createContact ───────────────────────────────────────────────────────────────

describe('createContact', () => {
  it('inserts a contact and returns the full row', async () => {
    const contact = await createContact({ ...BASE_CONTACT, owner_id: ownerId });

    expect(contact.id).toBeDefined();
    expect(contact.first_name).toBe('Alice');
    expect(contact.last_name).toBe('Smith');
    expect(contact.email).toBe('alice@example.com');
    expect(contact.phone).toBe('+1-555-0100');
    expect(contact.title).toBe('VP Sales');
    expect(contact.department).toBe('Sales');
    expect(contact.owner_id).toBe(ownerId);
    expect(contact.created_at).toBeInstanceOf(Date);
  });

  it('normalizes email to lowercase', async () => {
    const contact = await createContact({
      ...BASE_CONTACT,
      email: 'UPPER@EXAMPLE.COM',
      owner_id: ownerId,
    });
    expect(contact.email).toBe('upper@example.com');
  });

  it('stores null for optional fields when omitted', async () => {
    const contact = await createContact({
      first_name: 'Bob',
      last_name: 'Jones',
      email: 'bob@example.com',
      owner_id: ownerId,
    });

    expect(contact.phone).toBeNull();
    expect(contact.title).toBeNull();
    expect(contact.department).toBeNull();
    expect(contact.account_id).toBeNull();
  });

  it('stores account_id when provided', async () => {
    const contact = await createContact({
      ...BASE_CONTACT,
      email: 'linked@example.com',
      account_id: accountId,
      owner_id: ownerId,
    });
    expect(contact.account_id).toBe(accountId);
  });

  it('throws when owner_id does not reference a real user', async () => {
    await expect(
      createContact({ ...BASE_CONTACT, owner_id: '00000000-0000-0000-0000-000000000000' }),
    ).rejects.toThrow();
  });
});

// ── DB constraints ─────────────────────────────────────────────────────────────

describe('DB constraints — contacts', () => {
  it('rejects a contact with a null first_name (NOT NULL)', async () => {
    await expect(
      pool.query(
        `INSERT INTO contacts (first_name, last_name, email, owner_id)
         VALUES (NULL, 'Smith', 'null-fn@example.com', $1)`,
        [ownerId],
      ),
    ).rejects.toThrow();
  });

  it('rejects a contact with a null last_name (NOT NULL)', async () => {
    await expect(
      pool.query(
        `INSERT INTO contacts (first_name, last_name, email, owner_id)
         VALUES ('Alice', NULL, 'null-ln@example.com', $1)`,
        [ownerId],
      ),
    ).rejects.toThrow();
  });

  it('rejects a contact whose account_id references a non-existent account (FK)', async () => {
    await expect(
      createContact({
        ...BASE_CONTACT,
        email: 'bad-fk@example.com',
        account_id: '00000000-0000-0000-0000-000000000000',
        owner_id: ownerId,
      }),
    ).rejects.toThrow();
  });
});

// ── findContactByEmail ───────────────────────────────────────────────────────────

describe('findContactByEmail', () => {
  it('returns the contact row when the email matches (case-insensitive)', async () => {
    const created = await createContact({ ...BASE_CONTACT, owner_id: ownerId });
    const found = await findContactByEmail('ALICE@EXAMPLE.COM');

    expect(found).not.toBeNull();
    expect(found!.id).toBe(created.id);
  });

  it('returns null when no contact matches the email', async () => {
    await createContact({ ...BASE_CONTACT, owner_id: ownerId });
    const found = await findContactByEmail('nobody@example.com');

    expect(found).toBeNull();
  });

  it('excludes the contact with the given excludeId', async () => {
    const contact = await createContact({ ...BASE_CONTACT, owner_id: ownerId });
    const found = await findContactByEmail(BASE_CONTACT.email, contact.id);

    expect(found).toBeNull();
  });

  it('returns the contact when a different contact shares the email and excludeId does not match', async () => {
    const first = await createContact({
      ...BASE_CONTACT,
      email: 'shared@example.com',
      owner_id: ownerId,
    });
    const second = await createContact({
      ...BASE_CONTACT,
      first_name: 'Bob',
      email: 'other@example.com',
      owner_id: ownerId,
    });
    const found = await findContactByEmail('shared@example.com', second.id);

    expect(found).not.toBeNull();
    expect(found!.id).toBe(first.id);
  });
});

// ── findContactById ─────────────────────────────────────────────────────────────

describe('findContactById', () => {
  it('returns the contact row when found', async () => {
    const created = await createContact({ ...BASE_CONTACT, owner_id: ownerId });
    const found = await findContactById(created.id);

    expect(found).not.toBeNull();
    expect(found!.id).toBe(created.id);
    expect(found!.first_name).toBe('Alice');
  });

  it('returns null for a non-existent UUID', async () => {
    const found = await findContactById('00000000-0000-0000-0000-000000000000');
    expect(found).toBeNull();
  });
});

// ── listContacts ────────────────────────────────────────────────────────────────

describe('listContacts', () => {
  it('returns an empty array when no contacts exist', async () => {
    const result = await listContacts();
    expect(result.data).toEqual([]);
    expect(result.total).toBe(0);
  });

  it('returns all contacts ordered by created_at', async () => {
    await createContact({ ...BASE_CONTACT, email: 'a@example.com', owner_id: ownerId });
    await createContact({ ...BASE_CONTACT, email: 'b@example.com', owner_id: ownerId });

    const result = await listContacts();
    expect(result.data).toHaveLength(2);
    expect(result.total).toBe(2);
    expect(result.data[0].email).toBe('a@example.com');
    expect(result.data[1].email).toBe('b@example.com');
  });

  it('filters by ownerId when provided', async () => {
    // Create a second owner
    const other = await createUser({
      ...OWNER_USER,
      email: 'other@example.com',
    });

    await createContact({ ...BASE_CONTACT, email: 'mine@example.com', owner_id: ownerId });
    await createContact({ ...BASE_CONTACT, email: 'theirs@example.com', owner_id: other.id });

    const result = await listContacts({ ownerId });
    expect(result.data).toHaveLength(1);
    expect(result.data[0].email).toBe('mine@example.com');
  });

  it('filters by accountId when provided', async () => {
    await createContact({
      ...BASE_CONTACT,
      email: 'linked@example.com',
      account_id: accountId,
      owner_id: ownerId,
    });
    await createContact({ ...BASE_CONTACT, email: 'unlinked@example.com', owner_id: ownerId });

    const result = await listContacts({ accountId });
    expect(result.data).toHaveLength(1);
    expect(result.data[0].email).toBe('linked@example.com');
  });
});

// ── listContacts — search filters ───────────────────────────────────────────────

describe('listContacts — search filter', () => {
  it('returns contacts whose first_name matches the search term (case-insensitive)', async () => {
    await createContact({
      ...BASE_CONTACT,
      first_name: 'Alice',
      email: 'a@example.com',
      owner_id: ownerId,
    });
    await createContact({
      ...BASE_CONTACT,
      first_name: 'Bob',
      email: 'b@example.com',
      owner_id: ownerId,
    });

    const results = await listContacts({ search: 'ali' });
    expect(results.data).toHaveLength(1);
    expect(results.data[0].first_name).toBe('Alice');
  });

  it('returns contacts whose last_name matches the search term (case-insensitive)', async () => {
    await createContact({
      ...BASE_CONTACT,
      last_name: 'Smith',
      email: 'smith@example.com',
      owner_id: ownerId,
    });
    await createContact({
      ...BASE_CONTACT,
      last_name: 'Jones',
      email: 'jones@example.com',
      owner_id: ownerId,
    });

    const results = await listContacts({ search: 'SMITH' });
    expect(results.data).toHaveLength(1);
    expect(results.data[0].last_name).toBe('Smith');
  });

  it('returns contacts whose email matches the search term', async () => {
    await createContact({ ...BASE_CONTACT, email: 'find.me@example.com', owner_id: ownerId });
    await createContact({ ...BASE_CONTACT, email: 'other@example.com', owner_id: ownerId });

    const results = await listContacts({ search: 'find.me' });
    expect(results.data).toHaveLength(1);
    expect(results.data[0].email).toBe('find.me@example.com');
  });

  it('returns empty array when search matches nothing', async () => {
    await createContact({ ...BASE_CONTACT, owner_id: ownerId });
    const results = await listContacts({ search: 'zzznomatch' });
    expect(results.data).toHaveLength(0);
  });

  it('combines search with ownerId filter', async () => {
    const other = await createUser({ ...OWNER_USER, email: 'search-other@example.com' });
    await createContact({
      ...BASE_CONTACT,
      first_name: 'Alice',
      email: 'mine-alice@example.com',
      owner_id: ownerId,
    });
    await createContact({
      ...BASE_CONTACT,
      first_name: 'Alice',
      email: 'theirs-alice@example.com',
      owner_id: other.id,
    });

    const results = await listContacts({ ownerId, search: 'Alice' });
    expect(results.data).toHaveLength(1);
    expect(results.data[0].email).toBe('mine-alice@example.com');
  });
});

describe('listContacts — accountSearch filter', () => {
  it('returns only contacts linked to accounts matching the name substring', async () => {
    await createContact({
      ...BASE_CONTACT,
      email: 'linked@example.com',
      account_id: accountId,
      owner_id: ownerId,
    });
    await createContact({ ...BASE_CONTACT, email: 'unlinked@example.com', owner_id: ownerId });

    // accountId was created with name 'Test Account'
    const results = await listContacts({ accountSearch: 'Test' });
    expect(results.data).toHaveLength(1);
    expect(results.data[0].email).toBe('linked@example.com');
  });

  it('returns empty array when account name search matches nothing', async () => {
    await createContact({
      ...BASE_CONTACT,
      email: 'x@example.com',
      account_id: accountId,
      owner_id: ownerId,
    });
    const results = await listContacts({ accountSearch: 'zzznomatch' });
    expect(results.data).toHaveLength(0);
  });
});

// ── listContacts — pagination ───────────────────────────────────────────────────

describe('listContacts — pagination', () => {
  it('returns correct page and limit metadata', async () => {
    await createContact({ ...BASE_CONTACT, email: 'p1@example.com', owner_id: ownerId });
    await createContact({ ...BASE_CONTACT, email: 'p2@example.com', owner_id: ownerId });
    await createContact({ ...BASE_CONTACT, email: 'p3@example.com', owner_id: ownerId });

    const result = await listContacts({ page: 1, limit: 2 });
    expect(result.data).toHaveLength(2);
    expect(result.total).toBe(3);
    expect(result.page).toBe(1);
    expect(result.limit).toBe(2);
  });

  it('returns the correct slice for page 2', async () => {
    await createContact({ ...BASE_CONTACT, email: 'first@example.com', owner_id: ownerId });
    await createContact({ ...BASE_CONTACT, email: 'second@example.com', owner_id: ownerId });
    await createContact({ ...BASE_CONTACT, email: 'third@example.com', owner_id: ownerId });

    const result = await listContacts({ page: 2, limit: 2 });
    expect(result.data).toHaveLength(1);
    expect(result.data[0].email).toBe('third@example.com');
    expect(result.total).toBe(3);
  });

  it('returns empty data array when page exceeds total', async () => {
    await createContact({ ...BASE_CONTACT, email: 'only@example.com', owner_id: ownerId });

    const result = await listContacts({ page: 5, limit: 10 });
    expect(result.data).toHaveLength(0);
    expect(result.total).toBe(1);
  });

  it('sorts by first_name ascending when sort=first_name dir=ASC', async () => {
    await createContact({
      ...BASE_CONTACT,
      first_name: 'Zara',
      email: 'z@example.com',
      owner_id: ownerId,
    });
    await createContact({
      ...BASE_CONTACT,
      first_name: 'Alice',
      email: 'a@example.com',
      owner_id: ownerId,
    });

    const result = await listContacts({ sort: 'first_name', dir: 'ASC' });
    expect(result.data[0].first_name).toBe('Alice');
    expect(result.data[1].first_name).toBe('Zara');
  });

  it('sorts by first_name descending when sort=first_name dir=DESC', async () => {
    await createContact({
      ...BASE_CONTACT,
      first_name: 'Alice',
      email: 'a@example.com',
      owner_id: ownerId,
    });
    await createContact({
      ...BASE_CONTACT,
      first_name: 'Zara',
      email: 'z@example.com',
      owner_id: ownerId,
    });

    const result = await listContacts({ sort: 'first_name', dir: 'DESC' });
    expect(result.data[0].first_name).toBe('Zara');
  });

  it('falls back to created_at sort for invalid sort column', async () => {
    await createContact({ ...BASE_CONTACT, email: 'safe@example.com', owner_id: ownerId });

    // Should not throw; falls back to created_at
    const result = await listContacts({
      sort: 'invalid_col; DROP TABLE contacts;--' as unknown as 'created_at',
    });
    expect(result.data).toHaveLength(1);
  });
});

// ── updateContact ───────────────────────────────────────────────────────────────

describe('updateContact', () => {
  it('updates the specified fields and returns the updated row', async () => {
    const contact = await createContact({ ...BASE_CONTACT, owner_id: ownerId });

    const updated = await updateContact(contact.id, { first_name: 'Alicia', title: 'CRO' });

    expect(updated!.first_name).toBe('Alicia');
    expect(updated!.title).toBe('CRO');
    // Unchanged fields remain intact
    expect(updated!.last_name).toBe('Smith');
    expect(updated!.email).toBe('alice@example.com');
  });

  it('updates updated_at timestamp', async () => {
    const contact = await createContact({ ...BASE_CONTACT, owner_id: ownerId });
    const updated = await updateContact(contact.id, { phone: '+1-555-9999' });

    expect(updated!.updated_at.getTime()).toBeGreaterThanOrEqual(contact.updated_at.getTime());
  });

  it('links a contact to an account', async () => {
    const contact = await createContact({ ...BASE_CONTACT, owner_id: ownerId });
    expect(contact.account_id).toBeNull();

    const updated = await updateContact(contact.id, { account_id: accountId });
    expect(updated!.account_id).toBe(accountId);
  });

  it('unlinks a contact from an account by setting account_id to null', async () => {
    const contact = await createContact({
      ...BASE_CONTACT,
      email: 'linked2@example.com',
      account_id: accountId,
      owner_id: ownerId,
    });
    expect(contact.account_id).toBe(accountId);

    const updated = await updateContact(contact.id, { account_id: null });
    expect(updated!.account_id).toBeNull();
  });

  it('returns null for a non-existent contact', async () => {
    const result = await updateContact('00000000-0000-0000-0000-000000000000', {
      first_name: 'Ghost',
    });
    expect(result).toBeNull();
  });
});

// ── deleteContact ───────────────────────────────────────────────────────────────

describe('deleteContact', () => {
  it('removes the contact and returns the deleted row', async () => {
    const contact = await createContact({ ...BASE_CONTACT, owner_id: ownerId });

    const deleted = await deleteContact(contact.id);
    expect(deleted!.id).toBe(contact.id);

    const found = await findContactById(contact.id);
    expect(found).toBeNull();
  });

  it('returns null for a non-existent contact', async () => {
    const result = await deleteContact('00000000-0000-0000-0000-000000000000');
    expect(result).toBeNull();
  });
});
