/**
 * Demo data service.
 * Provides seed, remove, reset, and status operations for demo-flagged records.
 * All fixture data lives here — the CLI scripts (seed-demo.ts, remove-demo.ts) are
 * thin wrappers that call these functions. (MINCRM-102, MINCRM-103, MINCRM-206)
 */

import pool from '../db.js';
import type pg from 'pg';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const DEMO_ACCOUNTS = [
  {
    name: 'Acme Corporation',
    industry: 'Technology',
    website: 'https://www.acme-demo.example.com',
    employee_range: '201-500',
    revenue_range: '50M-100M',
    account_type: 'Customer',
  },
  {
    name: 'Globex Industries',
    industry: 'Manufacturing',
    website: 'https://www.globex-demo.example.com',
    employee_range: '51-200',
    revenue_range: '10M-50M',
    account_type: 'Prospect',
    // parent_account_id is set dynamically after Acme is inserted
  },
];

const DEMO_CONTACTS = [
  {
    first_name: 'Alice',
    last_name: 'Chen',
    email: 'alice.chen.demo@acme-demo.example.com',
    phone: '+1-555-0101',
    title: 'VP of Sales',
    department: 'Sales',
    linkedin_url: 'https://www.linkedin.com/in/alice-chen-demo',
  },
  {
    first_name: 'Bob',
    last_name: 'Martinez',
    email: 'bob.martinez.demo@acme-demo.example.com',
    phone: '+1-555-0102',
    title: 'Director of Engineering',
    department: 'Engineering',
  },
  {
    first_name: 'Carol',
    last_name: 'Johnson',
    email: 'carol.johnson.demo@acme-demo.example.com',
    phone: '+1-555-0103',
    title: 'CFO',
    department: 'Finance',
  },
  {
    first_name: 'David',
    last_name: 'Kim',
    email: 'david.kim.demo@acme-demo.example.com',
    phone: '+1-555-0104',
    title: 'Procurement Manager',
    department: 'Operations',
  },
  {
    first_name: 'Eva',
    last_name: 'Patel',
    email: 'eva.patel.demo@acme-demo.example.com',
    phone: '+1-555-0105',
    title: 'CTO',
    department: 'Technology',
  },
  {
    first_name: 'Frank',
    last_name: 'Nguyen',
    email: 'frank.nguyen.demo@acme-demo.example.com',
    phone: '+1-555-0106',
    title: 'Sales Manager',
    department: 'Sales',
  },
  {
    first_name: 'Grace',
    last_name: 'Lee',
    email: 'grace.lee.demo@acme-demo.example.com',
    phone: '+1-555-0107',
    title: 'Product Manager',
    department: 'Product',
  },
  {
    first_name: 'Henry',
    last_name: 'Brown',
    email: 'henry.brown.demo@acme-demo.example.com',
    phone: '+1-555-0108',
    title: 'IT Director',
    department: 'IT',
  },
  {
    first_name: 'Iris',
    last_name: 'Davis',
    email: 'iris.davis.demo@acme-demo.example.com',
    phone: '+1-555-0109',
    title: 'Marketing VP',
    department: 'Marketing',
  },
  {
    first_name: 'Jack',
    last_name: 'Wilson',
    email: 'jack.wilson.demo@acme-demo.example.com',
    phone: '+1-555-0110',
    title: 'CEO',
    department: 'Executive',
    linkedin_url: 'https://www.linkedin.com/in/jack-wilson-demo',
    twitter_x_url: 'https://twitter.com/jackwilsondemo',
  },
  {
    first_name: 'Karen',
    last_name: 'Taylor',
    email: 'karen.taylor.demo@globex-demo.example.com',
    phone: '+1-555-0201',
    title: 'Head of Procurement',
    department: 'Operations',
  },
  {
    first_name: 'Liam',
    last_name: 'Anderson',
    email: 'liam.anderson.demo@globex-demo.example.com',
    phone: '+1-555-0202',
    title: 'VP Engineering',
    department: 'Engineering',
  },
  {
    first_name: 'Mia',
    last_name: 'Thompson',
    email: 'mia.thompson.demo@globex-demo.example.com',
    phone: '+1-555-0203',
    title: 'Sales Director',
    department: 'Sales',
    linkedin_url: 'https://www.linkedin.com/in/mia-thompson-demo',
  },
  {
    first_name: 'Noah',
    last_name: 'Garcia',
    email: 'noah.garcia.demo@globex-demo.example.com',
    phone: '+1-555-0204',
    title: 'COO',
    department: 'Operations',
  },
  {
    first_name: 'Olivia',
    last_name: 'Miller',
    email: 'olivia.miller.demo@globex-demo.example.com',
    phone: '+1-555-0205',
    title: 'CFO',
    department: 'Finance',
  },
  {
    first_name: 'Paul',
    last_name: 'Moore',
    email: 'paul.moore.demo@globex-demo.example.com',
    phone: '+1-555-0206',
    title: 'IT Manager',
    department: 'IT',
  },
  {
    first_name: 'Quinn',
    last_name: 'Jackson',
    email: 'quinn.jackson.demo@globex-demo.example.com',
    phone: '+1-555-0207',
    title: 'CTO',
    department: 'Technology',
  },
  {
    first_name: 'Rachel',
    last_name: 'White',
    email: 'rachel.white.demo@globex-demo.example.com',
    phone: '+1-555-0208',
    title: 'Director of Marketing',
    department: 'Marketing',
  },
  {
    first_name: 'Sam',
    last_name: 'Harris',
    email: 'sam.harris.demo@globex-demo.example.com',
    phone: '+1-555-0209',
    title: 'Product Director',
    department: 'Product',
  },
  {
    first_name: 'Tina',
    last_name: 'Clark',
    email: 'tina.clark.demo@globex-demo.example.com',
    phone: '+1-555-0210',
    title: 'CEO',
    department: 'Executive',
    linkedin_url: 'https://www.linkedin.com/in/tina-clark-demo',
  },
];

