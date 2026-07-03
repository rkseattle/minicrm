/**
 * HTTP contract tests for champion/blocker endpoints. (MINCRM-466)
 *
 * Covers:
 *  - GET /contacts/:id/champion-blocker: authenticated, flag-gated, returns cached shape
 *  - POST /contacts/:id/champion-blocker/dismiss: persists dismissal
 *  - PATCH /contacts/:id/champion-blocker/override: validates body, persists override
 *  - GET /deals/:id/stakeholder-map: authenticated, flag-gated
 *  - Unauthenticated requests are rejected
 */

import 'dotenv/config';
import request from 'supertest';
import app from '../app.js';
import { createUser } from '../services/userService.js';
import { createContact } from '../services/contactService.js';
import { createDeal } from '../services/dealService.js';
import { getDefaultPipelineId } from '../services/pipelineService.js';
import pool from '../db.js';
import { makeAuthCookie } from './testUtils.js';

const FILE_PREFIX = 'champ-block-ctrl';
const REP_EMAIL = `${FILE_PREFIX}-rep@example.com`;
const OTHER_REP_EMAIL = `${FILE_PREFIX}-other-rep@example.com`;

let repCookie: string;
let repId: string;
let otherRepCookie: string;
let defaultPipelineId: string;

beforeAll(async () => {
  await pool.query(
    'DELETE FROM contacts WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
  const rep = await createUser({
    email: REP_EMAIL,
    name: 'Champion Blocker Rep',
    role: 'rep',
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  repId = rep.id;
  repCookie = makeAuthCookie({ id: rep.id, email: rep.email, role: rep.role, name: rep.name });
  const otherRep = await createUser({
    email: OTHER_REP_EMAIL,
    name: 'Other Champion Blocker Rep',
    role: 'rep',
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  otherRepCookie = makeAuthCookie({
    id: otherRep.id,
    email: otherRep.email,
    role: otherRep.role,
    name: otherRep.name,
  });
  defaultPipelineId = await getDefaultPipelineId();
});

afterAll(async () => {
  await pool.query(
    'DELETE FROM contacts WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
});

async function createTestContact(): Promise<string> {
  const contact = await createContact(
    {
      first_name: 'Jane',
      last_name: `Doe-${Date.now()}-${Math.random()}`,
      email: `jane-${Date.now()}-${Math.random()}@example.com`,
      owner_id: repId,
    },
    { id: repId, name: 'Champion Blocker Rep' },
  );
  return contact.id;
}

describe('GET /api/v1/contacts/:id/champion-blocker', () => {
  it('returns 401 without authentication', async () => {
    const contactId = await createTestContact();
    await request(app).get(`/api/v1/contacts/${contactId}/champion-blocker`).expect(401);
  });

  it('returns the default neutral classification for a contact with no signals', async () => {
    const contactId = await createTestContact();
    const res = await request(app)
      .get(`/api/v1/contacts/${contactId}/champion-blocker`)
      .set('Cookie', repCookie)
      .expect(200);

    expect(res.body.status).toBe('neutral');
    expect(res.body.dismissed).toBe(false);
  });

  it('returns 404 for a non-existent contact', async () => {
    await request(app)
      .get('/api/v1/contacts/00000000-0000-0000-0000-000000000000/champion-blocker')
      .set('Cookie', repCookie)
      .expect(404);
  });

  it('returns 403 when a rep requests a contact owned by another rep', async () => {
    const contactId = await createTestContact();
    await request(app)
      .get(`/api/v1/contacts/${contactId}/champion-blocker`)
      .set('Cookie', otherRepCookie)
      .expect(403);
  });
});

describe('POST /api/v1/contacts/:id/champion-blocker/dismiss', () => {
  it('marks the classification as dismissed', async () => {
    const contactId = await createTestContact();
    const res = await request(app)
      .post(`/api/v1/contacts/${contactId}/champion-blocker/dismiss`)
      .set('Cookie', repCookie)
      .expect(200);

    expect(res.body.dismissed).toBe(true);
  });
});

describe('PATCH /api/v1/contacts/:id/champion-blocker/override', () => {
  it('returns 400 for an invalid status value', async () => {
    const contactId = await createTestContact();
    await request(app)
      .patch(`/api/v1/contacts/${contactId}/champion-blocker/override`)
      .set('Cookie', repCookie)
      .send({ status: 'not-a-real-status' })
      .expect(400);
  });

  it('persists a valid override with a reason', async () => {
    const contactId = await createTestContact();
    const res = await request(app)
      .patch(`/api/v1/contacts/${contactId}/champion-blocker/override`)
      .set('Cookie', repCookie)
      .send({ status: 'blocker', reason: 'Direct conflict of interest observed' })
      .expect(200);

    expect(res.body.status).toBe('blocker');
    expect(res.body.is_overridden).toBe(true);
  });
});

describe('GET /api/v1/deals/:id/stakeholder-map', () => {
  it('returns an empty stakeholder map for a deal with no linked contacts', async () => {
    const deal = await createDeal(
      {
        name: 'Stakeholder Map Deal',
        stage: 'Prospecting',
        pipeline_id: defaultPipelineId,
        owner_id: repId,
      },
      { id: repId, name: 'Champion Blocker Rep' },
    );
    const res = await request(app)
      .get(`/api/v1/deals/${deal.id}/stakeholder-map`)
      .set('Cookie', repCookie)
      .expect(200);

    expect(res.body.contacts).toEqual([]);
    expect(res.body.single_threaded_risk).toBe(false);

    await pool.query('DELETE FROM deals WHERE id = $1', [deal.id]);
  });

  it('returns 404 for a non-existent deal', async () => {
    await request(app)
      .get('/api/v1/deals/00000000-0000-0000-0000-000000000000/stakeholder-map')
      .set('Cookie', repCookie)
      .expect(404);
  });

  it('returns 403 when a rep requests a stakeholder map for a deal owned by another rep', async () => {
    const deal = await createDeal(
      {
        name: 'Cross-Owner Stakeholder Map Deal',
        stage: 'Prospecting',
        pipeline_id: defaultPipelineId,
        owner_id: repId,
      },
      { id: repId, name: 'Champion Blocker Rep' },
    );

    await request(app)
      .get(`/api/v1/deals/${deal.id}/stakeholder-map`)
      .set('Cookie', otherRepCookie)
      .expect(403);

    await pool.query('DELETE FROM deals WHERE id = $1', [deal.id]);
  });
});
