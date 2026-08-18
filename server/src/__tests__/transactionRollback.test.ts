/**
 * Transaction rollback tests.
 *
 * Verifies that mid-transaction failures leave the database in a clean state.
 * Each test injects an error after one or more mutations have been written,
 * then asserts no trace of the operation remains in the DB.
 *
 * No production code is modified — failures are injected via vi.spyOn mocks.
 */

import 'dotenv/config';
import { vi } from 'vitest';
import { createContact } from '../services/contactService.js';
import { createDeal } from '../services/dealService.js';
import { convertLead, createLead } from '../services/leadsService.js';
import * as auditService from '../services/auditService.js';
import { createUser } from '../services/userService.js';
import pool from '../db.js';
import { uid } from './testUtils.js';

const OWNER_USER = {
  email: 'rollback-owner@example.com',
  name: 'Rollback Owner',
  role: 'rep' as const,
  passwordHash: '$2b$12$placeholder_hash',
  status: 'active' as const,
};

let ownerId: string;
let accountId: string;

beforeAll(async () => {
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
  await pool.query('DELETE FROM leads WHERE owner_id IN (SELECT id FROM users WHERE email = $1)', [
    OWNER_USER.email,
  ]);
  await pool.query('DELETE FROM users WHERE email = $1', [OWNER_USER.email]);

  const owner = await createUser(OWNER_USER);
  ownerId = owner.id;

  const acct = await pool.query<{ id: string }>(
    `INSERT INTO accounts (name, owner_id) VALUES ($1, $2) RETURNING id`,
    ['Rollback Test Account', ownerId],
  );
  accountId = acct.rows[0].id;
});

beforeEach(async () => {
  await pool.query(
    'DELETE FROM deal_contacts WHERE deal_id IN (SELECT id FROM deals WHERE owner_id = $1)',
    [ownerId],
  );
  await pool.query('DELETE FROM leads WHERE owner_id = $1', [ownerId]);
  await pool.query('DELETE FROM deals WHERE owner_id = $1', [ownerId]);
  await pool.query('DELETE FROM contacts WHERE owner_id = $1', [ownerId]);
});

afterAll(async () => {
  await pool.query(
    'DELETE FROM deal_contacts WHERE deal_id IN (SELECT id FROM deals WHERE owner_id = $1)',
    [ownerId],
  );
  await pool.query('DELETE FROM leads WHERE owner_id = $1', [ownerId]);
  await pool.query('DELETE FROM deals WHERE owner_id = $1', [ownerId]);
  await pool.query('DELETE FROM contacts WHERE owner_id = $1', [ownerId]);
  await pool.query('DELETE FROM accounts WHERE id = $1', [accountId]);
  await pool.query('DELETE FROM users WHERE email = $1', [OWNER_USER.email]);
});

// ── Contact creation rollback ──────────────────────────────────────────────────

describe('contact creation rollback', () => {
  it('rolls back the contact INSERT when writeAuditEntry throws mid-transaction', async () => {
    const testEmail = `rollback-${uid()}-contact@example.com`;

    const auditSpy = vi
      .spyOn(auditService, 'writeAuditEntry')
      .mockRejectedValueOnce(new Error('Injected audit failure'));

    try {
      await expect(
        createContact({
          first_name: 'Roll',
          last_name: 'Back',
          email: testEmail,
          owner_id: ownerId,
        }),
      ).rejects.toThrow();
    } finally {
      auditSpy.mockRestore();
    }

    const result = await pool.query('SELECT id FROM contacts WHERE email = $1', [testEmail]);
    expect(result.rows).toHaveLength(0);
  });
});

// ── Deal creation rollback ─────────────────────────────────────────────────────

describe('deal creation rollback', () => {
  it('rolls back the deal INSERT when writeAuditEntry throws mid-transaction', async () => {
    const testName = 'Rollback Deal MINCRM-249';

    const auditSpy = vi
      .spyOn(auditService, 'writeAuditEntry')
      .mockRejectedValueOnce(new Error('Injected audit failure'));

    try {
      await expect(
        createDeal({
          name: testName,
          stage: 'Prospecting',
          owner_id: ownerId,
          account_id: accountId,
        }),
      ).rejects.toThrow();
    } finally {
      auditSpy.mockRestore();
    }

    const result = await pool.query('SELECT id FROM deals WHERE name = $1', [testName]);
    expect(result.rows).toHaveLength(0);
  });
});

// ── Lead conversion rollback ───────────────────────────────────────────────────

describe('lead conversion rollback', () => {
  it('rolls back account and deal when the contact INSERT violates the unique email constraint', async () => {
    // Pre-insert a contact with the email we'll use for conversion.
    // When convertLead tries to INSERT the contact with the same email, the
    // DB unique constraint (migration 034) fires mid-transaction — after the
    // account INSERT but before the deal INSERT.  The ROLLBACK must leave
    // the DB with no new account and no new deal.
    const conflictEmail = `convert-${uid()}-conflict@example.com`;
    await pool.query(
      `INSERT INTO contacts (first_name, last_name, email, owner_id)
       VALUES ('Pre', 'Existing', $1, $2)`,
      [conflictEmail, ownerId],
    );

    const testAccountName = 'Rollback Conversion Account MINCRM-249';
    const testDealName = 'Rollback Conversion Deal MINCRM-249';

    const lead = await createLead(
      {
        first_name: 'Convert',
        last_name: 'Rollback',
        email: `convert-${uid()}-lead-rollback@example.com`,
        owner_id: ownerId,
      },
      { id: ownerId, name: OWNER_USER.name },
    );

    await expect(
      convertLead(
        lead.id,
        {
          // The contact INSERT will fail with 23505 because conflictEmail already exists
          contact: { first_name: 'Convert', last_name: 'Rollback', email: conflictEmail },
          account: { mode: 'create', name: testAccountName },
          deal: { name: testDealName, stage: 'Prospecting' },
        },
        { id: ownerId, name: OWNER_USER.name },
      ),
    ).rejects.toThrow();

    // Verify ROLLBACK was effective — no account or deal should have been committed
    const accountResult = await pool.query('SELECT id FROM accounts WHERE name = $1', [
      testAccountName,
    ]);
    expect(accountResult.rows).toHaveLength(0);

    const dealResult = await pool.query('SELECT id FROM deals WHERE name = $1', [testDealName]);
    expect(dealResult.rows).toHaveLength(0);
  });
});
