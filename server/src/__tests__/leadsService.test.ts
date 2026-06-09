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
  findLeadByContactId,
  findLeadByDealId,
  searchAccountsForConversion,
} from '../services/leadsService.js';
import { findContactById } from '../services/contactService.js';
import { createUser } from '../services/userService.js';
import { getDefaultPipelineId } from '../services/pipelineService.js';
import { convertLeadSchema } from '@minicrm/shared/schemas/leadSchema.js';
import pool from '../db.js';
import { uid } from './testUtils.js';

const FILE_PREFIX = 'leads-svc';

const OWNER_USER = {
  email: `${FILE_PREFIX}-owner@example.com`,
  name: 'Leads Test Owner',
  role: 'rep' as const,
  passwordHash: '$2b$12$placeholder_hash',
  status: 'active' as const,
};

const makeLead = () => ({
  first_name: 'Dana',
  last_name: 'Kim',
  email: `${FILE_PREFIX}-${uid()}-dana@example.com`,
  phone: '+1-555-0200',
  company_name: 'Acme Corp',
  lead_source: 'Web' as const,
  notes: 'Found via website',
});

let ownerId: string;
let defaultPipelineId: string;

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
  defaultPipelineId = await getDefaultPipelineId();
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
    const base = makeLead();
    const lead = await createLead({ ...base, owner_id: ownerId });

    expect(lead.id).toBeDefined();
    expect(lead.first_name).toBe('Dana');
    expect(lead.last_name).toBe('Kim');
    expect(lead.email).toBe(base.email);
    expect(lead.company_name).toBe('Acme Corp');
    expect(lead.lead_source).toBe('Web');
    expect(lead.status).toBe('New');
    expect(lead.owner_id).toBe(ownerId);
    expect(lead.converted_at).toBeNull();
  });

  it('lowercases the email', async () => {
    const rawEmail = `${FILE_PREFIX}-UPPER-${uid()}@EXAMPLE.COM`;
    const lead = await createLead({
      ...makeLead(),
      email: rawEmail,
      owner_id: ownerId,
    });
    expect(lead.email).toBe(rawEmail.toLowerCase());
  });

  it('writes an initial status history entry', async () => {
    const lead = await createLead({ ...makeLead(), owner_id: ownerId });
    const history = await getLeadStatusHistory(lead.id);

    expect(history).toHaveLength(1);
    expect(history[0].from_status).toBeNull();
    expect(history[0].to_status).toBe('New');
  });
});

// ── findLeadByEmail ──────────────────────────────────────────────────────────

describe('findLeadByEmail', () => {
  it('returns the lead when found (case-insensitive)', async () => {
    const base = makeLead();
    await createLead({ ...base, owner_id: ownerId });
    const found = await findLeadByEmail(base.email.toUpperCase());
    expect(found).not.toBeNull();
    expect(found!.email).toBe(base.email);
  });

  it('returns null when no match', async () => {
    const found = await findLeadByEmail('nobody@example.com');
    expect(found).toBeNull();
  });

  it('excludes the given id when excludeId is passed', async () => {
    const lead = await createLead({ ...makeLead(), owner_id: ownerId });
    const found = await findLeadByEmail(lead.email, lead.id);
    expect(found).toBeNull();
  });
});

// ── listLeads ────────────────────────────────────────────────────────────────

describe('listLeads', () => {
  it('returns paginated leads, excluding Disqualified and converted by default', async () => {
    const mainLead = await createLead({ ...makeLead(), owner_id: ownerId });
    const disqLead = await createLead({ ...makeLead(), owner_id: ownerId });

    await updateLead(
      disqLead.id,
      { status: 'Disqualified', version: disqLead.version },
      { id: ownerId, name: 'Tester' },
    );

    const result = await listLeads({ ownerId });
    expect(result.total).toBe(1);
    expect(result.data[0].id).toBe(mainLead.id);
  });

  it('includes Disqualified leads when includeDisqualified=true', async () => {
    const mainLead = await createLead({ ...makeLead(), owner_id: ownerId });
    const disqLead = await createLead({ ...makeLead(), owner_id: ownerId });
    await updateLead(
      disqLead.id,
      { status: 'Disqualified', version: disqLead.version },
      { id: ownerId, name: 'Tester' },
    );

    const result = await listLeads({ ownerId, includeDisqualified: true });
    expect(result.total).toBe(2);
    // Verify both IDs are present
    const ids = result.data.map((l) => l.id);
    expect(ids).toContain(mainLead.id);
    expect(ids).toContain(disqLead.id);
  });

  it('filters by status', async () => {
    await createLead({ ...makeLead(), owner_id: ownerId });
    const contactedLead = await createLead({ ...makeLead(), owner_id: ownerId });
    await updateLead(
      contactedLead.id,
      { status: 'Contacted', version: contactedLead.version },
      { id: ownerId, name: 'Tester' },
    );

    const result = await listLeads({ ownerId, status: 'Contacted' });
    expect(result.data.every((l) => l.status === 'Contacted')).toBe(true);
    expect(result.data.some((l) => l.id === contactedLead.id)).toBe(true);
  });
});