// Contact index references for contact_addresses (MINCRM-206)
// Index 0 = Alice Chen (Acme), Index 10 = Karen Taylor (Globex)
const DEMO_CONTACT_ADDRESSES = [
  {
    contactIndex: 0,
    label: 'Work',
    address_line1: '100 Technology Drive',
    city: 'San Francisco',
    state_region: 'CA',
    postal_code: '94105',
    country: 'USA',
    is_default: true,
  },
  {
    contactIndex: 10,
    label: 'Work',
    address_line1: '500 Industrial Way',
    city: 'Chicago',
    state_region: 'IL',
    postal_code: '60601',
    country: 'USA',
    is_default: true,
  },
];

/**
 * Returns a YYYY-MM-DD string for a date offset by the given number of days from today.
 * Used to keep demo closed-deal dates within the current month so the Win/Loss report
 * shows data without the user needing to change the date filter.
 *
 * @param offsetDays - Positive = future, negative = past.
 */
function relativeDate(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

/**
 * Returns a fixed YYYY-MM-DD string for a date a given number of months in the future.
 * Used for open-deal close dates so the pipeline board looks realistic.
 *
 * @param monthsAhead - Number of months ahead of today.
 */
function futureMonths(monthsAhead: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() + monthsAhead);
  return d.toISOString().slice(0, 10);
}

const DEMO_DEALS = [
  {
    name: 'Acme — Enterprise Platform',
    stage: 'Qualification',
    value: 120000,
    close_date: futureMonths(3),
  },
  {
    name: 'Acme — Security Upgrade',
    stage: 'Proposal',
    value: 45000,
    close_date: futureMonths(2),
  },
  {
    name: 'Acme — Analytics Add-on',
    stage: 'Negotiation',
    value: 28000,
    close_date: futureMonths(1),
    // Rep is more confident than the stage default (75%)
    probability: 85,
  },
  {
    name: 'Acme — Training Package',
    stage: 'Prospecting',
    value: 15000,
    close_date: futureMonths(4),
  },
  {
    name: 'Acme — Support Contract',
    stage: 'Closed Won',
    value: 36000,
    close_date: relativeDate(-5),
    loss_reason: null,
  },
  {
    name: 'Globex — ERP Migration',
    stage: 'Proposal',
    value: 200000,
    close_date: futureMonths(4),
    // Rep is less confident than the stage default (50%)
    probability: 40,
    currency: 'GBP',
  },
  {
    name: 'Globex — Cloud Infrastructure',
    stage: 'Qualification',
    value: 85000,
    close_date: futureMonths(3),
  },
  {
    name: 'Globex — Data Warehouse',
    stage: 'Prospecting',
    value: 60000,
    close_date: futureMonths(5),
  },
  {
    name: 'Globex — Mobile App',
    stage: 'Closed Lost',
    value: 40000,
    close_date: relativeDate(-2),
    loss_reason: 'Lost to competitor',
  },
  {
    name: 'Globex — IoT Integration',
    stage: 'Negotiation',
    value: 95000,
    close_date: futureMonths(2),
    currency: 'EUR',
  },
];

