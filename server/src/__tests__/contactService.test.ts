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
  exportContactsForCsv,
  mergeContacts,
  listContactAddresses,
  addContactAddress,
  removeContactAddress,
  setDefaultContactAddress,
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

/** Secondary user emails created in individual tests — cleaned up in beforeAll to prevent duplicate key errors on rerun */
const SECONDARY_USERS = ['other@example.com', 'search-other@example.com'];

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
  await pool.query('DELETE FROM users WHERE email = ANY($1)', [SECONDARY_USERS]);
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
    'DELETE FROM deal_contacts WHERE deal_id IN (SELECT id FROM deals WHERE owner_id IN (SELECT id FROM users WHERE email = $1))',
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

// ── exportContactsForCsv ────────────────────────────────────────────────────────

describe('exportContactsForCsv', () => {
  it('returns an empty array when no contacts exist', async () => {
    const rows = await exportContactsForCsv();
    expect(rows).toEqual([]);
  });

  it('returns enriched rows with owner_name and account_name', async () => {
    await createContact({ ...BASE_CONTACT, account_id: accountId, owner_id: ownerId });

    const rows = await exportContactsForCsv({ ownerId });

    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.first_name).toBe('Alice');
    expect(row.last_name).toBe('Smith');
    expect(row.email).toBe('alice@example.com');
    expect(row.owner_name).toBe('Owner User');
    expect(row.account_name).toBe('Test Account');
  });

  it('returns null account_name when contact has no account', async () => {
    await createContact({ ...BASE_CONTACT, owner_id: ownerId });

    const rows = await exportContactsForCsv({ ownerId });

    expect(rows).toHaveLength(1);
    expect(rows[0].account_name).toBeNull();
  });

  it('filters by ownerId', async () => {
    // Guard against leftover user from a prior failed run
    await pool.query(
      `DELETE FROM contacts WHERE owner_id IN (SELECT id FROM users WHERE email = 'export-other@example.com')`,
    );
    await pool.query(`DELETE FROM users WHERE email = 'export-other@example.com'`);

    const otherUser = await pool.query<{ id: string }>(
      `INSERT INTO users (email, name, role, password_hash, status)
       VALUES ('export-other@example.com', 'Other User', 'rep', 'x', 'active') RETURNING id`,
    );
    const otherOwnerId = otherUser.rows[0].id;

    await createContact({ ...BASE_CONTACT, email: 'mine@example.com', owner_id: ownerId });
    await createContact({ ...BASE_CONTACT, email: 'theirs@example.com', owner_id: otherOwnerId });

    const rows = await exportContactsForCsv({ ownerId });
    expect(rows.every((r) => r.owner_name === 'Owner User')).toBe(true);

    // Must delete contacts before user due to FK constraint
    await pool.query('DELETE FROM contacts WHERE owner_id = $1', [otherOwnerId]);
    await pool.query('DELETE FROM users WHERE email = $1', ['export-other@example.com']);
  });

  it('filters by search', async () => {
    await createContact({ ...BASE_CONTACT, email: 'alice@example.com', owner_id: ownerId });
    await createContact({
      ...BASE_CONTACT,
      first_name: 'Bob',
      email: 'bob@example.com',
      owner_id: ownerId,
    });

    const rows = await exportContactsForCsv({ search: 'alice' });
    expect(rows).toHaveLength(1);
    expect(rows[0].email).toBe('alice@example.com');
  });

  it('orders results by last_name then first_name', async () => {
    await createContact({
      ...BASE_CONTACT,
      first_name: 'Zara',
      last_name: 'Zzz',
      email: 'z@example.com',
      owner_id: ownerId,
    });
    await createContact({
      ...BASE_CONTACT,
      first_name: 'Aaron',
      last_name: 'Aaa',
      email: 'a@example.com',
      owner_id: ownerId,
    });

    const rows = await exportContactsForCsv({ ownerId });
    expect(rows[0].last_name).toBe('Aaa');
    expect(rows[rows.length - 1].last_name).toBe('Zzz');
  });

  it('includes address and social fields in export rows', async () => {
    await createContact({
      ...BASE_CONTACT,
      email: 'csv-export@example.com',
      owner_id: ownerId,
      address_line1: '123 Main St',
      city: 'Springfield',
      country: 'US',
      linkedin_url: 'https://linkedin.com/in/alice',
    });

    const rows = await exportContactsForCsv({ ownerId });
    expect(rows).toHaveLength(1);
    expect(rows[0].address_line1).toBe('123 Main St');
    expect(rows[0].city).toBe('Springfield');
    expect(rows[0].country).toBe('US');
    expect(rows[0].linkedin_url).toBe('https://linkedin.com/in/alice');
  });
});

