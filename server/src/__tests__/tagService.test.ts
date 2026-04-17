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

const OWNER_USER = {
  email: 'tag-owner@example.com',
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
  await pool.query('DELETE FROM contact_tags');
  await pool.query('DELETE FROM account_tags');
  await pool.query('DELETE FROM deal_tags');
  await pool.query('DELETE FROM tags');
  await pool.query('DELETE FROM deal_contacts');
  await pool.query('DELETE FROM deals');
  await pool.query('DELETE FROM contacts');
  await pool.query('DELETE FROM accounts');
  await pool.query('DELETE FROM users WHERE email = $1', [OWNER_USER.email]);

  const owner = await createUser(OWNER_USER);
  ownerId = owner.id;

  const accountResult = await pool.query<{ id: string }>(
    `INSERT INTO accounts (name, owner_id) VALUES ($1, $2) RETURNING id`,
    ['Tag Test Account', ownerId],
  );
  accountId = accountResult.rows[0].id;

  const contactResult = await pool.query<{ id: string }>(
    `INSERT INTO contacts (first_name, last_name, email, owner_id) VALUES ($1, $2, $3, $4) RETURNING id`,
    ['Tag', 'Tester', 'tag-tester@example.com', ownerId],
  );
  contactId = contactResult.rows[0].id;

  const dealResult = await pool.query<{ id: string }>(
    `INSERT INTO deals (name, stage, owner_id) VALUES ($1, $2, $3) RETURNING id`,
    ['Tag Test Deal', 'Prospecting', ownerId],
  );
  dealId = dealResult.rows[0].id;
});

beforeEach(async () => {
  await pool.query('DELETE FROM contact_tags');
  await pool.query('DELETE FROM account_tags');
  await pool.query('DELETE FROM deal_tags');
  await pool.query('DELETE FROM tags');
});

afterAll(async () => {
  await pool.query('DELETE FROM contact_tags');
  await pool.query('DELETE FROM account_tags');
  await pool.query('DELETE FROM deal_tags');
  await pool.query('DELETE FROM tags');
  await pool.query('DELETE FROM deal_contacts');
  await pool.query('DELETE FROM deals');
  await pool.query('DELETE FROM contacts');
  await pool.query('DELETE FROM accounts');
  await pool.query('DELETE FROM users WHERE email = $1', [OWNER_USER.email]);
  await pool.end();
});

// ── createTag ─────────────────────────────────────────────────────────────────

describe('createTag', () => {
  it('creates a tag and returns it', async () => {
    const tag = await createTag({ name: 'vip' });
    expect(tag.id).toBeTruthy();
    expect(tag.name).toBe('vip');
  });

  it('is idempotent — returns existing tag if name already exists', async () => {
    const first = await createTag({ name: 'conference-2026' });
    const second = await createTag({ name: 'conference-2026' });
    expect(second.id).toBe(first.id);
  });
});

// ── listTags ──────────────────────────────────────────────────────────────────

describe('listTags', () => {
  it('returns all tags ordered by name', async () => {
    await createTag({ name: 'zebra' });
    await createTag({ name: 'alpha' });
    const tags = await listTags();
    const names = tags.map((t) => t.name);
    expect(names).toEqual([...names].sort());
    expect(names).toContain('alpha');
    expect(names).toContain('zebra');
  });

  it('returns empty array when no tags exist', async () => {
    const tags = await listTags();
    expect(tags).toEqual([]);
  });
});

// ── findTagById ───────────────────────────────────────────────────────────────

describe('findTagById', () => {
  it('returns a tag by ID', async () => {
    const created = await createTag({ name: 'at-risk' });
    const found = await findTagById(created.id);
    expect(found).not.toBeNull();
    expect(found!.name).toBe('at-risk');
  });

  it('returns null for an unknown ID', async () => {
    const result = await findTagById('00000000-0000-0000-0000-000000000000');
    expect(result).toBeNull();
  });
});

// ── updateTag ─────────────────────────────────────────────────────────────────

describe('updateTag', () => {
  it('renames a tag', async () => {
    const tag = await createTag({ name: 'old-name' });
    const updated = await updateTag(tag.id, { name: 'new-name' });
    expect(updated).not.toBeNull();
    expect(updated!.name).toBe('new-name');
  });

  it('returns null for an unknown ID', async () => {
    const result = await updateTag('00000000-0000-0000-0000-000000000000', { name: 'x' });
    expect(result).toBeNull();
  });
});

// ── deleteTag ─────────────────────────────────────────────────────────────────

describe('deleteTag', () => {
  it('deletes a tag and returns true', async () => {
    const tag = await createTag({ name: 'to-delete' });
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
    await attachTag('contact', contactId, { name: 'vip' });
    const tags = await listEntityTags('contact', contactId);
    expect(tags.map((t) => t.name)).toContain('vip');
  });

  it('is idempotent — attaching the same tag twice does not error', async () => {
    await attachTag('contact', contactId, { name: 'needs-renewal' });
    await expect(attachTag('contact', contactId, { name: 'needs-renewal' })).resolves.not.toThrow();
    const tags = await listEntityTags('contact', contactId);
    expect(tags.filter((t) => t.name === 'needs-renewal').length).toBe(1);
  });

  it('creates the tag if it does not already exist', async () => {
    const tag = await attachTag('contact', contactId, { name: 'brand-new-tag' });
    expect(tag.id).toBeTruthy();
    const allTags = await listTags();
    expect(allTags.map((t) => t.name)).toContain('brand-new-tag');
  });

  it('detaches a tag from a contact', async () => {
    const tag = await attachTag('contact', contactId, { name: 'temp' });
    const removed = await detachTag('contact', contactId, tag.id);
    expect(removed).toBe(true);
    const tags = await listEntityTags('contact', contactId);
    expect(tags.map((t) => t.name)).not.toContain('temp');
  });

  it('detach returns false when association does not exist', async () => {
    const tag = await createTag({ name: 'unattached' });
    const result = await detachTag('contact', contactId, tag.id);
    expect(result).toBe(false);
  });
});

describe('account tag attachment', () => {
  it('attaches and lists tags on an account', async () => {
    await attachTag('account', accountId, { name: 'partner' });
    const tags = await listEntityTags('account', accountId);
    expect(tags.map((t) => t.name)).toContain('partner');
  });
});

describe('deal tag attachment', () => {
  it('attaches and lists tags on a deal', async () => {
    await attachTag('deal', dealId, { name: 'enterprise' });
    const tags = await listEntityTags('deal', dealId);
    expect(tags.map((t) => t.name)).toContain('enterprise');
  });
});

describe('tag cascade delete', () => {
  it('removing a tag removes its junction rows across all entities', async () => {
    const tag = await attachTag('contact', contactId, { name: 'cascade-test' });
    await attachTag('account', accountId, { name: 'cascade-test' });

    await deleteTag(tag.id);

    const contactTags = await listEntityTags('contact', contactId);
    const accountTags = await listEntityTags('account', accountId);
    expect(contactTags.map((t) => t.name)).not.toContain('cascade-test');
    expect(accountTags.map((t) => t.name)).not.toContain('cascade-test');
  });
});