const DEMO_ACTIVITIES: Array<{
  type: string;
  subject: string;
  notes: string | null;
  due_date: string;
  status: string;
  direction: string | null;
  dealIndex: number;
  contactIndex: number;
}> = [
  {
    type: 'Call',
    subject: 'Discovery call — Acme Enterprise',
    notes: 'Discussed pain points with legacy system.',
    due_date: '2026-04-10',
    status: 'complete',
    direction: 'Outbound',
    dealIndex: 0,
    contactIndex: 0,
  },
  {
    type: 'Email',
    subject: 'Follow-up after discovery',
    notes: null,
    due_date: '2026-04-12',
    status: 'open',
    direction: 'Outbound',
    dealIndex: 0,
    contactIndex: 1,
  },
  {
    type: 'Meeting',
    subject: 'Proposal review — Acme Security',
    notes: 'Walked through 3-year roadmap.',
    due_date: '2026-04-15',
    status: 'complete',
    direction: null,
    dealIndex: 1,
    contactIndex: 2,
  },
  {
    type: 'Task',
    subject: 'Send revised proposal — Acme Analytics',
    notes: null,
    due_date: '2026-04-20',
    status: 'open',
    direction: null,
    dealIndex: 2,
    contactIndex: 3,
  },
  {
    type: 'Note',
    subject: 'Budget confirmed for training package',
    notes: 'Alice confirmed Q3 budget allocation.',
    due_date: '2026-04-08',
    status: 'complete',
    direction: null,
    dealIndex: 3,
    contactIndex: 4,
  },
  {
    type: 'Call',
    subject: 'Contract kickoff — Acme Support',
    notes: 'Contract signed. Onboarding scheduled.',
    due_date: '2026-03-05',
    status: 'complete',
    direction: 'Inbound',
    dealIndex: 4,
    contactIndex: 5,
  },
  {
    type: 'Email',
    subject: 'ERP migration requirements checklist',
    notes: null,
    due_date: '2026-04-25',
    status: 'open',
    direction: 'Outbound',
    dealIndex: 5,
    contactIndex: 10,
  },
  {
    type: 'Meeting',
    subject: 'Technical deep-dive — Globex Cloud',
    notes: 'Covered architecture and integration points.',
    due_date: '2026-04-18',
    status: 'complete',
    direction: null,
    dealIndex: 6,
    contactIndex: 11,
  },
  {
    type: 'Task',
    subject: 'Prepare data warehouse demo environment',
    notes: null,
    due_date: '2026-05-01',
    status: 'open',
    direction: null,
    dealIndex: 7,
    contactIndex: 12,
  },
  {
    type: 'Call',
    subject: 'Post-mortem — Globex Mobile App loss',
    notes: 'Lost on price. Competitor undercut by 20%.',
    due_date: '2026-03-02',
    status: 'complete',
    direction: 'Inbound',
    dealIndex: 8,
    contactIndex: 13,
  },
  {
    type: 'Email',
    subject: 'Negotiation terms — Globex IoT',
    notes: null,
    due_date: '2026-04-22',
    status: 'open',
    direction: 'Outbound',
    dealIndex: 9,
    contactIndex: 14,
  },
  {
    type: 'Task',
    subject: 'Send NDA for signature — Globex ERP',
    notes: null,
    due_date: '2026-04-28',
    status: 'open',
    direction: null,
    dealIndex: 5,
    contactIndex: 13,
  },
  {
    type: 'Note',
    subject: 'IoT deal — exec sponsor confirmed',
    notes: 'Noah Garcia is the exec sponsor. Decision by end of May.',
    due_date: '2026-04-09',
    status: 'complete',
    direction: null,
    dealIndex: 9,
    contactIndex: 13,
  },
  {
    type: 'Call',
    subject: 'Qualification call — Acme Enterprise',
    notes: 'Good fit confirmed. Moving to proposal stage.',
    due_date: '2026-04-05',
    status: 'complete',
    direction: 'Outbound',
    dealIndex: 0,
    contactIndex: 9,
  },
  {
    type: 'Meeting',
    subject: 'Stakeholder alignment — Globex Cloud',
    notes: null,
    due_date: '2026-04-30',
    status: 'open',
    direction: null,
    dealIndex: 6,
    contactIndex: 16,
  },
];