// ── createContact — address and social fields ───────────────────────────────────

describe('createContact — address and social fields', () => {
  it('stores address fields when provided', async () => {
    const contact = await createContact({
      ...BASE_CONTACT,
      email: 'addr@example.com',
      owner_id: ownerId,
      address_line1: '100 Oak Ave',
      address_line2: 'Suite 200',
      city: 'Portland',
      state_region: 'OR',
      postal_code: '97201',
      country: 'US',
    });

    expect(contact.address_line1).toBe('100 Oak Ave');
    expect(contact.address_line2).toBe('Suite 200');
    expect(contact.city).toBe('Portland');
    expect(contact.state_region).toBe('OR');
    expect(contact.postal_code).toBe('97201');
    expect(contact.country).toBe('US');
  });

  it('stores null for address fields when omitted', async () => {
    const contact = await createContact({
      first_name: 'No',
      last_name: 'Address',
      email: 'noaddr@example.com',
      owner_id: ownerId,
    });

    expect(contact.address_line1).toBeNull();
    expect(contact.city).toBeNull();
    expect(contact.country).toBeNull();
  });

  it('stores linkedin_url and twitter_x_url when provided', async () => {
    const contact = await createContact({
      ...BASE_CONTACT,
      email: 'social@example.com',
      owner_id: ownerId,
      linkedin_url: 'https://linkedin.com/in/alicesmith',
      twitter_x_url: 'https://x.com/alicesmith',
    });

    expect(contact.linkedin_url).toBe('https://linkedin.com/in/alicesmith');
    expect(contact.twitter_x_url).toBe('https://x.com/alicesmith');
  });

  it('stores null for social fields when omitted', async () => {
    const contact = await createContact({
      first_name: 'No',
      last_name: 'Social',
      email: 'nosocial@example.com',
      owner_id: ownerId,
    });
    expect(contact.linkedin_url).toBeNull();
    expect(contact.twitter_x_url).toBeNull();
  });
});

// ── updateContact — address and social fields ───────────────────────────────────

describe('updateContact — address and social fields', () => {
  it('updates city and country', async () => {
    const contact = await createContact({ ...BASE_CONTACT, owner_id: ownerId });
    const updated = await updateContact(contact.id, { city: 'Seattle', country: 'US' });
    expect(updated!.city).toBe('Seattle');
    expect(updated!.country).toBe('US');
    // Other fields intact
    expect(updated!.first_name).toBe('Alice');
  });

  it('updates linkedin_url', async () => {
    const contact = await createContact({ ...BASE_CONTACT, owner_id: ownerId });
    const updated = await updateContact(contact.id, {
      linkedin_url: 'https://www.linkedin.com/in/testuser',
    });
    expect(updated!.linkedin_url).toBe('https://www.linkedin.com/in/testuser');
  });

  it('overwrites linkedin_url with a new value', async () => {
    const contact = await createContact({
      ...BASE_CONTACT,
      email: 'clearme@example.com',
      owner_id: ownerId,
      linkedin_url: 'https://linkedin.com/in/old-url',
    });
    const updated = await updateContact(contact.id, {
      linkedin_url: 'https://linkedin.com/in/new-url',
    });
    expect(updated!.linkedin_url).toBe('https://linkedin.com/in/new-url');
  });
});

// ── mergeContacts ───────────────────────────────────────────────────────────────

