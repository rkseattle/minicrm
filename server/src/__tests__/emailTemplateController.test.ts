/**
 * GET /api/v1/email-templates: the enabled templates a sender can pick.
 */

import 'dotenv/config';

import request from 'supertest';

import { Capability } from '@minicrm/shared/schemas/capabilitySchema.js';

import app from '../app.js';
import pool from '../db.js';
import { invalidateFeatureFlagCache } from '../services/featureFlagService.js';
import { createUser } from '../services/userService.js';

import { makeAuthCookie, purgeFixtureUsers } from './testUtils.js';

const FILE_PREFIX = 'emailtplctl';
const URL = '/api/v1/email-templates';

let repCookie: string;
let noMailboxCookie: string;
let noMailboxRoleId: string;

async function setEmailSync(enabled: boolean): Promise<void> {
  await pool.query('UPDATE feature_flags SET enabled = $1 WHERE flag_key = $2', [
    enabled,
    'email_sync',
  ]);
  invalidateFeatureFlagCache();
}

async function insertTemplate(name: string, enabled: boolean): Promise<void> {
  await pool.query(
    `INSERT INTO email_templates (name, category, subject, body, merge_tags, enabled)
     VALUES ($1, 'general', 'Hi {{contact.first_name}}', '<p>Body</p>', $2, $3)`,
    [
      `${FILE_PREFIX}-${name}`,
      JSON.stringify([{ key: 'contact.first_name', label: 'First name' }]),
      enabled,
    ],
  );
}

beforeAll(async () => {
  await pool.query(`DELETE FROM email_templates WHERE name LIKE '${FILE_PREFIX}-%'`);
  await purgeFixtureUsers({ emailLike: `${FILE_PREFIX}-%@example.com` });
  const rep = await createUser({
    email: `${FILE_PREFIX}-rep@example.com`,
    name: 'Template Rep',
    role: 'rep',
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  repCookie = makeAuthCookie({ id: rep.id, email: rep.email, name: rep.name, role: rep.role });
  // A custom role without connected_accounts:manage, which custom roles override built-ins with.
  const noMailbox = await createUser({
    email: `${FILE_PREFIX}-nomailbox@example.com`,
    name: 'No Mailbox Rep',
    role: 'rep',
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  noMailboxCookie = makeAuthCookie({
    id: noMailbox.id,
    email: noMailbox.email,
    name: noMailbox.name,
    role: noMailbox.role,
  });
  const role = await pool.query<{ id: string }>(
    `INSERT INTO custom_roles (name, description, is_builtin)
     VALUES ($1, 'no mailbox access', false) RETURNING id`,
    [`${FILE_PREFIX}-no-mailbox`],
  );
  noMailboxRoleId = role.rows[0]!.id; // Safe: an INSERT … RETURNING returns its one row.
  await pool.query(`INSERT INTO role_capabilities (role_id, capability) VALUES ($1, $2)`, [
    noMailboxRoleId,
    Capability.ContactsView,
  ]);
  await pool.query('INSERT INTO user_custom_roles (user_id, role_id) VALUES ($1, $2)', [
    noMailbox.id,
    noMailboxRoleId,
  ]);
  await insertTemplate('enabled', true);
  await insertTemplate('disabled', false);
  await setEmailSync(true);
});

afterAll(async () => {
  await pool.query(`DELETE FROM email_templates WHERE name LIKE '${FILE_PREFIX}-%'`);
  await pool.query('DELETE FROM custom_roles WHERE id = $1', [noMailboxRoleId]);
  await purgeFixtureUsers({ emailLike: `${FILE_PREFIX}-%@example.com` });
  await setEmailSync(false);
  await pool.end();
});

describe('GET /api/v1/email-templates', () => {
  it('lists enabled templates with what a picker previews, and no authorship', async () => {
    const res = await request(app).get(`${URL}?limit=100`).set('Cookie', repCookie);

    expect(res.status).toBe(200);
    const ours = (res.body.data as { name: string }[]).filter((row) =>
      row.name.startsWith(FILE_PREFIX),
    );
    expect(ours).toEqual([
      {
        id: expect.any(String),
        name: `${FILE_PREFIX}-enabled`,
        category: 'general',
        subject: 'Hi {{contact.first_name}}',
        body: '<p>Body</p>',
        merge_tags: [{ key: 'contact.first_name', label: 'First name' }],
      },
    ]);
  });

  it('pages per the shared pagination params', async () => {
    const res = await request(app).get(`${URL}?page=1&limit=1`).set('Cookie', repCookie);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body).toMatchObject({ page: 1, limit: 1 });
    expect(res.body.total).toBeGreaterThanOrEqual(1);
  });

  it('answers 400 for invalid pagination', async () => {
    const res = await request(app).get(`${URL}?limit=0`).set('Cookie', repCookie);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('answers 401 without a session', async () => {
    expect((await request(app).get(URL)).status).toBe(401);
  });

  it('answers 403 to a user who cannot manage mailboxes', async () => {
    expect((await request(app).get(URL).set('Cookie', noMailboxCookie)).status).toBe(403);
  });

  it('answers 403 while email sync is off', async () => {
    await setEmailSync(false);
    try {
      expect((await request(app).get(URL).set('Cookie', repCookie)).status).toBe(403);
    } finally {
      await setEmailSync(true);
    }
  });
});