// Demo leads showcasing the full status lifecycle and source variety (MINCRM-206)
const DEMO_LEADS = [
  {
    first_name: 'Tyler',
    last_name: 'Brooks',
    email: 'tyler.brooks.demo@pinnacle-demo.example.com',
    company_name: 'Pinnacle Systems',
    lead_source: 'Web',
    status: 'New',
  },
  {
    first_name: 'Sandra',
    last_name: 'Okafor',
    email: 'sandra.okafor.demo@meridian-demo.example.com',
    company_name: 'Meridian Labs',
    lead_source: 'Referral',
    status: 'Contacted',
  },
  {
    first_name: 'Derek',
    last_name: 'Walsh',
    email: 'derek.walsh.demo@vertex-demo.example.com',
    company_name: 'Vertex Solutions',
    lead_source: 'Trade Show',
    status: 'Qualified',
  },
  {
    first_name: 'Priya',
    last_name: 'Nair',
    email: 'priya.nair.demo@harbor-demo.example.com',
    company_name: 'Harbor Logistics',
    lead_source: 'Cold Outreach',
    status: 'Disqualified',
    disqualification_reason: 'Not the right fit — too small',
  },
  {
    // Left as Qualified so a demo user can exercise the conversion flow
    first_name: 'Marcus',
    last_name: 'Chen',
    email: 'marcus.chen.demo@apex-demo.example.com',
    company_name: 'Apex Technologies',
    lead_source: 'Web',
    status: 'Qualified',
  },
];