// ── updateLead (MINCRM-174) ──────────────────────────────────────────────────

describe('updateLead — status lifecycle', () => {
  it('writes a status history entry when status changes', async () => {
    const lead = await createLead({ ...makeLead(), owner_id: ownerId });
    await updateLead(
      lead.id,
      { status: 'Contacted', version: lead.version },
      { id: ownerId, name: 'Tester' },
    );

    const history = await getLeadStatusHistory(lead.id);
    expect(history).toHaveLength(2);
    expect(history[1].from_status).toBe('New');
    expect(history[1].to_status).toBe('Contacted');
  });

  it('does not write a history entry when status is unchanged', async () => {
    const lead = await createLead({ ...makeLead(), owner_id: ownerId });
    await updateLead(
      lead.id,
      { first_name: 'Updated', version: lead.version },
      { id: ownerId, name: 'Tester' },
    );

    const history = await getLeadStatusHistory(lead.id);
    expect(history).toHaveLength(1); // only the initial New entry
  });

  it('can set disqualification_reason when Disqualifying', async () => {
    const lead = await createLead({ ...makeLead(), owner_id: ownerId });
    const updated = await updateLead(
      lead.id,
      { status: 'Disqualified', disqualification_reason: 'Not a fit', version: lead.version },
      { id: ownerId, name: 'Tester' },
    );
    expect(updated!.disqualification_reason).toBe('Not a fit');
  });

  it('increments version on successful update', async () => {
    const lead = await createLead({ ...makeLead(), owner_id: ownerId });
    expect(lead.version).toBe(1);

    const updated = await updateLead(
      lead.id,
      { first_name: 'Versioned', version: lead.version },
      { id: ownerId, name: 'Tester' },
    );
    expect(updated!.version).toBe(2);
  });

  it('throws OPTIMISTIC_LOCK_CONFLICT when version is stale', async () => {
    const lead = await createLead({ ...makeLead(), owner_id: ownerId });

    await updateLead(
      lead.id,
      { first_name: 'First Writer', version: lead.version },
      { id: ownerId, name: 'Tester' },
    );

    await expect(
      updateLead(
        lead.id,
        { first_name: 'Second Writer', version: lead.version },
        { id: ownerId, name: 'Tester' },
      ),
    ).rejects.toMatchObject({ code: 'OPTIMISTIC_LOCK_CONFLICT' });
  });
});

// ── deleteLead ───────────────────────────────────────────────────────────────

