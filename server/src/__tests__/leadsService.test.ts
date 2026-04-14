/**
 * Integration tests for leadsService.
 *
 * Runs against a real PostgreSQL test database.
 * A single test user is created in beforeAll and reused as owner_id.
 * The leads and lead_status_history tables are truncated before each test.
 *
 * Run: npm test (from /server)
 * (MINCRM-173, MINCRM-174, MINCRM-175)
 */

import 'dotenv/config';
import {
  createLead,
  findLeadByEmail,
  findLeadById,
  listLeads,
  updateLead,
  deleteLead,
  getLeadStatusHistory,
  convertLead,
} from '../services/leadsService.js';
import { findContactById } from '../services/contactService.js';
import { createUser } from '../services/userService.js';
import pool from '../db.js';

const OWNER_USER = {
  email: 'leads-test-owner@example.com',
  name: 'Leads Test Owner',
  role: 'rep' as const,
  passwordHash: '$2b$12$placeholder_hash',
  status: 'active' as const,
};

const BASE_LEAD = {
  first_name: 'Dana',
  last_name: 'Kim',
  email: 'dana.kim@example.com',
  phone: '+1-555-0200',
  company_name: 'Acme Corp',
  lead_source: 'Web' as const,
  notes: 'Found via website',
};

let ownerId: string;

beforeAll(async () => {
  // Clean up any leftover state from prior failed runs
  await pool.query('DELETE FROM leads WHERE owner_id IN (SELECT id FROM users WHERE email = $1)', [
    OWNER_USER.email,
  ]);
  await pool.query(
    'DELETE FROM contacts WHERE owner_id IN (SELECT id FROM users WHERE email = $1)',
    [OWNER_USER.email],
  );
  await pool.query('DELETE FROM deals WHERE owner_id IN (SELECT id FROM users WHERE email = $1)', [
    OWNER_USER.email,
  ]);
  await pool.query(
    'DELETE FROM accounts WHERE owner_id IN (SELECT id FROM users WHERE email = $1)',
    [OWNER_USER.email],
  );
  await pool.query('DELETE FROM users WHERE email = $1', [OWNER_USER.email]);

  const owner = await createUser(OWNER_USER);
  ownerId = owner.id;
});

beforeEach(async () => {
  await pool.query(
    'DELETE FROM deal_contacts WHERE deal_id IN (SELECT id FROM deals WHERE owner_id = $1)',
    [ownerId],
  );
  await pool.query('DELETE FROM deals WHERE owner_id = $1', [ownerId]);
  await pool.query('DELETE FROM contacts WHERE owner_id = $1', [ownerId]);
  await pool.query('DELETE FROM accounts WHERE owner_id = $1', [ownerId]);
  await pool.query(
    'DELETE FROM lead_status_history WHERE lead_id IN (SELECT id FROM leads WHERE owner_id = $1)',
    [ownerId],
  );
  await pool.query('DELETE FROM leads WHERE owner_id = $1', [ownerId]);
});

afterAll(async () => {
  await pool.query(
    'DELETE FROM deal_contacts WHERE deal_id IN (SELECT id FROM deals WHERE owner_id = $1)',
    [ownerId],
  );
  await pool.query('DELETE FROM deals WHERE owner_id = $1', [ownerId]);
  await pool.query('DELETE FROM contacts WHERE owner_id = $1', [ownerId]);
  await pool.query('DELETE FROM accounts WHERE owner_id = $1', [ownerId]);
  await pool.query(
    'DELETE FROM lead_status_history WHERE lead_id IN (SELECT id FROM leads WHERE owner_id = $1)',
    [ownerId],
  );
  await pool.query('DELETE FROM leads WHERE owner_id = $1', [ownerId]);
  await pool.query('DELETE FROM users WHERE email = $1', [OWNER_USER.email]);
  await pool.end();
});

// ── createLead ──────────────────────────────────────────────────────────────

