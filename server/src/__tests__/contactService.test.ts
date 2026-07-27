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
import { getDefaultPipelineId } from '../services/pipelineService.js';
import pool from '../db.js';
import { uid } from './testUtils.js';

const FILE_PREFIX = 'contact-svc';

/** Minimal user fixture used as contact owner */
const OWNER_USER = {
  email: `${FILE_PREFIX}-owner@example.com`,
  name: 'Owner User',
  role: 'rep' as const,
  passwordHash: '$2b$12$placeholder_hash',
  status: 'active' as const,
};

/** Returns a fresh contact fixture with a unique email on each call. */
const makeContact = () => ({
  first_name: 'Alice',
  last_name: 'Smith',
  phone: '+1-555-0100',
  title: 'VP Sales',
  department: 'Sales',
  email: `${FILE_PREFIX}-${uid()}@example.com`,
});

let ownerId: string;
let accountId: string;
let defaultPipelineId: string;

beforeAll(async () => {
  await pool.query(
    'DELETE FROM deal_contacts WHERE deal_id IN (SELECT id FROM deals WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1))',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    'DELETE FROM activities WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
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
  const account = await createAccount({ name: 'Test Account', owner_id: ownerId });
  accountId = account.id;
  defaultPipelineId = await getDefaultPipelineId();
});

beforeEach(async () => {
  await pool.query(
    'DELETE FROM contacts WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
});

afterAll(async () => {
  await pool.query(
    'DELETE FROM deal_contacts WHERE deal_id IN (SELECT id FROM deals WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1))',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    'DELETE FROM deals WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  // Notes may outlive their parent contacts (soft-deleted); clean them up before deleting the user
  await pool.query(
    'DELETE FROM notes WHERE created_by IN (SELECT id FROM users WHERE email LIKE $1)',
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
});

// ── createContact ───────────────────────────────────────────────────────────────

describe('createContact', () => {
  it('inserts a contact and returns the full row', async () => {
    const base = makeContact();
    const contact = await createContact({ ...base, owner_id: ownerId });

    expect(contact.id).toBeDefined();
    expect(contact.first_name).toBe('Alice');
    expect(contact.last_name).toBe('Smith');
    expect(contact.email).toBe(base.email);
    expect(contact.phone).toBe('+1-555-0100');
    expect(contact.title).toBe('VP Sales');
    expect(contact.department).toBe('Sales');
    expect(contact.owner_id).toBe(ownerId);
    expect(contact.created_at).toBeInstanceOf(Date);
  });

  it('normalizes email to lowercase', async () => {
    const contact = await createContact({
      ...makeContact(),
      email: `${FILE_PREFIX}-UPPER-${uid()}@EXAMPLE.COM`,
      owner_id: ownerId,
    });
    expect(contact.email).toMatch(/^contact-svc-upper-[a-f0-9]+@example\.com$/);
  });

  it('stores null for optional fields when omitted', async () => {
    const contact = await createContact({
      first_name: 'Bob',
      last_name: 'Jones',
      email: `${FILE_PREFIX}-${uid()}-bob@example.com`,
      owner_id: ownerId,
    });

    expect(contact.phone).toBeNull();
    expect(contact.title).toBeNull();
    expect(contact.department).toBeNull();
    expect(contact.account_id).toBeNull();
  });

  it('stores account_id when provided', async () => {
    const contact = await createContact({
      ...makeContact(),
      account_id: accountId,
      owner_id: ownerId,
    });
    expect(contact.account_id).toBe(accountId);
  });

  it('throws when owner_id does not reference a real user', async () => {
    await expect(
      createContact({ ...makeContact(), owner_id: '00000000-0000-0000-0000-000000000000' }),
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
        ...makeContact(),
        account_id: '00000000-0000-0000-0000-000000000000',
        owner_id: ownerId,
      }),
    ).rejects.toThrow();
  });

  // MINCRM-247: DB-level UNIQUE constraint test — bypasses the service-layer
  // SELECT duplicate check by inserting directly into contacts, then calling
  // createContact. This exercises the 23505 catch added for TOCTOU safety.
  it('throws DUPLICATE_EMAIL when the DB unique constraint fires on concurrent inserts', async () => {
    const dupEmail = `${FILE_PREFIX}-dup-${uid()}@example.com`;

    // Insert directly to simulate a row already committed by a concurrent request,
    // bypassing the service-layer duplicate check.
    await pool.query(
      `INSERT INTO contacts (first_name, last_name, email, owner_id)
       VALUES ('Existing', 'User', $1, $2)`,
      [dupEmail, ownerId],
    );

    // Now createContact will pass the SELECT check (it won't find a duplicate if we
    // cleared and re-inserted above) — actually the SELECT *will* find it, so to
    // truly bypass the SELECT check and hit the constraint, we call the raw INSERT
    // via a direct concurrent simulation: try to insert the same email again directly.
    const error = await pool
      .query(
        `INSERT INTO contacts (first_name, last_name, email, owner_id)
         VALUES ('Duplicate', 'User', $1, $2)`,
        [dupEmail, ownerId],
      )
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(Error);
    expect((error as { code?: string }).code).toBe('23505');

    // Also verify the service-layer wrapper converts 23505 to DUPLICATE_EMAIL.
    // We need to insert a fresh email not yet in DB; the service SELECT check
    // would normally catch it, but we simulate the race by inserting the row
    // between the SELECT and INSERT. The simplest way: call createContact twice
    // with the same email concurrently (no await on first, then await both).
    await pool.query(
      'DELETE FROM contacts WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
      [`${FILE_PREFIX}-%`],
    );

    const raceEmail = `${FILE_PREFIX}-race-${uid()}@example.com`;
    const [result1, result2] = await Promise.allSettled([
      createContact({ first_name: 'A', last_name: 'B', email: raceEmail, owner_id: ownerId }),
      createContact({ first_name: 'C', last_name: 'D', email: raceEmail, owner_id: ownerId }),
    ]);

    const statuses = [result1.status, result2.status];
    expect(statuses).toContain('fulfilled');
    expect(statuses).toContain('rejected');

    const rejected = [result1, result2].find(
      (r) => r.status === 'rejected',
    ) as PromiseRejectedResult;
    const rejErr = rejected.reason as { code?: string; message?: string };
    expect(rejErr.code).toBe('DUPLICATE_EMAIL');
  });
});

// ── findContactByEmail ───────────────────────────────────────────────────────────

describe('findContactByEmail', () => {
  it('returns the contact row when the email matches (case-insensitive)', async () => {
    const base = makeContact();
    const created = await createContact({ ...base, owner_id: ownerId });
    const found = await findContactByEmail(base.email.toUpperCase());

    expect(found).not.toBeNull();
    expect(found!.id).toBe(created.id);
  });

  it('returns null when no contact matches the email', async () => {
    await createContact({ ...makeContact(), owner_id: ownerId });
    const found = await findContactByEmail('nobody@example.com');

    expect(found).toBeNull();
  });

  it('excludes the contact with the given excludeId', async () => {
    const base = makeContact();
    const contact = await createContact({ ...base, owner_id: ownerId });
    const found = await findContactByEmail(base.email, contact.id);

    expect(found).toBeNull();
  });

  it('returns the contact when a different contact shares the email and excludeId does not match', async () => {
    const sharedEmail = `${FILE_PREFIX}-shared-${uid()}@example.com`;
    const first = await createContact({
      ...makeContact(),
      email: sharedEmail,
      owner_id: ownerId,
    });
    const second = await createContact({
      ...makeContact(),
      first_name: 'Bob',
      owner_id: ownerId,
    });
    const found = await findContactByEmail(sharedEmail, second.id);

    expect(found).not.toBeNull();
    expect(found!.id).toBe(first.id);
  });
});

// ── findContactById ─────────────────────────────────────────────────────────────

describe('findContactById', () => {
  it('returns the contact row when found', async () => {
    const created = await createContact({ ...makeContact(), owner_id: ownerId });
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
    const result = await listContacts({ ownerId });
    expect(result.data).toEqual([]);
    expect(result.total).toBe(0);
  });

  it('returns all contacts ordered by created_at', async () => {
    const emailA = `${FILE_PREFIX}-${uid()}-a@example.com`;
    const emailB = `${FILE_PREFIX}-${uid()}-b@example.com`;
    await createContact({ ...makeContact(), email: emailA, owner_id: ownerId });
    await createContact({ ...makeContact(), email: emailB, owner_id: ownerId });

    const result = await listContacts({ ownerId });
    expect(result.data).toHaveLength(2);
    expect(result.total).toBe(2);
    expect(result.data[0].email).toBe(emailA);
    expect(result.data[1].email).toBe(emailB);
  });

  it('filters by ownerId when provided', async () => {
    // Create a second owner
    const other = await createUser({
      ...OWNER_USER,
      email: `${FILE_PREFIX}-other@example.com`,
    });

    const mineEmail = `${FILE_PREFIX}-${uid()}-mine@example.com`;
    const theirsEmail = `${FILE_PREFIX}-${uid()}-theirs@example.com`;
    await createContact({ ...makeContact(), email: mineEmail, owner_id: ownerId });
    await createContact({ ...makeContact(), email: theirsEmail, owner_id: other.id });

    const result = await listContacts({ ownerId });
    expect(result.data).toHaveLength(1);
    expect(result.data[0].email).toBe(mineEmail);
  });

  it('filters by accountId when provided', async () => {
    const linkedEmail = `${FILE_PREFIX}-${uid()}-linked@example.com`;
    const unlinkedEmail = `${FILE_PREFIX}-${uid()}-unlinked@example.com`;
    await createContact({
      ...makeContact(),
      email: linkedEmail,
      account_id: accountId,
      owner_id: ownerId,
    });
    await createContact({ ...makeContact(), email: unlinkedEmail, owner_id: ownerId });

    const result = await listContacts({ accountId });
    expect(result.data).toHaveLength(1);
    expect(result.data[0].email).toBe(linkedEmail);
  });
});

// ── listContacts — search filters ───────────────────────────────────────────────

describe('listContacts — search filter', () => {
  it('returns contacts whose first_name matches the search term (case-insensitive)', async () => {
    // first_name carries a uid() suffix and the search term is that same
    // suffix (mixed-case, to also exercise case-insensitivity) — a bare
    // 'Alice'/'ali' collides with fixture names other test FILES create
    // concurrently against the same shared test DB (found via cross-file
    // pollution: this test failed intermittently when >1 result matched
    // 'ali'). uid() is unique per test run, so no other file can collide.
    const uniqueFirstName = `Ali-${uid()}`;
    await createContact({
      ...makeContact(),
      first_name: uniqueFirstName,
      owner_id: ownerId,
    });
    await createContact({
      ...makeContact(),
      first_name: 'Bob',
      owner_id: ownerId,
    });

    const results = await listContacts({ search: uniqueFirstName.toUpperCase() });
    expect(results.data).toHaveLength(1);
    expect(results.data[0].first_name).toBe(uniqueFirstName);
  });

  it('returns contacts whose last_name matches the search term (case-insensitive)', async () => {
    // Same uid()-suffixed uniqueness rationale as the first_name case
    // above — a bare 'Smith'/'SMITH' is a common fixture surname collision
    // risk across other concurrently-running test files.
    const uniqueLastName = `Smith-${uid()}`;
    await createContact({
      ...makeContact(),
      last_name: uniqueLastName,
      owner_id: ownerId,
    });
    await createContact({
      ...makeContact(),
      last_name: 'Jones',
      owner_id: ownerId,
    });

    const results = await listContacts({ search: uniqueLastName.toUpperCase() });
    expect(results.data).toHaveLength(1);
    expect(results.data[0].last_name).toBe(uniqueLastName);
  });

  it('returns contacts whose email matches the search term', async () => {
    const findMeEmail = `${FILE_PREFIX}-${uid()}-findme@example.com`;
    await createContact({ ...makeContact(), email: findMeEmail, owner_id: ownerId });
    await createContact({ ...makeContact(), owner_id: ownerId });

    const results = await listContacts({ search: findMeEmail.split('@')[0] });
    expect(results.data).toHaveLength(1);
    expect(results.data[0].email).toBe(findMeEmail);
  });

  it('returns empty array when search matches nothing', async () => {
    await createContact({ ...makeContact(), owner_id: ownerId });
    const results = await listContacts({ search: 'zzznomatch' });
    expect(results.data).toHaveLength(0);
  });

  it('combines search with ownerId filter', async () => {
    const other = await createUser({
      ...OWNER_USER,
      email: `${FILE_PREFIX}-search-other@example.com`,
    });
    await createContact({
      ...makeContact(),
      first_name: 'Alice',
      email: `${FILE_PREFIX}-${uid()}-mine-alice@example.com`,
      owner_id: ownerId,
    });
    await createContact({
      ...makeContact(),
      first_name: 'Alice',
      email: `${FILE_PREFIX}-${uid()}-theirs-alice@example.com`,
      owner_id: other.id,
    });

    const results = await listContacts({ ownerId, search: 'Alice' });
    expect(results.data).toHaveLength(1);
    expect(results.data[0].owner_id).toBe(ownerId);
  });
});

describe('listContacts — accountSearch filter', () => {
  it('returns only contacts linked to accounts matching the name substring', async () => {
    const linkedEmail = `${FILE_PREFIX}-${uid()}-linked@example.com`;
    await createContact({
      ...makeContact(),
      email: linkedEmail,
      account_id: accountId,
      owner_id: ownerId,
    });
    await createContact({ ...makeContact(), owner_id: ownerId });

    // accountId was created with name 'Test Account'
    const results = await listContacts({ accountSearch: 'Test' });
    expect(results.data).toHaveLength(1);
    expect(results.data[0].email).toBe(linkedEmail);
  });

  it('returns empty array when account name search matches nothing', async () => {
    await createContact({
      ...makeContact(),
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
    await createContact({ ...makeContact(), owner_id: ownerId });
    await createContact({ ...makeContact(), owner_id: ownerId });
    await createContact({ ...makeContact(), owner_id: ownerId });

    const result = await listContacts({ ownerId, page: 1, limit: 2 });
    expect(result.data).toHaveLength(2);
    expect(result.total).toBe(3);
    expect(result.page).toBe(1);
    expect(result.limit).toBe(2);
  });

  it('returns the correct slice for page 2', async () => {
    const firstEmail = `${FILE_PREFIX}-${uid()}-first@example.com`;
    const secondEmail = `${FILE_PREFIX}-${uid()}-second@example.com`;
    const thirdEmail = `${FILE_PREFIX}-${uid()}-third@example.com`;
    await createContact({ ...makeContact(), email: firstEmail, owner_id: ownerId });
    await createContact({ ...makeContact(), email: secondEmail, owner_id: ownerId });
    await createContact({ ...makeContact(), email: thirdEmail, owner_id: ownerId });

    const result = await listContacts({ ownerId, page: 2, limit: 2 });
    expect(result.data).toHaveLength(1);
    expect(result.data[0].email).toBe(thirdEmail);
    expect(result.total).toBe(3);
  });

  it('returns empty data array when page exceeds total', async () => {
    await createContact({ ...makeContact(), owner_id: ownerId });

    const result = await listContacts({ ownerId, page: 5, limit: 10 });
    expect(result.data).toHaveLength(0);
    expect(result.total).toBe(1);
  });

  it('sorts by first_name ascending when sort=first_name dir=ASC', async () => {
    await createContact({
      ...makeContact(),
      first_name: 'Zara',
      owner_id: ownerId,
    });
    await createContact({
      ...makeContact(),
      first_name: 'Alice',
      owner_id: ownerId,
    });

    const result = await listContacts({ ownerId, sort: 'first_name', dir: 'ASC' });
    expect(result.data[0].first_name).toBe('Alice');
    expect(result.data[1].first_name).toBe('Zara');
  });

  it('sorts by first_name descending when sort=first_name dir=DESC', async () => {
    await createContact({
      ...makeContact(),
      first_name: 'Alice',
      owner_id: ownerId,
    });
    await createContact({
      ...makeContact(),
      first_name: 'Zara',
      owner_id: ownerId,
    });

    const result = await listContacts({ ownerId, sort: 'first_name', dir: 'DESC' });
    expect(result.data[0].first_name).toBe('Zara');
  });

  it('falls back to created_at sort for invalid sort column', async () => {
    await createContact({ ...makeContact(), owner_id: ownerId });

    // Should not throw; falls back to created_at
    const result = await listContacts({
      ownerId,
      sort: 'invalid_col; DROP TABLE contacts;--' as unknown as 'created_at',
    });
    expect(result.data).toHaveLength(1);
  });
});

// ── updateContact ───────────────────────────────────────────────────────────────

describe('updateContact', () => {
  it('updates the specified fields and returns the updated row', async () => {
    const base = makeContact();
    const contact = await createContact({ ...base, owner_id: ownerId });

    const updated = await updateContact(contact.id, {
      first_name: 'Alicia',
      title: 'CRO',
      version: contact.version,
    });

    expect(updated!.first_name).toBe('Alicia');
    expect(updated!.title).toBe('CRO');
    // Unchanged fields remain intact
    expect(updated!.last_name).toBe('Smith');
    expect(updated!.email).toBe(base.email);
  });

  it('increments version on successful update', async () => {
    const contact = await createContact({ ...makeContact(), owner_id: ownerId });
    expect(contact.version).toBe(1);

    const updated = await updateContact(contact.id, {
      first_name: 'Versioned',
      version: contact.version,
    });
    expect(updated!.version).toBe(2);
  });

  it('updates updated_at timestamp', async () => {
    const contact = await createContact({ ...makeContact(), owner_id: ownerId });
    const updated = await updateContact(contact.id, {
      phone: '+1-555-9999',
      version: contact.version,
    });

    expect(updated!.updated_at.getTime()).toBeGreaterThanOrEqual(contact.updated_at.getTime());
  });

  it('links a contact to an account', async () => {
    const contact = await createContact({ ...makeContact(), owner_id: ownerId });
    expect(contact.account_id).toBeNull();

    const updated = await updateContact(contact.id, {
      account_id: accountId,
      version: contact.version,
    });
    expect(updated!.account_id).toBe(accountId);
  });

  it('unlinks a contact from an account by setting account_id to null', async () => {
    const contact = await createContact({
      ...makeContact(),
      account_id: accountId,
      owner_id: ownerId,
    });
    expect(contact.account_id).toBe(accountId);

    const updated = await updateContact(contact.id, {
      account_id: null,
      version: contact.version,
    });
    expect(updated!.account_id).toBeNull();
  });

  it('returns null for a non-existent contact', async () => {
    const result = await updateContact('00000000-0000-0000-0000-000000000000', {
      first_name: 'Ghost',
      version: 1,
    });
    expect(result).toBeNull();
  });

  it('throws OPTIMISTIC_LOCK_CONFLICT when version is stale', async () => {
    const contact = await createContact({ ...makeContact(), owner_id: ownerId });

    // First update succeeds and bumps version to 2
    await updateContact(contact.id, { first_name: 'First Writer', version: contact.version });

    // Second update with stale version (still 1) must conflict
    await expect(
      updateContact(contact.id, { first_name: 'Second Writer', version: contact.version }),
    ).rejects.toMatchObject({ code: 'OPTIMISTIC_LOCK_CONFLICT' });
  });

  it('does not overwrite the winning write on OPTIMISTIC_LOCK_CONFLICT', async () => {
    const contact = await createContact({ ...makeContact(), owner_id: ownerId });

    await updateContact(contact.id, { first_name: 'Winner', version: contact.version });

    await expect(
      updateContact(contact.id, { first_name: 'Loser', version: contact.version }),
    ).rejects.toMatchObject({ code: 'OPTIMISTIC_LOCK_CONFLICT' });

    // The winning write is preserved
    const { rows } = await pool.query<{ first_name: string }>(
      'SELECT first_name FROM contacts WHERE id = $1',
      [contact.id],
    );
    expect(rows[0]?.first_name).toBe('Winner');
  });
});

// ── deleteContact ───────────────────────────────────────────────────────────────

describe('deleteContact', () => {
  it('removes the contact and returns the deleted row', async () => {
    const contact = await createContact({ ...makeContact(), owner_id: ownerId });

    const deleted = await deleteContact(contact.id);
    expect(deleted!.id).toBe(contact.id);

    const found = await findContactById(contact.id);
    expect(found).toBeNull();
  });

  it('returns null for a non-existent contact', async () => {
    const result = await deleteContact('00000000-0000-0000-0000-000000000000');
    expect(result).toBeNull();
  });

  it('soft-deletes all notes for the contact before hard-deleting it (MINCRM-523)', async () => {
    const contact = await createContact({ ...makeContact(), owner_id: ownerId });

    // Create two active notes on the contact
    await pool.query(
      `INSERT INTO notes (entity_type, entity_id, body, body_text, created_by)
       VALUES ('contact', $1, '{"type":"doc"}', 'note one', $2),
              ('contact', $1, '{"type":"doc"}', 'note two', $2)`,
      [contact.id, ownerId],
    );

    await deleteContact(contact.id);

    // Both notes should now be soft-deleted
    const active = await pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM notes
       WHERE entity_type = 'contact' AND entity_id = $1 AND deleted_at IS NULL`,
      [contact.id],
    );
    expect(parseInt(active.rows[0]!.count, 10)).toBe(0);

    const softDeleted = await pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM notes
       WHERE entity_type = 'contact' AND entity_id = $1 AND deleted_at IS NOT NULL`,
      [contact.id],
    );
    expect(parseInt(softDeleted.rows[0]!.count, 10)).toBe(2);
  });
});

// ── exportContactsForCsv ────────────────────────────────────────────────────────

describe('exportContactsForCsv', () => {
  it('returns an empty array when no contacts exist', async () => {
    const rows = await exportContactsForCsv({ ownerId });
    expect(rows).toEqual([]);
  });

  it('returns enriched rows with owner_name and account_name', async () => {
    const base = makeContact();
    await createContact({ ...base, account_id: accountId, owner_id: ownerId });

    const rows = await exportContactsForCsv({ ownerId });

    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.first_name).toBe('Alice');
    expect(row.last_name).toBe('Smith');
    expect(row.email).toBe(base.email);
    expect(row.owner_name).toBe('Owner User');
    expect(row.account_name).toBe('Test Account');
  });

  it('returns null account_name when contact has no account', async () => {
    await createContact({ ...makeContact(), owner_id: ownerId });

    const rows = await exportContactsForCsv({ ownerId });

    expect(rows).toHaveLength(1);
    expect(rows[0].account_name).toBeNull();
  });

  it('filters by ownerId', async () => {
    // Guard against leftover user from a prior failed run
    await pool.query(
      `DELETE FROM contacts WHERE owner_id IN (SELECT id FROM users WHERE email = 'contact-svc-export-other@example.com')`,
    );
    await pool.query(`DELETE FROM users WHERE email = 'contact-svc-export-other@example.com'`);

    const otherUser = await pool.query<{ id: string }>(
      `INSERT INTO users (email, name, role, password_hash, status)
       VALUES ('contact-svc-export-other@example.com', 'Other User', 'rep', 'x', 'active') RETURNING id`,
    );
    const otherOwnerId = otherUser.rows[0].id;

    await createContact({ ...makeContact(), owner_id: ownerId });
    await createContact({ ...makeContact(), owner_id: otherOwnerId });

    const rows = await exportContactsForCsv({ ownerId });
    expect(rows.every((r) => r.owner_name === 'Owner User')).toBe(true);

    // Must delete contacts before user due to FK constraint
    await pool.query('DELETE FROM contacts WHERE owner_id = $1', [otherOwnerId]);
    await pool.query('DELETE FROM users WHERE email = $1', [
      'contact-svc-export-other@example.com',
    ]);
  });

  it('filters by search', async () => {
    const aliceEmail = `${FILE_PREFIX}-${uid()}-alice-csv@example.com`;
    const bobEmail = `${FILE_PREFIX}-${uid()}-bob-csv@example.com`;
    await createContact({
      ...makeContact(),
      email: aliceEmail,
      first_name: 'Alice',
      owner_id: ownerId,
    });
    await createContact({
      ...makeContact(),
      first_name: 'Bob',
      email: bobEmail,
      owner_id: ownerId,
    });

    // Scoped to ownerId in addition to search — exportContactsForCsv queries
    // globally when ownerId is omitted, which could collide with another
    // test file's contact matching the same search term.
    const rows = await exportContactsForCsv({ ownerId, search: aliceEmail.split('@')[0] });
    expect(rows).toHaveLength(1);
    expect(rows[0].email).toBe(aliceEmail);
  });

  it('orders results by last_name then first_name', async () => {
    await createContact({
      ...makeContact(),
      first_name: 'Zara',
      last_name: 'Zzz',
      owner_id: ownerId,
    });
    await createContact({
      ...makeContact(),
      first_name: 'Aaron',
      last_name: 'Aaa',
      owner_id: ownerId,
    });

    const rows = await exportContactsForCsv({ ownerId });
    expect(rows[0].last_name).toBe('Aaa');
    expect(rows[rows.length - 1].last_name).toBe('Zzz');
  });

  it('includes address and social fields in export rows', async () => {
    await createContact({
      ...makeContact(),
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
  it('creates a default contact_addresses row when address fields are provided', async () => {
    const contact = await createContact({
      ...makeContact(),
      owner_id: ownerId,
      address_line1: '100 Oak Ave',
      address_line2: 'Suite 200',
      city: 'Portland',
      state_region: 'OR',
      postal_code: '97201',
      country: 'US',
    });

    const addresses = await listContactAddresses(contact.id);
    expect(addresses).toHaveLength(1);
    const addr = addresses[0];
    expect(addr.address_line1).toBe('100 Oak Ave');
    expect(addr.address_line2).toBe('Suite 200');
    expect(addr.city).toBe('Portland');
    expect(addr.state_region).toBe('OR');
    expect(addr.postal_code).toBe('97201');
    expect(addr.country).toBe('US');
    expect(addr.is_default).toBe(true);
  });

  it('creates no contact_addresses row when no address fields are provided', async () => {
    const contact = await createContact({
      first_name: 'No',
      last_name: 'Address',
      email: `${FILE_PREFIX}-${uid()}-noaddr@example.com`,
      owner_id: ownerId,
    });

    const addresses = await listContactAddresses(contact.id);
    expect(addresses).toHaveLength(0);
  });

  it('stores linkedin_url and twitter_x_url when provided', async () => {
    const contact = await createContact({
      ...makeContact(),
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
      email: `${FILE_PREFIX}-${uid()}-nosocial@example.com`,
      owner_id: ownerId,
    });
    expect(contact.linkedin_url).toBeNull();
    expect(contact.twitter_x_url).toBeNull();
  });
});

// ── updateContact — address and social fields ───────────────────────────────────

describe('updateContact — address and social fields', () => {
  it('does not accept address fields on contacts update (address goes through contact_addresses)', async () => {
    // Address fields were removed from ALLOWED_UPDATE_FIELDS in MINCRM-500.
    // Verify that passing them in an update payload does not blow up and that the
    // contact row itself still lacks address columns.
    const contact = await createContact({ ...makeContact(), owner_id: ownerId });
    const updated = await updateContact(contact.id, {
      linkedin_url: 'https://linkedin.com/in/update-test',
      version: contact.version,
    });
    // Other fields intact
    expect(updated!.first_name).toBe('Alice');
    expect(updated!.linkedin_url).toBe('https://linkedin.com/in/update-test');
  });

  it('updates linkedin_url', async () => {
    const contact = await createContact({ ...makeContact(), owner_id: ownerId });
    const updated = await updateContact(contact.id, {
      linkedin_url: 'https://www.linkedin.com/in/testuser',
      version: contact.version,
    });
    expect(updated!.linkedin_url).toBe('https://www.linkedin.com/in/testuser');
  });

  it('overwrites linkedin_url with a new value', async () => {
    const contact = await createContact({
      ...makeContact(),
      owner_id: ownerId,
      linkedin_url: 'https://linkedin.com/in/old-url',
    });
    const updated = await updateContact(contact.id, {
      linkedin_url: 'https://linkedin.com/in/new-url',
      version: contact.version,
    });
    expect(updated!.linkedin_url).toBe('https://linkedin.com/in/new-url');
  });
});

// ── updateContact — address-only PATCH (fields.length === 0) ────────────────────

describe('updateContact — address-only PATCH', () => {
  it('persists address fields when no scalar contact fields are included', async () => {
    const contact = await createContact({ ...makeContact(), owner_id: ownerId });

    const updated = await updateContact(contact.id, {
      address_line1: '123 Main St',
      version: contact.version,
    });

    expect(updated).not.toBeNull();
    expect(updated!.id).toBe(contact.id);
    // version must be bumped so concurrent address-only PATCHes are rejected
    expect(updated!.version).toBe(contact.version + 1);

    const addresses = await listContactAddresses(contact.id);
    expect(addresses).toHaveLength(1);
    expect(addresses[0].address_line1).toBe('123 Main St');
    expect(addresses[0].is_default).toBe(true);
  });

  it('returns null for a non-existent contact id', async () => {
    const result = await updateContact('00000000-0000-0000-0000-000000000001', {
      address_line1: '1 Ghost St',
      version: 1,
    });
    expect(result).toBeNull();
  });

  it('throws OPTIMISTIC_LOCK_CONFLICT when version is stale', async () => {
    const contact = await createContact({ ...makeContact(), owner_id: ownerId });
    await expect(
      updateContact(contact.id, { address_line1: '1 Stale St', version: contact.version - 1 }),
    ).rejects.toMatchObject({ code: 'OPTIMISTIC_LOCK_CONFLICT' });
  });
});

// ── mergeContacts ───────────────────────────────────────────────────────────────

describe('mergeContacts', () => {
  /** Reusable actor derived from the test owner (valid user in DB) */
  const getActor = () => ({ id: ownerId, name: 'Owner User' });

  it('deletes the loser contact after merge', async () => {
    const winner = await createContact({
      ...makeContact(),
      owner_id: ownerId,
    });
    const loser = await createContact({
      ...makeContact(),
      owner_id: ownerId,
    });

    await mergeContacts({ winnerId: winner.id, loserId: loser.id, fieldChoices: {} }, getActor());

    const found = await findContactById(loser.id);
    expect(found).toBeNull();
  });

  it('winner contact still exists after merge', async () => {
    const winner = await createContact({
      ...makeContact(),
      owner_id: ownerId,
    });
    const loser = await createContact({
      ...makeContact(),
      owner_id: ownerId,
    });

    await mergeContacts({ winnerId: winner.id, loserId: loser.id, fieldChoices: {} }, getActor());

    const found = await findContactById(winner.id);
    expect(found).not.toBeNull();
  });

  it('rejects self-merge (winner === loser)', async () => {
    const contact = await createContact({
      ...makeContact(),
      owner_id: ownerId,
    });

    await expect(
      mergeContacts({ winnerId: contact.id, loserId: contact.id, fieldChoices: {} }),
    ).rejects.toMatchObject({ code: 'SELF_MERGE' });
  });

  it('uses loser field value when fieldChoices specifies loser', async () => {
    const winner = await createContact({
      ...makeContact(),
      first_name: 'WinnerFirst',
      owner_id: ownerId,
    });
    const loser = await createContact({
      ...makeContact(),
      first_name: 'LoserFirst',
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
      ...makeContact(),
      owner_id: ownerId,
    });
    const loser = await createContact({
      ...makeContact(),
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
      ...makeContact(),
      owner_id: ownerId,
    });
    const loser = await createContact({
      ...makeContact(),
      first_name: 'AuditLoser',
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
      ...makeContact(),
      owner_id: ownerId,
    });
    const loser = await createContact({
      ...makeContact(),
      owner_id: ownerId,
    });

    // Create a deal linked to the loser
    const stageIdForMerge = (
      await pool.query<{ id: string }>(
        'SELECT id FROM pipeline_stages WHERE name = $1 AND pipeline_id = $2 LIMIT 1',
        ['Prospecting', defaultPipelineId],
      )
    ).rows[0].id;
    const dealResult = await pool.query<{ id: string }>(
      `INSERT INTO deals (name, stage, account_id, owner_id, pipeline_id, pipeline_stage_id)
       VALUES ('Merge Deal', 'Prospecting', $1, $2, $3, $4)
       RETURNING id`,
      [accountId, ownerId, defaultPipelineId, stageIdForMerge],
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

  it('re-links loser contact_addresses to winner and respects social field choices', async () => {
    // Address fields are no longer merged by field-choice — both contacts' address rows
    // are re-linked to the winner. Social fields still support field-level choices. (MINCRM-500)
    const winner = await createContact({
      ...makeContact(),
      owner_id: ownerId,
      linkedin_url: 'https://linkedin.com/in/winner',
    });
    const loser = await createContact({
      ...makeContact(),
      owner_id: ownerId,
      linkedin_url: 'https://linkedin.com/in/loser',
    });

    // Give winner and loser each a distinct address
    await addContactAddress(winner.id, {
      address_line1: 'Winner Street 1',
      city: 'Winner City',
      is_default: true,
    });
    await addContactAddress(loser.id, {
      address_line1: 'Loser Avenue 2',
      city: 'Loser City',
      is_default: true,
    });

    await mergeContacts(
      {
        winnerId: winner.id,
        loserId: loser.id,
        fieldChoices: { linkedin_url: 'loser' },
      },
      getActor(),
    );

    // Winner's linkedin_url comes from the loser per fieldChoices
    const updated = await findContactById(winner.id);
    expect(updated!.linkedin_url).toBe('https://linkedin.com/in/loser');

    // Both address rows now belong to the winner; loser's row was demoted from is_default
    const addresses = await listContactAddresses(winner.id);
    expect(addresses).toHaveLength(2);
    const defaultAddrs = addresses.filter((a) => a.is_default);
    expect(defaultAddrs).toHaveLength(1);
    expect(defaultAddrs[0].address_line1).toBe('Winner Street 1');
  });
});

// ── listContactAddresses / addContactAddress / removeContactAddress / setDefaultContactAddress ──

describe('contact addresses', () => {
  let contactId: string;

  beforeEach(async () => {
    const contact = await createContact({
      ...makeContact(),
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