describe('deleteLead', () => {
  it('removes the lead and returns the deleted row', async () => {
    const lead = await createLead({ ...makeLead(), owner_id: ownerId });
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
    const lead = await createLead({ ...makeLead(), owner_id: ownerId });

    const result = await convertLead(
      lead.id,
      {
        contact: {
          first_name: lead.first_name,
          last_name: lead.last_name!, // makeLead() always sets last_name: 'Kim'
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
    const lead = await createLead({ ...makeLead(), owner_id: ownerId });
    const convInput = {
      contact: {
        first_name: lead.first_name,
        last_name: lead.last_name ?? 'Lead',
        email: lead.email,
      },
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
    const lead = await createLead({ ...makeLead(), owner_id: ownerId });
    await updateLead(
      lead.id,
      { status: 'Disqualified', version: lead.version },
      { id: ownerId, name: 'Tester' },
    );

    await expect(
      convertLead(
        lead.id,
        {
          contact: {
            first_name: lead.first_name,
            last_name: lead.last_name ?? 'Lead',
            email: lead.email,
          },
          account: { mode: 'create', name: 'Acme' },
          deal: { name: 'Acme — Opp' },
        },
        { id: ownerId, name: 'Tester' },
      ),
    ).rejects.toMatchObject({ code: 'DISQUALIFIED' });
  });

  it('throws ACCOUNT_NOT_FOUND when linking to a non-existent account', async () => {
    const lead = await createLead({ ...makeLead(), owner_id: ownerId });

    await expect(
      convertLead(
        lead.id,
        {
          contact: {
            first_name: lead.first_name,
            last_name: lead.last_name ?? 'Lead',
            email: lead.email,
          },
          account: { mode: 'link', account_id: '00000000-0000-0000-0000-000000000000' },
          deal: { name: 'Opp' },
        },
        { id: ownerId, name: 'Tester' },
      ),
    ).rejects.toMatchObject({ code: 'ACCOUNT_NOT_FOUND' });
  });

  it('links to an existing account instead of creating one', async () => {
    const lead = await createLead({ ...makeLead(), owner_id: ownerId });

    // Create an account first
    const acctResult = await pool.query<{ id: string }>(
      `INSERT INTO accounts (name, owner_id) VALUES ($1, $2) RETURNING id`,
      ['Existing Corp', ownerId],
    );
    const existingAccountId = acctResult.rows[0].id;

    const result = await convertLead(
      lead.id,
      {
        contact: {
          first_name: lead.first_name,
          last_name: lead.last_name ?? 'Lead',
          email: lead.email,
        },
        account: { mode: 'link', account_id: existingAccountId },
        deal: { name: 'Existing Corp — Opp' },
      },
      { id: ownerId, name: 'Tester' },
    );

    expect(result.account_id).toBe(existingAccountId);
  });

  it('rejects conversion when last_name is empty (MINCRM-507)', () => {
    // Absent key → "Required"; empty string → our custom message. Both cases must fail.
    const absentParsed = convertLeadSchema.safeParse({
      contact: { first_name: 'Jane', email: 'jane@example.com' },
      account: { mode: 'create', name: 'Acme' },
      deal: { name: 'Acme — Opp' },
    });
    expect(absentParsed.success).toBe(false);

    const emptyParsed = convertLeadSchema.safeParse({
      contact: { first_name: 'Jane', last_name: '', email: 'jane@example.com' },
      account: { mode: 'create', name: 'Acme' },
      deal: { name: 'Acme — Opp' },
    });
    expect(emptyParsed.success).toBe(false);
    if (!emptyParsed.success) {
      expect(emptyParsed.error.errors[0].message).toMatch(/last name is required/i);
    }
  });
});

// ── listLeads — lead_source filter ──────────────────────────────────────────

describe('listLeads — lead_source filter', () => {
  it('filters by lead_source', async () => {
    const webLead = await createLead({
      ...makeLead(),
      lead_source: 'Web',
      owner_id: ownerId,
    });
    const refLead = await createLead({
      ...makeLead(),
      lead_source: 'Referral',
      owner_id: ownerId,
    });

    const result = await listLeads({ ownerId, lead_source: 'Referral' });
    expect(result.data.every((l) => l.lead_source === 'Referral')).toBe(true);
    expect(result.data.some((l) => l.id === refLead.id)).toBe(true);
    expect(result.data.some((l) => l.id === webLead.id)).toBe(false);
  });
});

// ── findLeadByContactId / findLeadByDealId ───────────────────────────────────

describe('findLeadByContactId', () => {
  it('returns the source lead for a converted contact', async () => {
    const lead = await createLead({
      ...makeLead(),
      owner_id: ownerId,
    });
    const result = await convertLead(
      lead.id,
      {
        contact: {
          first_name: lead.first_name,
          last_name: lead.last_name ?? 'Lead',
          email: lead.email,
        },
        account: { mode: 'create', name: 'Contact Test Corp' },
        deal: { name: 'Contact Test Opp' },
      },
      { id: ownerId, name: 'Tester' },
    );

    const found = await findLeadByContactId(result.contact_id);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(lead.id);
  });

  it('returns null when the contact has no source lead', async () => {
    const contactResult = await pool.query<{ id: string }>(
      `INSERT INTO contacts (first_name, last_name, email, owner_id) VALUES ($1, $2, $3, $4) RETURNING id`,
      ['No', 'Lead', `${FILE_PREFIX}-${uid()}-nolead@example.com`, ownerId],
    );
    const found = await findLeadByContactId(contactResult.rows[0].id);
    expect(found).toBeNull();
  });
});

describe('findLeadByDealId', () => {
  it('returns the source lead for a converted deal', async () => {
    const lead = await createLead({ ...makeLead(), owner_id: ownerId });
    const result = await convertLead(
      lead.id,
      {
        contact: {
          first_name: lead.first_name,
          last_name: lead.last_name ?? 'Lead',
          email: lead.email,
        },
        account: { mode: 'create', name: 'Deal Test Corp' },
        deal: { name: 'Deal Test Opp' },
      },
      { id: ownerId, name: 'Tester' },
    );

    const found = await findLeadByDealId(result.deal_id);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(lead.id);
  });

  it('returns null when the deal has no source lead', async () => {
    const acctResult = await pool.query<{ id: string }>(
      `INSERT INTO accounts (name, owner_id) VALUES ($1, $2) RETURNING id`,
      ['No Lead Corp', ownerId],
    );
    const stageIdForNoLead = (
      await pool.query<{ id: string }>(
        'SELECT id FROM pipeline_stages WHERE name = $1 AND pipeline_id = $2 LIMIT 1',
        ['Prospecting', defaultPipelineId],
      )
    ).rows[0].id;
    const dealResult = await pool.query<{ id: string }>(
      `INSERT INTO deals (name, stage, account_id, owner_id, pipeline_id, pipeline_stage_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [
        'No Lead Deal',
        'Prospecting',
        acctResult.rows[0].id,
        ownerId,
        defaultPipelineId,
        stageIdForNoLead,
      ],
    );
    const found = await findLeadByDealId(dealResult.rows[0].id);
    expect(found).toBeNull();
  });
});

// ── searchAccountsForConversion ──────────────────────────────────────────────

describe('searchAccountsForConversion', () => {
  it('returns accounts matching the query substring', async () => {
    await pool.query(`INSERT INTO accounts (name, owner_id) VALUES ($1, $2), ($3, $4)`, [
      'Acme Industries',
      ownerId,
      'Acme Holdings',
      ownerId,
    ]);

    const results = await searchAccountsForConversion('Acme');
    expect(results.length).toBeGreaterThanOrEqual(2);
    expect(results.every((r) => r.name.toLowerCase().includes('acme'))).toBe(true);
    expect(results[0]).toHaveProperty('id');
    expect(results[0]).toHaveProperty('name');
  });

  it('returns empty array when no accounts match', async () => {
    const results = await searchAccountsForConversion('zzznomatch99999');
    expect(results).toHaveLength(0);
  });
});

// ── Audit log coverage (MINCRM-382) ─────────────────────────────────────────────

const AUDIT_ACTOR = { id: '00000000-0000-0000-0000-000000000002', name: 'Lead Audit Actor' };

describe('audit log entries for leads (MINCRM-382)', () => {
  beforeEach(async () => {
    await pool.query('ALTER TABLE audit_log DISABLE TRIGGER audit_log_no_modify');
    await pool.query(`DELETE FROM audit_log WHERE changed_by_id = $1`, [AUDIT_ACTOR.id]);
    await pool.query('ALTER TABLE audit_log ENABLE TRIGGER audit_log_no_modify');
  });

  it('updateLead writes field-level audit entries in the transaction', async () => {
    const lead = await createLead(
      {
        first_name: 'Audit',
        last_name: 'Update',
        email: `lead-audit-update-${Date.now()}@example.com`,
        owner_id: ownerId,
      },
      AUDIT_ACTOR,
    );

    await updateLead(lead.id, { first_name: 'Updated', version: lead.version }, AUDIT_ACTOR);

    const result = await pool.query(
      `SELECT * FROM audit_log WHERE record_id = $1 AND changed_by_id = $2 AND event_type = 'updated'`,
      [lead.id, AUDIT_ACTOR.id],
    );
    expect(result.rows.length).toBeGreaterThan(0);
    const nameEntry = result.rows.find(
      (r: { field_name: string }) => r.field_name === 'first_name' || r.field_name === 'First Name',
    );
    expect(nameEntry).toBeDefined();
  });

  it('deleteLead writes an audit entry with event_type=deleted', async () => {
    const lead = await createLead(
      {
        first_name: 'Audit',
        last_name: 'Delete',
        email: `lead-audit-delete-${Date.now()}@example.com`,
        owner_id: ownerId,
      },
      AUDIT_ACTOR,
    );
    const leadId = lead.id;

    await deleteLead(leadId, AUDIT_ACTOR);

    await new Promise((r) => setTimeout(r, 50));

    const result = await pool.query(
      `SELECT * FROM audit_log WHERE record_id = $1 AND changed_by_id = $2 AND event_type = 'deleted'`,
      [leadId, AUDIT_ACTOR.id],
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].record_type).toBe('contact');
    expect(result.rows[0].record_name).toBe('Audit Delete');
  });
});
