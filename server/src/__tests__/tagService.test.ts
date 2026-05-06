/**
 * Integration tests for tagService (MINCRM-186).
 *
 * Runs against a real PostgreSQL test database (minicrm_test).
 * Tables are cleaned before each test to ensure isolation.
 */

import 'dotenv/config';
import {
  listTags,
  findTagById,
  createTag,
  updateTag,
  deleteTag,
  listEntityTags,
  attachTag,
  detachTag,
} from '../services/tagService.js';
import { createUser } from '../services/userService.js';
import pool from '../db.js';

const FILE_PREFIX = 'tag-svc';

const OWNER_USER = {
  email: `${FILE_PREFIX}-owner@example.com`,
  name: 'Tag Owner',
  role: 'rep' as const,
  passwordHash: '$2b$12$placeholder_hash',
  status: 'active' as const,
};

let ownerId: string;
let contactId: string;
let accountId: string;
let dealId: string;

beforeAll(async () => {
  await pool.query(
    'DELETE FROM contact_tags WHERE contact_id IN (SELECT id FROM contacts WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1))',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    'DELETE FROM account_tags WHERE account_id IN (SELECT id FROM accounts WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1))',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    'DELETE FROM deal_tags WHERE deal_id IN (SELECT id FROM deals WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1))',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query('DELETE FROM tags WHERE name LIKE $1', [`${FILE_PREFIX}-%`]);
  await pool.query(
    'DELETE FROM deal_contacts WHERE deal_id IN (SELECT id FROM deals WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1))',
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

  const accountResult = await pool.query<{ id: string }>(
    `INSERT INTO accounts (name, owner_id) VALUES ($1, $2) RETURNING id`,
    ['Tag Test Account', ownerId],
  );
  accountId = accountResult.rows[0].id;

  const contactResult = await pool.query<{ id: string }>(
    `INSERT INTO contacts (first_name, last_name, email, owner_id) VALUES ($1, $2, $3, $4) RETURNING id`,
    ['Tag', 'Tester', `${FILE_PREFIX}-tester@example.com`, ownerId],
  );
  contactId = contactResult.rows[0].id;

  const dealResult = await pool.query<{ id: string }>(
    `INSERT INTO deals (name, stage, owner_id) VALUES ($1, $2, $3) RETURNING id`,
    ['Tag Test Deal', 'Prospecting', ownerId],
  );
  dealId = dealResult.rows[0].id;
});

beforeEach(async () => {
  await pool.query(
    'DELETE FROM contact_tags WHERE contact_id IN (SELECT id FROM contacts WHERE owner_id = $1)',
    [ownerId],
  );
  await pool.query(
    'DELETE FROM account_tags WHERE account_id IN (SELECT id FROM accounts WHERE owner_id = $1)',
    [ownerId],
  );
  await pool.query(
    'DELETE FROM deal_tags WHERE deal_id IN (SELECT id FROM deals WHERE owner_id = $1)',
    [ownerId],
  );
  await pool.query('DELETE FROM tags WHERE name LIKE $1', [`${FILE_PREFIX}-%`]);
});

afterAll(async () => {
  await pool.query(
    'DELETE FROM contact_tags WHERE contact_id IN (SELECT id FROM contacts WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1))',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    'DELETE FROM account_tags WHERE account_id IN (SELECT id FROM accounts WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1))',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    'DELETE FROM deal_tags WHERE deal_id IN (SELECT id FROM deals WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1))',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query('DELETE FROM tags WHERE name LIKE $1', [`${FILE_PREFIX}-%`]);
  await pool.query(
    'DELETE FROM deal_contacts WHERE deal_id IN (SELECT id FROM deals WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1))',
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
  await pool.end();
});

// ── createTag ─────────────────────────────────────────────────────────────────

describe('createTag', () => {
  it('creates a tag and returns it', async () => {
    const tag = await createTag({ name: `${FILE_PREFIX}-vip` });
    expect(tag.id).toBeTruthy();
    expect(tag.name).toBe(`${FILE_PREFIX}-vip`);
  });

  it('is idempotent — returns existing tag if name already exists', async () => {
    const first = await createTag({ name: `${FILE_PREFIX}-conference-2026` });
    const second = await createTag({ name: `${FILE_PREFIX}-conference-2026` });
    expect(second.id).toBe(first.id);
  });
});

// ── listTags ──────────────────────────────────────────────────────────────────

describe('listTags', () => {
  it('returns all tags ordered by name', async () => {
    await createTag({ name: `${FILE_PREFIX}-zebra` });
    await createTag({ name: `${FILE_PREFIX}-alpha` });
    const tags = (await listTags()).data.filter((t) => t.name.startsWith(FILE_PREFIX));
    const names = tags.map((t) => t.name);
    expect(names).toEqual([...names].sort());
    expect(names).toContain(`${FILE_PREFIX}-alpha`);
    expect(names).toContain(`${FILE_PREFIX}-zebra`);
  });

  it('returns empty array when no tags exist', async () => {
    const tags = (await listTags()).data.filter((t) => t.name.startsWith(FILE_PREFIX));
    expect(tags).toEqual([]);
  });

  it('returns pagination metadata', async () => {
    const result = await listTags(1, 25);
    expect(result).toHaveProperty('data');
    expect(result).toHaveProperty('total');
    expect(result).toHaveProperty('page', 1);
    expect(result).toHaveProperty('limit', 25);
    expect(Array.isArray(result.data)).toBe(true);
  });

  it('respects page and limit parameters', async () => {
    for (let i = 0; i < 3; i++) {
      await createTag({ name: `${FILE_PREFIX}-page-${i}` });
    }
    const page1 = await listTags(1, 2);
    expect(page1.data.length).toBeLessThanOrEqual(2);
    expect(page1.page).toBe(1);
    expect(page1.limit).toBe(2);
    expect(page1.total).toBeGreaterThanOrEqual(3);
  });
});

// ── findTagById ───────────────────────────────────────────────────────────────

describe('findTagById', () => {
  it('returns a tag by ID', async () => {
    const created = await createTag({ name: `${FILE_PREFIX}-at-risk` });
    const found = await findTagById(created.id);
    expect(found).not.toBeNull();
    expect(found!.name).toBe(`${FILE_PREFIX}-at-risk`);
  });

  it('returns null for an unknown ID', async () => {
    const result = await findTagById('00000000-0000-0000-0000-000000000000');
    expect(result).toBeNull();
  });
});

// ── updateTag ─────────────────────────────────────────────────────────────────

describe('updateTag', () => {
  it('renames a tag', async () => {
    const tag = await createTag({ name: `${FILE_PREFIX}-old-name` });
    const updated = await updateTag(tag.id, { name: `${FILE_PREFIX}-new-name` });
    expect(updated).not.toBeNull();
    expect(updated!.name).toBe(`${FILE_PREFIX}-new-name`);
  });

  it('returns null for an unknown ID', async () => {
    const result = await updateTag('00000000-0000-0000-0000-000000000000', { name: 'x' });
    expect(result).toBeNull();
  });

  it('returns the existing tag unchanged when name is empty (no-op branch)', async () => {
    const tag = await createTag({ name: `${FILE_PREFIX}-no-op` });
    const result = await updateTag(tag.id, { name: '' });
    expect(result).not.toBeNull();
    expect(result!.name).toBe(`${FILE_PREFIX}-no-op`);
  });
});

// ── deleteTag ─────────────────────────────────────────────────────────────────

describe('deleteTag', () => {
  it('deletes a tag and returns true', async () => {
    const tag = await createTag({ name: `${FILE_PREFIX}-to-delete` });
    const deleted = await deleteTag(tag.id);
    expect(deleted).toBe(true);
    expect(await findTagById(tag.id)).toBeNull();
  });

  it('returns false for an unknown ID', async () => {
    const result = await deleteTag('00000000-0000-0000-0000-000000000000');
    expect(result).toBe(false);
  });
});

// ── attachTag / listEntityTags / detachTag ────────────────────────────────────

describe('contact tag attachment', () => {
  it('attaches a tag to a contact and lists it back', async () => {
    await attachTag('contact', contactId, { name: `${FILE_PREFIX}-vip` });
    const tags = await listEntityTags('contact', contactId);
    expect(tags.map((t) => t.name)).toContain(`${FILE_PREFIX}-vip`);
  });

  it('is idempotent — attaching the same tag twice does not error', async () => {
    await attachTag('contact', contactId, { name: `${FILE_PREFIX}-needs-renewal` });
    await expect(
      attachTag('contact', contactId, { name: `${FILE_PREFIX}-needs-renewal` }),
    ).resolves.not.toThrow();
    const tags = await listEntityTags('contact', contactId);
    expect(tags.filter((t) => t.name === `${FILE_PREFIX}-needs-renewal`).length).toBe(1);
  });

  it('creates the tag if it does not already exist', async () => {
    const tag = await attachTag('contact', contactId, { name: `${FILE_PREFIX}-brand-new-tag` });
    expect(tag.id).toBeTruthy();
    const allTags = (await listTags()).data.filter((t) => t.name.startsWith(FILE_PREFIX));
    expect(allTags.map((t) => t.name)).toContain(`${FILE_PREFIX}-brand-new-tag`);
  });

  it('detaches a tag from a contact', async () => {
    const tag = await attachTag('contact', contactId, { name: `${FILE_PREFIX}-temp` });
    const removed = await detachTag('contact', contactId, tag.id);
    expect(removed).toBe(true);
    const tags = await listEntityTags('contact', contactId);
    expect(tags.map((t) => t.name)).not.toContain(`${FILE_PREFIX}-temp`);
  });

  it('detach returns false when association does not exist', async () => {
    const tag = await createTag({ name: `${FILE_PREFIX}-unattached` });
    const result = await detachTag('contact', contactId, tag.id);
    expect(result).toBe(false);
  });
});

describe('account tag attachment', () => {
  it('attaches and lists tags on an account', async () => {
    await attachTag('account', accountId, { name: `${FILE_PREFIX}-partner` });
    const tags = await listEntityTags('account', accountId);
    expect(tags.map((t) => t.name)).toContain(`${FILE_PREFIX}-partner`);
  });
});

describe('deal tag attachment', () => {
  it('attaches and lists tags on a deal', async () => {
    await attachTag('deal', dealId, { name: `${FILE_PREFIX}-enterprise` });
    const tags = await listEntityTags('deal', dealId);
    expect(tags.map((t) => t.name)).toContain(`${FILE_PREFIX}-enterprise`);
  });
});

describe('tag cascade delete', () => {
  it('removing a tag removes its junction rows across all entities', async () => {
    const tag = await attachTag('contact', contactId, { name: `${FILE_PREFIX}-cascade-test` });
    await attachTag('account', accountId, { name: `${FILE_PREFIX}-cascade-test` });

    await deleteTag(tag.id);

    const contactTags = await listEntityTags('contact', contactId);
    const accountTags = await listEntityTags('account', accountId);
    expect(contactTags.map((t) => t.name)).not.toContain(`${FILE_PREFIX}-cascade-test`);
    expect(accountTags.map((t) => t.name)).not.toContain(`${FILE_PREFIX}-cascade-test`);
  });
});
