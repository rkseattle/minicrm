/**
 * HTTP contract tests for data hygiene endpoints. (MINCRM-476)
 */

import 'dotenv/config';
import request from 'supertest';
import app from '../app.js';
import { createUser } from '../services/userService.js';
import { createContact, findContactById } from '../services/contactService.js';
import { createAccount } from '../services/accountService.js';
import pool from '../db.js';
import { makeAuthCookie, uid } from './testUtils.js';
import { runDataHygieneScan, listHygieneFindings } from '../services/dataHygieneService.js';

const FILE_PREFIX = 'hygiene-ctrl';

let repCookie: string;
let repId: string;
let otherRepId: string;
let adminCookie: string;

async function cleanup(): Promise<void> {
  await pool.query(
    `DELETE FROM data_hygiene_findings WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)`,
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
}

beforeAll(async () => {
  await cleanup();
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);

  const rep = await createUser({
    email: `${FILE_PREFIX}-rep@example.com`,
    name: 'Hygiene Rep',
    role: 'rep',
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  repId = rep.id;
  repCookie = makeAuthCookie({ id: rep.id, email: rep.email, role: rep.role, name: rep.name });

  const otherRep = await createUser({
    email: `${FILE_PREFIX}-other-rep@example.com`,
    name: 'Other Hygiene Rep',
    role: 'rep',
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  otherRepId = otherRep.id;

  const admin = await createUser({
    email: `${FILE_PREFIX}-admin@example.com`,
    name: 'Hygiene Admin',
    role: 'admin',
    passwordHash: '$2b$12$placeholder',
    status: 'active',
  });
  adminCookie = makeAuthCookie({
    id: admin.id,
    email: admin.email,
    role: admin.role,
    name: admin.name,
  });
});

afterAll(async () => {
  await cleanup();
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
});

describe('GET /api/v1/data-hygiene/findings', () => {
  it('returns 401 without authentication', async () => {
    await request(app).get('/api/v1/data-hygiene/findings').expect(401);
  });

  it('scope=mine (default) returns only the caller’s own findings', async () => {
    const myContact = await createContact({
      first_name: 'My',
      last_name: 'Contact',
      email: `${FILE_PREFIX}-${uid()}-my@example.com`,
      owner_id: repId,
    });
    const otherContact = await createContact({
      first_name: 'Other',
      last_name: 'Contact',
      email: `${FILE_PREFIX}-${uid()}-other@example.com`,
      owner_id: otherRepId,
    });

    await runDataHygieneScan();

    const res = await request(app)
      .get('/api/v1/data-hygiene/findings')
      .set('Cookie', repCookie)
      .expect(200);

    const entityIds = (res.body.findings as Array<{ entity_id: string }>).map((f) => f.entity_id);
    expect(entityIds).toContain(myContact.id);
    expect(entityIds).not.toContain(otherContact.id);
  });

  it('returns 403 when a non-admin requests scope=all', async () => {
    await request(app)
      .get('/api/v1/data-hygiene/findings?scope=all')
      .set('Cookie', repCookie)
      .expect(403);
  });

  it('allows an admin to request scope=all', async () => {
    await request(app)
      .get('/api/v1/data-hygiene/findings?scope=all')
      .set('Cookie', adminCookie)
      .expect(200);
  });
});

describe('POST /api/v1/data-hygiene/findings/:id/dismiss', () => {
  it('returns 400 without a reason', async () => {
    const contact = await createContact({
      first_name: 'Dismiss',
      last_name: 'Test',
      email: `${FILE_PREFIX}-${uid()}-dismiss-test@example.com`,
      owner_id: repId,
    });
    await runDataHygieneScan();
    const findings = await listHygieneFindings(repId);
    const finding = findings.find((f) => f.entity_id === contact.id)!;

    await request(app)
      .post(`/api/v1/data-hygiene/findings/${finding.id}/dismiss`)
      .set('Cookie', repCookie)
      .send({})
      .expect(400);
  });

  it('dismisses a finding with a reason', async () => {
    const contact = await createContact({
      first_name: 'Dismiss',
      last_name: 'Ok',
      email: `${FILE_PREFIX}-${uid()}-dismiss-ok@example.com`,
      owner_id: repId,
    });
    await runDataHygieneScan();
    const findings = await listHygieneFindings(repId);
    const finding = findings.find((f) => f.entity_id === contact.id)!;

    await request(app)
      .post(`/api/v1/data-hygiene/findings/${finding.id}/dismiss`)
      .set('Cookie', repCookie)
      .send({ reason: 'Will fix later' })
      .expect(200);
  });

  it('returns 404 for a non-existent finding', async () => {
    await request(app)
      .post('/api/v1/data-hygiene/findings/00000000-0000-0000-0000-000000000000/dismiss')
      .set('Cookie', repCookie)
      .send({ reason: 'x' })
      .expect(404);
  });

  it('returns 404 (not 200) when a non-admin rep tries to dismiss another rep’s finding (IDOR guard)', async () => {
    const otherContact = await createContact({
      first_name: 'NotMine',
      last_name: 'ToDismiss',
      email: `${FILE_PREFIX}-${uid()}-not-mine-dismiss@example.com`,
      owner_id: otherRepId,
    });
    await runDataHygieneScan();
    const findings = await listHygieneFindings(otherRepId);
    const finding = findings.find((f) => f.entity_id === otherContact.id)!;

    await request(app)
      .post(`/api/v1/data-hygiene/findings/${finding.id}/dismiss`)
      .set('Cookie', repCookie)
      .send({ reason: 'Trying to dismiss someone else’s finding' })
      .expect(404);

    // Confirm it's genuinely untouched — the attempt must not have partially applied.
    const stillOpen = await listHygieneFindings(otherRepId);
    expect(stillOpen.some((f) => f.id === finding.id)).toBe(true);
  });

  it('allows an admin to dismiss a finding owned by another rep', async () => {
    const otherContact = await createContact({
      first_name: 'AdminDismiss',
      last_name: 'Allowed',
      email: `${FILE_PREFIX}-${uid()}-admin-dismiss@example.com`,
      owner_id: otherRepId,
    });
    await runDataHygieneScan();
    const findings = await listHygieneFindings(otherRepId);
    const finding = findings.find((f) => f.entity_id === otherContact.id)!;

    await request(app)
      .post(`/api/v1/data-hygiene/findings/${finding.id}/dismiss`)
      .set('Cookie', adminCookie)
      .send({ reason: 'Admin override' })
      .expect(200);
  });
});

describe('POST /api/v1/data-hygiene/findings/clear/:entityType/:entityId', () => {
  it('returns 403 when a non-admin rep tries to clear another rep’s findings (IDOR guard)', async () => {
    const otherContact = await createContact({
      first_name: 'NotMine',
      last_name: 'ToClear',
      email: `${FILE_PREFIX}-${uid()}-not-mine-clear@example.com`,
      owner_id: otherRepId,
    });
    await runDataHygieneScan();
    const findings = await listHygieneFindings(otherRepId);
    expect(findings.some((f) => f.entity_id === otherContact.id)).toBe(true);

    await request(app)
      .post(`/api/v1/data-hygiene/findings/clear/contact/${otherContact.id}`)
      .set('Cookie', repCookie)
      .expect(403);

    const stillThere = await listHygieneFindings(otherRepId);
    expect(stillThere.some((f) => f.entity_id === otherContact.id)).toBe(true);
  });

  it('allows a rep to clear findings for their own record', async () => {
    const myContact = await createContact({
      first_name: 'Mine',
      last_name: 'ToClear',
      email: `${FILE_PREFIX}-${uid()}-mine-clear@example.com`,
      owner_id: repId,
    });
    await runDataHygieneScan();

    await request(app)
      .post(`/api/v1/data-hygiene/findings/clear/contact/${myContact.id}`)
      .set('Cookie', repCookie)
      .expect(200);
  });
});

describe('GET/PATCH /api/v1/admin/ai/data-hygiene-config', () => {
  it('returns 403 for a non-admin', async () => {
    await request(app)
      .get('/api/v1/admin/ai/data-hygiene-config')
      .set('Cookie', repCookie)
      .expect(403);
  });

  it('allows an admin to read the current configuration', async () => {
    const res = await request(app)
      .get('/api/v1/admin/ai/data-hygiene-config')
      .set('Cookie', adminCookie)
      .expect(200);

    expect(res.body).toHaveProperty('contact_inactivity_days');
  });

  it('allows an admin to persist a valid configuration update', async () => {
    const res = await request(app)
      .patch('/api/v1/admin/ai/data-hygiene-config')
      .set('Cookie', adminCookie)
      .send({
        contact_inactivity_days: 200,
        account_inactivity_days: 365,
        title_staleness_days: 1095,
        opportunity_inactivity_days: 30,
        dismiss_suppression_days: 90,
        weekly_digest_enabled: false,
      })
      .expect(200);

    expect(res.body.contact_inactivity_days).toBe(200);

    // Restore default for subsequent test runs.
    await request(app)
      .patch('/api/v1/admin/ai/data-hygiene-config')
      .set('Cookie', adminCookie)
      .send({
        contact_inactivity_days: 365,
        account_inactivity_days: 365,
        title_staleness_days: 1095,
        opportunity_inactivity_days: 30,
        dismiss_suppression_days: 90,
        weekly_digest_enabled: false,
      })
      .expect(200);
  });
});

describe('POST /api/v1/admin/ai/data-hygiene/run', () => {
  it('returns 403 for a non-admin', async () => {
    await request(app)
      .post('/api/v1/admin/ai/data-hygiene/run')
      .set('Cookie', repCookie)
      .expect(403);
  });

  it('accepts the request and returns 202 for an admin', async () => {
    const res = await request(app)
      .post('/api/v1/admin/ai/data-hygiene/run')
      .set('Cookie', adminCookie)
      .expect(202);

    expect(res.body.accepted).toBe(true);
  });
});

describe('POST /api/v1/data-hygiene/findings/merge-contacts', () => {
  async function createFlaggedDuplicatePair(
    ownerId: string,
  ): Promise<{ winnerId: string; loserId: string }> {
    const account = await createAccount({
      name: `${FILE_PREFIX} Merge Co ${uid()}`,
      owner_id: ownerId,
    });
    const contactA = await createContact({
      first_name: 'Merge',
      last_name: 'Candidate',
      email: `${FILE_PREFIX}-${uid()}-merge-a@example.com`,
      account_id: account.id,
      owner_id: ownerId,
    });
    const contactB = await createContact({
      first_name: 'Merge',
      last_name: 'Candidate',
      email: `${FILE_PREFIX}-${uid()}-merge-b@example.com`,
      account_id: account.id,
      owner_id: ownerId,
    });
    await runDataHygieneScan();
    return { winnerId: contactA.id, loserId: contactB.id };
  }

  it('returns 403 when a non-admin rep tries to merge a duplicate pair they do not own (IDOR guard)', async () => {
    const { winnerId, loserId } = await createFlaggedDuplicatePair(otherRepId);

    await request(app)
      .post('/api/v1/data-hygiene/findings/merge-contacts')
      .set('Cookie', repCookie)
      .send({ winnerId, loserId })
      .expect(403);

    // Neither contact should have been touched by the rejected attempt.
    expect(await findContactById(winnerId)).not.toBeNull();
    expect(await findContactById(loserId)).not.toBeNull();
  });

  it('allows a rep to merge a duplicate pair they own', async () => {
    const { winnerId, loserId } = await createFlaggedDuplicatePair(repId);

    await request(app)
      .post('/api/v1/data-hygiene/findings/merge-contacts')
      .set('Cookie', repCookie)
      .send({ winnerId, loserId })
      .expect(200);

    expect(await findContactById(loserId)).toBeNull();
  });

  it('allows an admin to merge a pair they do not own', async () => {
    const { winnerId, loserId } = await createFlaggedDuplicatePair(otherRepId);

    await request(app)
      .post('/api/v1/data-hygiene/findings/merge-contacts')
      .set('Cookie', adminCookie)
      .send({ winnerId, loserId })
      .expect(200);

    expect(await findContactById(loserId)).toBeNull();
  });
});