describe('createLead', () => {
  it('inserts a lead and returns the full row', async () => {
    const lead = await createLead({ ...BASE_LEAD, owner_id: ownerId });

    expect(lead.id).toBeDefined();
    expect(lead.first_name).toBe('Dana');
    expect(lead.last_name).toBe('Kim');
    expect(lead.email).toBe('dana.kim@example.com');
    expect(lead.company_name).toBe('Acme Corp');
    expect(lead.lead_source).toBe('Web');
    expect(lead.status).toBe('New');
    expect(lead.owner_id).toBe(ownerId);
    expect(lead.converted_at).toBeNull();
  });

  it('lowercases the email', async () => {
    const lead = await createLead({
      ...BASE_LEAD,
      email: 'DANA.KIM@EXAMPLE.COM',
      owner_id: ownerId,
    });
    expect(lead.email).toBe('dana.kim@example.com');
  });

  it('writes an initial status history entry', async () => {
    const lead = await createLead({ ...BASE_LEAD, owner_id: ownerId });
    const history = await getLeadStatusHistory(lead.id);

    expect(history).toHaveLength(1);
    expect(history[0].from_status).toBeNull();
    expect(history[0].to_status).toBe('New');
  });
});

// ── findLeadByEmail ──────────────────────────────────────────────────────────

describe('findLeadByEmail', () => {
  it('returns the lead when found (case-insensitive)', async () => {
    await createLead({ ...BASE_LEAD, owner_id: ownerId });
    const found = await findLeadByEmail('DANA.KIM@EXAMPLE.COM');
    expect(found).not.toBeNull();
    expect(found!.email).toBe('dana.kim@example.com');
  });

  it('returns null when no match', async () => {
    const found = await findLeadByEmail('nobody@example.com');
    expect(found).toBeNull();
  });

  it('excludes the given id when excludeId is passed', async () => {
    const lead = await createLead({ ...BASE_LEAD, owner_id: ownerId });
    const found = await findLeadByEmail(lead.email, lead.id);
    expect(found).toBeNull();
  });
});

// ── listLeads ────────────────────────────────────────────────────────────────

describe('listLeads', () => {
  it('returns paginated leads, excluding Disqualified and converted by default', async () => {
    await createLead({ ...BASE_LEAD, owner_id: ownerId });
    await createLead({ ...BASE_LEAD, email: 'disq@example.com', owner_id: ownerId });

    // Disqualify the second lead
    const disqLead = await findLeadByEmail('disq@example.com');
    await updateLead(disqLead!.id, { status: 'Disqualified' }, { id: ownerId, name: 'Tester' });

    const result = await listLeads({ ownerId });
    expect(result.total).toBe(1);
    expect(result.data[0].email).toBe('dana.kim@example.com');
  });

  it('includes Disqualified leads when includeDisqualified=true', async () => {
    await createLead({ ...BASE_LEAD, owner_id: ownerId });
    await createLead({ ...BASE_LEAD, email: 'disq@example.com', owner_id: ownerId });
    const disqLead = await findLeadByEmail('disq@example.com');
    await updateLead(disqLead!.id, { status: 'Disqualified' }, { id: ownerId, name: 'Tester' });

    const result = await listLeads({ ownerId, includeDisqualified: true });
    expect(result.total).toBe(2);
  });

  it('filters by status', async () => {
    await createLead({ ...BASE_LEAD, owner_id: ownerId });
    await createLead({ ...BASE_LEAD, email: 'contacted@example.com', owner_id: ownerId });
    const contactedLead = await findLeadByEmail('contacted@example.com');
    await updateLead(contactedLead!.id, { status: 'Contacted' }, { id: ownerId, name: 'Tester' });

    const result = await listLeads({ status: 'Contacted' });
    expect(result.data.every((l) => l.status === 'Contacted')).toBe(true);
  });
});

// ── updateLead (MINCRM-174) ──────────────────────────────────────────────────

describe('updateLead — status lifecycle', () => {
  it('writes a status history entry when status changes', async () => {
    const lead = await createLead({ ...BASE_LEAD, owner_id: ownerId });
    await updateLead(lead.id, { status: 'Contacted' }, { id: ownerId, name: 'Tester' });

    const history = await getLeadStatusHistory(lead.id);
    expect(history).toHaveLength(2);
    expect(history[1].from_status).toBe('New');
    expect(history[1].to_status).toBe('Contacted');
  });

  it('does not write a history entry when status is unchanged', async () => {
    const lead = await createLead({ ...BASE_LEAD, owner_id: ownerId });
    await updateLead(lead.id, { first_name: 'Updated' }, { id: ownerId, name: 'Tester' });

    const history = await getLeadStatusHistory(lead.id);
    expect(history).toHaveLength(1); // only the initial New entry
  });

  it('can set disqualification_reason when Disqualifying', async () => {
    const lead = await createLead({ ...BASE_LEAD, owner_id: ownerId });
    const updated = await updateLead(
      lead.id,
      { status: 'Disqualified', disqualification_reason: 'Not a fit' },
      { id: ownerId, name: 'Tester' },
    );
    expect(updated!.disqualification_reason).toBe('Not a fit');
  });
});