describe('mergeContacts', () => {
  /** Reusable actor derived from the test owner (valid user in DB) */
  const getActor = () => ({ id: ownerId, name: 'Owner User' });

  it('deletes the loser contact after merge', async () => {
    const winner = await createContact({
      ...BASE_CONTACT,
      email: 'winner@example.com',
      owner_id: ownerId,
    });
    const loser = await createContact({
      ...BASE_CONTACT,
      email: 'loser@example.com',
      owner_id: ownerId,
    });

    await mergeContacts({ winnerId: winner.id, loserId: loser.id, fieldChoices: {} }, getActor());

    const found = await findContactById(loser.id);
    expect(found).toBeNull();
  });

  it('winner contact still exists after merge', async () => {
    const winner = await createContact({
      ...BASE_CONTACT,
      email: 'alive-winner@example.com',
      owner_id: ownerId,
    });
    const loser = await createContact({
      ...BASE_CONTACT,
      email: 'alive-loser@example.com',
      owner_id: ownerId,
    });

    await mergeContacts({ winnerId: winner.id, loserId: loser.id, fieldChoices: {} }, getActor());

    const found = await findContactById(winner.id);
    expect(found).not.toBeNull();
  });

  it('rejects self-merge (winner === loser)', async () => {
    const contact = await createContact({
      ...BASE_CONTACT,
      email: 'self@example.com',
      owner_id: ownerId,
    });

    await expect(
      mergeContacts({ winnerId: contact.id, loserId: contact.id, fieldChoices: {} }),
    ).rejects.toMatchObject({ code: 'SELF_MERGE' });
  });

  it('uses loser field value when fieldChoices specifies loser', async () => {
    const winner = await createContact({
      ...BASE_CONTACT,
      first_name: 'WinnerFirst',
      email: 'fc-winner@example.com',
      owner_id: ownerId,
    });
    const loser = await createContact({
      ...BASE_CONTACT,
      first_name: 'LoserFirst',
      email: 'fc-loser@example.com',
      owner_id: ownerId,
    });

    await mergeContacts(
      { winnerId: winner.id, loserId: loser.id, fieldChoices: { first_name: 'loser' } },
      getActor(),
    );

    const updated = await findContactById(winner.id);
    expect(updated!.first_name).toBe('LoserFirst');
  });

  it('re-links loser activities to winner', async () => {
    const winner = await createContact({
      ...BASE_CONTACT,
      email: 'act-winner@example.com',
      owner_id: ownerId,
    });
    const loser = await createContact({
      ...BASE_CONTACT,
      email: 'act-loser@example.com',
      owner_id: ownerId,
    });

    // Insert an activity linked to the loser
    const actResult = await pool.query<{ id: string }>(
      `INSERT INTO activities (type, subject, status, contact_id, owner_id)
       VALUES ('Note', 'Test Note', 'open', $1, $2)
       RETURNING id`,
      [loser.id, ownerId],
    );
    const activityId = actResult.rows[0].id;

    await mergeContacts({ winnerId: winner.id, loserId: loser.id, fieldChoices: {} }, getActor());

    // The original activity should now be linked to the winner
    const actRow = await pool.query<{ contact_id: string }>(
      'SELECT contact_id FROM activities WHERE id = $1',
      [activityId],
    );
    expect(actRow.rows[0].contact_id).toBe(winner.id);
  });

  it('writes a merged audit entry', async () => {
    const winner = await createContact({
      ...BASE_CONTACT,
      email: 'audit-winner@example.com',
      owner_id: ownerId,
    });
    const loser = await createContact({
      ...BASE_CONTACT,
      first_name: 'AuditLoser',
      email: 'audit-loser@example.com',
      owner_id: ownerId,
    });

    await mergeContacts({ winnerId: winner.id, loserId: loser.id, fieldChoices: {} }, getActor());

    const auditRow = await pool.query(
      `SELECT * FROM audit_log WHERE record_type = 'contact' AND record_id = $1 AND event_type = 'merged'`,
      [winner.id],
    );
    expect(auditRow.rows).toHaveLength(1);
  });

  it('re-links loser deal_contacts to winner, skipping duplicates', async () => {
    const winner = await createContact({
      ...BASE_CONTACT,
      email: 'deal-winner@example.com',
      owner_id: ownerId,
    });
    const loser = await createContact({
      ...BASE_CONTACT,
      email: 'deal-loser@example.com',
      owner_id: ownerId,
    });

    // Create a deal linked to the loser
    const dealResult = await pool.query<{ id: string }>(
      `INSERT INTO deals (name, stage, account_id, owner_id)
       VALUES ('Merge Deal', 'Prospecting', $1, $2)
       RETURNING id`,
      [accountId, ownerId],
    );
    const dealId = dealResult.rows[0].id;

    await pool.query(`INSERT INTO deal_contacts (deal_id, contact_id) VALUES ($1, $2)`, [
      dealId,
      loser.id,
    ]);

    await mergeContacts({ winnerId: winner.id, loserId: loser.id, fieldChoices: {} }, getActor());

    // The winner should now be linked to the deal
    const linkRow = await pool.query(
      `SELECT * FROM deal_contacts WHERE deal_id = $1 AND contact_id = $2`,
      [dealId, winner.id],
    );
    expect(linkRow.rows).toHaveLength(1);

    // Cleanup deal
    await pool.query('DELETE FROM deals WHERE id = $1', [dealId]);
  });

  it('uses loser address and social field values when fieldChoices specifies loser', async () => {
    const winner = await createContact({
      ...BASE_CONTACT,
      email: 'addr-winner@example.com',
      owner_id: ownerId,
      address_line1: 'Winner Street 1',
      city: 'Winner City',
      linkedin_url: 'https://linkedin.com/in/winner',
    });
    const loser = await createContact({
      ...BASE_CONTACT,
      email: 'addr-loser@example.com',
      owner_id: ownerId,
      address_line1: 'Loser Avenue 2',
      city: 'Loser City',
      linkedin_url: 'https://linkedin.com/in/loser',
    });

    await mergeContacts(
      {
        winnerId: winner.id,
        loserId: loser.id,
        fieldChoices: { address_line1: 'loser', city: 'loser', linkedin_url: 'loser' },
      },
      getActor(),
    );

    const updated = await findContactById(winner.id);
    expect(updated!.address_line1).toBe('Loser Avenue 2');
    expect(updated!.city).toBe('Loser City');
    expect(updated!.linkedin_url).toBe('https://linkedin.com/in/loser');
  });
});