// Tags and their associations across entity types (MINCRM-206, MINCRM-186)
// contactIndex/accountIndex/dealIndex reference their respective fixture arrays.
const DEMO_TAGS = [
  {
    name: 'vip',
    contactIndices: [0, 9], // Alice Chen, Jack Wilson
    accountIndices: [0], // Acme Corporation
    dealIndices: [],
  },
  {
    name: 'conference-2026',
    contactIndices: [0, 12], // Alice Chen, Mia Thompson
    accountIndices: [],
    dealIndices: [],
  },
  {
    name: 'decision-maker',
    contactIndices: [9, 19, 13], // Jack Wilson, Tina Clark, Noah Garcia
    accountIndices: [],
    dealIndices: [],
  },
  {
    name: 'needs-renewal',
    contactIndices: [],
    accountIndices: [],
    dealIndices: [4], // Acme — Support Contract
  },
  {
    name: 'at-risk',
    contactIndices: [],
    accountIndices: [],
    dealIndices: [5], // Globex — ERP Migration
  },
  {
    name: 'enterprise',
    contactIndices: [],
    accountIndices: [0], // Acme Corporation
    dealIndices: [],
  },
  {
    name: 'key-account',
    contactIndices: [],
    accountIndices: [0, 1], // Acme Corporation, Globex Industries
    dealIndices: [],
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Returns true if any demo records exist in the accounts table.
 *
 * @param client - Active DB client.
 */
async function hasDemoData(client: pg.PoolClient): Promise<boolean> {
  const result = await client.query<{ exists: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM accounts WHERE is_demo = true) AS exists`,
  );
  return result.rows[0].exists;
}

/**
 * Returns the UUID of the first active admin user.
 * Throws if no active admin exists.
 *
 * @param client - Active DB client.
 */
async function getAdminUserId(client: pg.PoolClient): Promise<string> {
  const result = await client.query<{ id: string }>(
    `SELECT id FROM users WHERE role = 'admin' AND status = 'active' ORDER BY created_at LIMIT 1`,
  );
  if (!result.rows[0]) {
    throw new Error('No active admin user found — cannot seed demo data.');
  }
  return result.rows[0].id;
}

// ── Public service functions ───────────────────────────────────────────────────

/**
 * Returns whether demo data is currently present in the database.
 */
export async function getDemoStatus(): Promise<{ active: boolean }> {
  const client = await pool.connect();
  try {
    const active = await hasDemoData(client);
    return { active };
  } finally {
    client.release();
  }
}

/**
 * Removes all demo-flagged records from the database inside a single transaction.
 * Deletion order respects FK constraints.
 *
 * @param client - Active DB client (must already be inside a transaction).
 */
async function removeDemoData(client: pg.PoolClient): Promise<void> {
  // lead_status_history cascades automatically when leads are deleted
  await client.query(`DELETE FROM leads WHERE is_demo = true`);

  await client.query(
    `DELETE FROM contact_addresses
     WHERE contact_id IN (SELECT id FROM contacts WHERE is_demo = true)`,
  );

  await client.query(
    `DELETE FROM contact_tags
     WHERE contact_id IN (SELECT id FROM contacts WHERE is_demo = true)`,
  );
  await client.query(
    `DELETE FROM account_tags
     WHERE account_id IN (SELECT id FROM accounts WHERE is_demo = true)`,
  );
  await client.query(
    `DELETE FROM deal_tags
     WHERE deal_id IN (SELECT id FROM deals WHERE is_demo = true)`,
  );

  // Prune tags that are no longer referenced by any junction table row.
  // Tags have no is_demo flag — we preserve tags independently created by real users.
  await client.query(
    `DELETE FROM tags
     WHERE id NOT IN (SELECT tag_id FROM contact_tags)
       AND id NOT IN (SELECT tag_id FROM account_tags)
       AND id NOT IN (SELECT tag_id FROM deal_tags)`,
  );

  await client.query(`DELETE FROM activities WHERE is_demo = true`);
  await client.query(
    `DELETE FROM deal_contacts
     WHERE deal_id IN (SELECT id FROM deals WHERE is_demo = true)
        OR contact_id IN (SELECT id FROM contacts WHERE is_demo = true)`,
  );
  await client.query(`DELETE FROM deals WHERE is_demo = true`);
  await client.query(`DELETE FROM contacts WHERE is_demo = true`);
  await client.query(`DELETE FROM accounts WHERE is_demo = true`);
}

/**
 * Inserts the full demo dataset inside a single transaction.
 * Idempotency is NOT checked here — callers must check first (or use seedDemo which does check).
 *
 * @param client - Active DB client (must already be inside a transaction).
 * @param adminId - UUID to use as owner_id for all inserted records.
 */
async function insertDemoData(client: pg.PoolClient, adminId: string): Promise<void> {
  // 1. Accounts — Acme first so we have its ID for Globex's parent_account_id
  const accountIds: string[] = [];
  for (const account of DEMO_ACCOUNTS) {
    const result = await client.query<{ id: string }>(
      `INSERT INTO accounts (name, industry, website, employee_range, revenue_range, account_type, owner_id, is_demo)
       VALUES ($1, $2, $3, $4, $5, $6, $7, true)
       RETURNING id`,
      [
        account.name,
        account.industry,
        account.website,
        account.employee_range,
        account.revenue_range,
        account.account_type,
        adminId,
      ],
    );
    accountIds.push(result.rows[0].id);
  }

  // Link Globex (index 1) as a subsidiary of Acme (index 0)
  await client.query(`UPDATE accounts SET parent_account_id = $1 WHERE id = $2`, [
    accountIds[0],
    accountIds[1],
  ]);

  // 2. Contacts — first 10 → account 0 (Acme), next 10 → account 1 (Globex)
  const contactIds: string[] = [];
  for (let i = 0; i < DEMO_CONTACTS.length; i++) {
    const contact = DEMO_CONTACTS[i];
    const accountId = accountIds[i < 10 ? 0 : 1];
    const result = await client.query<{ id: string }>(
      `INSERT INTO contacts
         (first_name, last_name, email, phone, title, department,
          linkedin_url, twitter_x_url, account_id, owner_id, is_demo)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true)
       RETURNING id`,
      [
        contact.first_name,
        contact.last_name,
        contact.email,
        contact.phone,
        contact.title,
        contact.department,
        (contact as { linkedin_url?: string }).linkedin_url ?? null,
        (contact as { twitter_x_url?: string }).twitter_x_url ?? null,
        accountId,
        adminId,
      ],
    );
    contactIds.push(result.rows[0].id);
  }

  // 3. Contact addresses (contact_addresses table, not inline fields)
  for (const addr of DEMO_CONTACT_ADDRESSES) {
    await client.query(
      `INSERT INTO contact_addresses
         (contact_id, label, address_line1, city, state_region, postal_code, country, is_default)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        contactIds[addr.contactIndex],
        addr.label,
        addr.address_line1,
        addr.city,
        addr.state_region,
        addr.postal_code,
        addr.country,
        addr.is_default,
      ],
    );
  }

  // 4. Deals — first 5 → account 0 (Acme), next 5 → account 1 (Globex)
  const dealIds: string[] = [];
  for (let i = 0; i < DEMO_DEALS.length; i++) {
    const deal = DEMO_DEALS[i];
    const accountId = accountIds[i < 5 ? 0 : 1];
    const lossReason = (deal as { loss_reason?: string | null }).loss_reason ?? null;
    const probability = (deal as { probability?: number }).probability ?? null;
    const currency = (deal as { currency?: string }).currency ?? 'USD';
    const result = await client.query<{ id: string }>(
      `INSERT INTO deals
         (name, stage, value, probability, currency, close_date, loss_reason, account_id, owner_id, is_demo)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true)
       RETURNING id`,
      [
        deal.name,
        deal.stage,
        deal.value,
        probability,
        currency,
        deal.close_date,
        lossReason,
        accountId,
        adminId,
      ],
    );
    dealIds.push(result.rows[0].id);
  }

  // 5. Link primary contact to each deal
  for (let i = 0; i < DEMO_DEALS.length; i++) {
    const primaryContactIndex = i < 5 ? i : i + 5;
    await client.query(
      `INSERT INTO deal_contacts (deal_id, contact_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [dealIds[i], contactIds[primaryContactIndex]],
    );
  }

  // 6. Activities
  for (const activity of DEMO_ACTIVITIES) {
    const dealId = dealIds[activity.dealIndex];
    const contactId = contactIds[activity.contactIndex];
    await client.query(
      `INSERT INTO activities (type, subject, notes, due_date, status, direction, deal_id, contact_id, owner_id, is_demo)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true)`,
      [
        activity.type,
        activity.subject,
        activity.notes ?? null,
        activity.due_date,
        activity.status,
        activity.direction,
        dealId,
        contactId,
        adminId,
      ],
    );
  }

  // 7. Leads — showcase full status lifecycle and source variety
  for (const lead of DEMO_LEADS) {
    await client.query(
      `INSERT INTO leads
         (first_name, last_name, email, company_name, lead_source, status, disqualification_reason, owner_id, is_demo)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true)`,
      [
        lead.first_name,
        lead.last_name,
        lead.email,
        lead.company_name,
        lead.lead_source,
        lead.status,
        (lead as { disqualification_reason?: string }).disqualification_reason ?? null,
        adminId,
      ],
    );
  }

  // 8. Tags — insert tags then junction rows
  for (const tag of DEMO_TAGS) {
    const tagResult = await client.query<{ id: string }>(
      `INSERT INTO tags (name) VALUES ($1) ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
      [tag.name],
    );
    const tagId = tagResult.rows[0].id;

    for (const contactIndex of tag.contactIndices) {
      await client.query(
        `INSERT INTO contact_tags (contact_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [contactIds[contactIndex], tagId],
      );
    }
    for (const accountIndex of tag.accountIndices) {
      await client.query(
        `INSERT INTO account_tags (account_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [accountIds[accountIndex], tagId],
      );
    }
    for (const dealIndex of tag.dealIndices) {
      await client.query(
        `INSERT INTO deal_tags (deal_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [dealIds[dealIndex], tagId],
      );
    }
  }
}

/**
 * Seeds demo data if not already present.
 * Returns { seeded: true } on success or { seeded: false, reason: 'already_exists' } when demo data is already present.
 */
export async function seedDemo(): Promise<{ seeded: boolean; reason?: string }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Idempotency check runs inside the transaction to prevent TOCTOU races
    // where two concurrent requests both pass the guard and double-insert.
    const already = await hasDemoData(client);
    if (already) {
      await client.query('ROLLBACK');
      return { seeded: false, reason: 'already_exists' };
    }

    const adminId = await getAdminUserId(client);
    await insertDemoData(client, adminId);
    await client.query('COMMIT');
    return { seeded: true };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Removes all demo-flagged records.
 * Returns { removed: true } on success or { removed: false, reason: 'not_present' } when no demo data exists.
 */
export async function removeDemo(): Promise<{ removed: boolean; reason?: string }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Check runs inside the transaction so concurrent requests cannot both pass the guard.
    const active = await hasDemoData(client);
    if (!active) {
      await client.query('ROLLBACK');
      return { removed: false, reason: 'not_present' };
    }

    await removeDemoData(client);
    await client.query('COMMIT');
    return { removed: true };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Removes existing demo data and re-seeds in a single transaction.
 */
export async function resetDemo(): Promise<{ reset: boolean }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // getAdminUserId runs inside the transaction so any error triggers a clean ROLLBACK.
    const adminId = await getAdminUserId(client);
    await removeDemoData(client);
    await insertDemoData(client, adminId);
    await client.query('COMMIT');
    return { reset: true };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
