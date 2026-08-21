/**
 * Verifies that the OPTIMISTIC_LOCK_CONFLICT 409 response body includes the full current
 * server state in `error.current`, so the client can render a three-way merge UI without
 * a second round-trip.
 *
 * Each test:
 *   1. Creates the entity (version = 1).
 *   2. Issues a PATCH with the correct version — succeeds; the winning record now holds
 *      the updated value with version = 2.
 *   3. Issues a second PATCH with the stale version = 1 — expects 409.
 *   4. Asserts that `error.current` reflects the winning write (step 2 values) so the
 *      merge UI can show the other user's state without an extra GET.
 */

import 'dotenv/config';
import request from 'supertest';
import app from '../app.js';
import { createContact } from '../services/contactService.js';
import { createAccount } from '../services/accountService.js';
import { createDeal } from '../services/dealService.js';
import { createActivity } from '../services/activityService.js';
import { createLead } from '../services/leadsService.js';
import { createUser } from '../services/userService.js';
import pool from '../db.js';
import { makeAuthCookie, uid } from './testUtils.js';

const FILE_PREFIX = 'ol-current';

const SYSTEM_ACTOR = { id: '00000000-0000-0000-0000-000000000000', name: 'System' };

let adminId: string;
let adminCookie: string;

beforeAll(async () => {
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);

  const admin = await createUser({
    email: `${FILE_PREFIX}-admin@example.com`,
    name: 'Admin User',
    role: 'admin',
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  adminId = admin.id;
  adminCookie = makeAuthCookie({
    id: admin.id,
    email: admin.email,
    name: admin.name,
    role: admin.role,
  });
});

afterAll(async () => {
  // Delete dependent records before users to avoid FK violations
  await pool.query(
    'DELETE FROM activities WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    'DELETE FROM leads WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
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
});

// ── contact ──────────────────────────────────────────────────────────────────

describe('PATCH /api/v1/contacts/:id — OPTIMISTIC_LOCK_CONFLICT includes current', () => {
  it('includes the winning record in error.current on 409', async () => {
    const contact = await createContact(
      {
        first_name: 'Base',
        last_name: 'Contact',
        email: `${FILE_PREFIX}-${uid()}@example.com`,
        owner_id: adminId,
      },
      SYSTEM_ACTOR,
    );

    // Winning write — bumps version to 2
    await request(app)
      .patch(`/api/v1/contacts/${contact.id}`)
      .set('Cookie', adminCookie)
      .send({ first_name: 'Winner', version: contact.version })
      .expect(200);

    // Stale write — must be rejected
    const res = await request(app)
      .patch(`/api/v1/contacts/${contact.id}`)
      .set('Cookie', adminCookie)
      .send({ first_name: 'Loser', version: contact.version })
      .expect(409);

    expect(res.body.error.code).toBe('OPTIMISTIC_LOCK_CONFLICT');
    expect(res.body.error.current).toBeDefined();
    expect(res.body.error.current.id).toBe(contact.id);
    // current must reflect the winning write, not the stale value
    expect(res.body.error.current.first_name).toBe('Winner');
    expect(res.body.error.current.version).toBe(2);
  });
});

// ── account ──────────────────────────────────────────────────────────────────

describe('PATCH /api/v1/accounts/:id — OPTIMISTIC_LOCK_CONFLICT includes current', () => {
  it('includes the winning record in error.current on 409', async () => {
    const account = await createAccount(
      { name: `${FILE_PREFIX}-acct-${uid()}`, owner_id: adminId },
      SYSTEM_ACTOR,
    );

    await request(app)
      .patch(`/api/v1/accounts/${account.id}`)
      .set('Cookie', adminCookie)
      .send({ name: 'Winner Account', version: account.version })
      .expect(200);

    const res = await request(app)
      .patch(`/api/v1/accounts/${account.id}`)
      .set('Cookie', adminCookie)
      .send({ name: 'Loser Account', version: account.version })
      .expect(409);

    expect(res.body.error.code).toBe('OPTIMISTIC_LOCK_CONFLICT');
    expect(res.body.error.current).toBeDefined();
    expect(res.body.error.current.id).toBe(account.id);
    expect(res.body.error.current.name).toBe('Winner Account');
    expect(res.body.error.current.version).toBe(2);
  });
});

// ── deal ─────────────────────────────────────────────────────────────────────

describe('PATCH /api/v1/deals/:id — OPTIMISTIC_LOCK_CONFLICT includes current', () => {
  it('includes the winning record in error.current on 409', async () => {
    const account = await createAccount(
      { name: `${FILE_PREFIX}-deal-acct-${uid()}`, owner_id: adminId },
      SYSTEM_ACTOR,
    );
    const deal = await createDeal(
      {
        name: `${FILE_PREFIX}-deal-${uid()}`,
        stage: 'Prospecting',
        account_id: account.id,
        owner_id: adminId,
      },
      SYSTEM_ACTOR,
    );

    await request(app)
      .patch(`/api/v1/deals/${deal.id}`)
      .set('Cookie', adminCookie)
      .send({ name: 'Winner Deal', version: deal.version })
      .expect(200);

    const res = await request(app)
      .patch(`/api/v1/deals/${deal.id}`)
      .set('Cookie', adminCookie)
      .send({ name: 'Loser Deal', version: deal.version })
      .expect(409);

    expect(res.body.error.code).toBe('OPTIMISTIC_LOCK_CONFLICT');
    expect(res.body.error.current).toBeDefined();
    expect(res.body.error.current.id).toBe(deal.id);
    expect(res.body.error.current.name).toBe('Winner Deal');
    expect(res.body.error.current.version).toBe(2);
  });
});

// ── activity ─────────────────────────────────────────────────────────────────

describe('PATCH /api/v1/activities/:id — OPTIMISTIC_LOCK_CONFLICT includes current', () => {
  it('includes the winning record in error.current on 409', async () => {
    const account = await createAccount(
      { name: `${FILE_PREFIX}-act-acct-${uid()}`, owner_id: adminId },
      SYSTEM_ACTOR,
    );
    const activity = await createActivity({
      type: 'Note',
      subject: `${FILE_PREFIX}-activity-${uid()}`,
      account_id: account.id,
      owner_id: adminId,
    });

    await request(app)
      .patch(`/api/v1/activities/${activity.id}`)
      .set('Cookie', adminCookie)
      .send({ subject: 'Winner Activity', version: activity.version })
      .expect(200);

    const res = await request(app)
      .patch(`/api/v1/activities/${activity.id}`)
      .set('Cookie', adminCookie)
      .send({ subject: 'Loser Activity', version: activity.version })
      .expect(409);

    expect(res.body.error.code).toBe('OPTIMISTIC_LOCK_CONFLICT');
    expect(res.body.error.current).toBeDefined();
    expect(res.body.error.current.id).toBe(activity.id);
    expect(res.body.error.current.subject).toBe('Winner Activity');
    expect(res.body.error.current.version).toBe(2);
  });
});

// ── lead ─────────────────────────────────────────────────────────────────────

describe('PATCH /api/v1/leads/:id — OPTIMISTIC_LOCK_CONFLICT includes current', () => {
  it('includes the winning record in error.current on 409', async () => {
    const lead = await createLead(
      {
        first_name: 'Base',
        email: `${FILE_PREFIX}-lead-${uid()}@example.com`,
        owner_id: adminId,
      },
      SYSTEM_ACTOR,
    );

    await request(app)
      .patch(`/api/v1/leads/${lead.id}`)
      .set('Cookie', adminCookie)
      .send({ first_name: 'Winner', version: lead.version })
      .expect(200);

    const res = await request(app)
      .patch(`/api/v1/leads/${lead.id}`)
      .set('Cookie', adminCookie)
      .send({ first_name: 'Loser', version: lead.version })
      .expect(409);

    expect(res.body.error.code).toBe('OPTIMISTIC_LOCK_CONFLICT');
    expect(res.body.error.current).toBeDefined();
    expect(res.body.error.current.id).toBe(lead.id);
    expect(res.body.error.current.first_name).toBe('Winner');
    expect(res.body.error.current.version).toBe(2);
  });
});