// ── deleteLead ───────────────────────────────────────────────────────────────

describe('deleteLead', () => {
  it('removes the lead and returns the deleted row', async () => {
    const lead = await createLead({ ...BASE_LEAD, owner_id: ownerId });
    const deleted = await deleteLead(lead.id);
    expect(deleted!.id).toBe(lead.id);

    const notFound = await findLeadById(lead.id);
    expect(notFound).toBeNull();
  });

  it('returns null when lead does not exist', async () => {
    const result = await deleteLead('00000000-0000-0000-0000-000000000000');
    expect(result).toBeNull();
  });
});

// ── convertLead (MINCRM-175) ─────────────────────────────────────────────────

describe('convertLead', () => {
  it('atomically creates contact, account, and deal from a lead', async () => {
    const lead = await createLead({ ...BASE_LEAD, owner_id: ownerId });

    const result = await convertLead(
      lead.id,
      {
        contact: {
          first_name: lead.first_name,
          last_name: lead.last_name ?? undefined,
          email: lead.email,
          phone: lead.phone ?? undefined,
        },
        account: { mode: 'create', name: 'Acme Corp' },
        deal: { name: 'Acme Corp — Opportunity', stage: 'Prospecting' },
      },
      { id: ownerId, name: 'Tester' },
    );

    expect(result.contact_id).toBeDefined();
    expect(result.account_id).toBeDefined();
    expect(result.deal_id).toBeDefined();

    // Lead is marked as converted
    const updatedLead = await findLeadById(lead.id);
    expect(updatedLead!.converted_at).not.toBeNull();
    expect(updatedLead!.converted_contact_id).toBe(result.contact_id);
    expect(updatedLead!.status).toBe('Qualified');

    // Contact has source_lead_id set
    const contact = await findContactById(result.contact_id);
    expect((contact as unknown as { source_lead_id: string }).source_lead_id).toBe(lead.id);
  });

  it('throws ALREADY_CONVERTED when lead is already converted', async () => {
    const lead = await createLead({ ...BASE_LEAD, owner_id: ownerId });
    const convInput = {
      contact: { first_name: lead.first_name, email: lead.email },
      account: { mode: 'create' as const, name: 'Acme' },
      deal: { name: 'Acme — Opp' },
    };

    await convertLead(lead.id, convInput, { id: ownerId, name: 'Tester' });

    await expect(
      convertLead(lead.id, convInput, { id: ownerId, name: 'Tester' }),
    ).rejects.toMatchObject({
      code: 'ALREADY_CONVERTED',
    });
  });

  it('throws DISQUALIFIED when lead status is Disqualified', async () => {
    const lead = await createLead({ ...BASE_LEAD, owner_id: ownerId });
    await updateLead(lead.id, { status: 'Disqualified' }, { id: ownerId, name: 'Tester' });

    await expect(
      convertLead(
        lead.id,
        {
          contact: { first_name: lead.first_name, email: lead.email },
          account: { mode: 'create', name: 'Acme' },
          deal: { name: 'Acme — Opp' },
        },
        { id: ownerId, name: 'Tester' },
      ),
    ).rejects.toMatchObject({ code: 'DISQUALIFIED' });
  });

  it('links to an existing account instead of creating one', async () => {
    const lead = await createLead({ ...BASE_LEAD, owner_id: ownerId });

    // Create an account first
    const acctResult = await pool.query<{ id: string }>(
      `INSERT INTO accounts (name, owner_id) VALUES ($1, $2) RETURNING id`,
      ['Existing Corp', ownerId],
    );
    const existingAccountId = acctResult.rows[0].id;

    const result = await convertLead(
      lead.id,
      {
        contact: { first_name: lead.first_name, email: lead.email },
        account: { mode: 'link', account_id: existingAccountId },
        deal: { name: 'Existing Corp — Opp' },
      },
      { id: ownerId, name: 'Tester' },
    );

    expect(result.account_id).toBe(existingAccountId);
  });
});