// ── listContactAddresses / addContactAddress / removeContactAddress / setDefaultContactAddress ──

describe('contact addresses', () => {
  let contactId: string;

  beforeEach(async () => {
    const contact = await createContact({
      ...BASE_CONTACT,
      email: `addr-test-${Date.now()}@example.com`,
      owner_id: ownerId,
    });
    contactId = contact.id;
  });

  it('returns empty list when no addresses exist', async () => {
    const addresses = await listContactAddresses(contactId);
    expect(addresses).toEqual([]);
  });

  it('adds an address and returns it', async () => {
    const address = await addContactAddress(contactId, {
      label: 'Work',
      address_line1: '1 Market St',
      city: 'San Francisco',
      state_region: 'CA',
      postal_code: '94105',
      country: 'US',
      is_default: true,
    });

    expect(address.contact_id).toBe(contactId);
    expect(address.label).toBe('Work');
    expect(address.city).toBe('San Francisco');
    expect(address.is_default).toBe(true);
  });

  it('only one address is default when adding a second default', async () => {
    await addContactAddress(contactId, { address_line1: 'First St', is_default: true });
    await addContactAddress(contactId, { address_line1: 'Second St', is_default: true });

    const addresses = await listContactAddresses(contactId);
    const defaults = addresses.filter((a) => a.is_default);
    expect(defaults).toHaveLength(1);
    expect(defaults[0].address_line1).toBe('Second St');
  });

  it('removes an address', async () => {
    const address = await addContactAddress(contactId, { address_line1: 'To Delete' });
    const deleted = await removeContactAddress(address.id, contactId);
    expect(deleted).toBe(true);

    const addresses = await listContactAddresses(contactId);
    expect(addresses.find((a) => a.id === address.id)).toBeUndefined();
  });

  it('returns false when removing a non-existent address', async () => {
    const deleted = await removeContactAddress('00000000-0000-0000-0000-000000000000', contactId);
    expect(deleted).toBe(false);
  });

  it('sets a non-default address as default and clears others', async () => {
    const first = await addContactAddress(contactId, {
      address_line1: 'First',
      is_default: true,
    });
    const second = await addContactAddress(contactId, {
      address_line1: 'Second',
      is_default: false,
    });

    const updated = await setDefaultContactAddress(second.id, contactId);
    expect(updated!.is_default).toBe(true);

    const addresses = await listContactAddresses(contactId);
    const firstAfter = addresses.find((a) => a.id === first.id);
    expect(firstAfter!.is_default).toBe(false);
  });
});
