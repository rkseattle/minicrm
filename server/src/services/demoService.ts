/**
 * Demo data service.
 * Provides seed, remove, reset, and status operations for demo-flagged records.
 * Delegates to the same SQL logic used by the CLI scripts (MINCRM-102) so there
 * is no duplicated seeding/removal code. (MINCRM-103)
 */

import pool from '../db.js';
import type pg from 'pg';

// ── Fixtures (mirrored from scripts/seed-demo.ts) ───────────────────────────
// These are defined here rather than imported from the script so the script
// can remain a self-contained CLI entry point.

const DEMO_ACCOUNTS = [
  {
    name: 'Acme Corporation',
    industry: 'Technology',
    website: 'https://www.acme-demo.example.com',
    employee_range: '201-500',
    revenue_range: '50M-100M',
  },
  {
    name: 'Globex Industries',
    industry: 'Manufacturing',
    website: 'https://www.globex-demo.example.com',
    employee_range: '51-200',
    revenue_range: '10M-50M',
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
  },
];

const DEMO_DEALS = [
  {
    name: 'Acme — Enterprise Platform',
    stage: 'Qualification',
    value: 120000,
    close_date: '2026-06-30',
  },
  { name: 'Acme — Security Upgrade', stage: 'Proposal', value: 45000, close_date: '2026-05-15' },
  { name: 'Acme — Analytics Add-on', stage: 'Negotiation', value: 28000, close_date: '2026-04-30' },
  { name: 'Acme — Training Package', stage: 'Prospecting', value: 15000, close_date: '2026-08-01' },
  {
    name: 'Acme — Support Contract',
    stage: 'Closed Won',
    value: 36000,
    close_date: '2026-03-01',
    loss_reason: null,
  },
  { name: 'Globex — ERP Migration', stage: 'Proposal', value: 200000, close_date: '2026-07-31' },
  {
    name: 'Globex — Cloud Infrastructure',
    stage: 'Qualification',
    value: 85000,
    close_date: '2026-06-15',
  },
  { name: 'Globex — Data Warehouse', stage: 'Prospecting', value: 60000, close_date: '2026-09-01' },
  {
    name: 'Globex — Mobile App',
    stage: 'Closed Lost',
    value: 40000,
    close_date: '2026-02-28',
    loss_reason: 'Lost to competitor',
  },
  {
    name: 'Globex — IoT Integration',
    stage: 'Negotiation',
    value: 95000,
    close_date: '2026-05-30',
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
 * Respects foreign key ordering: activities → deal_contacts → deals → contacts → accounts.
 *
 * @param client - Active DB client (must already be inside a transaction).
 */
async function removeDemoData(client: pg.PoolClient): Promise<void> {
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
  // 1. Accounts
  const accountIds: string[] = [];
  for (const account of DEMO_ACCOUNTS) {
    const result = await client.query<{ id: string }>(
      `INSERT INTO accounts (name, industry, website, employee_range, revenue_range, owner_id, is_demo)
       VALUES ($1, $2, $3, $4, $5, $6, true)
       RETURNING id`,
      [
        account.name,
        account.industry,
        account.website,
        account.employee_range,
        account.revenue_range,
        adminId,
      ],
    );
    accountIds.push(result.rows[0].id);
  }

  // 2. Contacts — first 10 → account 0, next 10 → account 1
  const contactIds: string[] = [];
  for (let i = 0; i < DEMO_CONTACTS.length; i++) {
    const contact = DEMO_CONTACTS[i];
    const accountId = accountIds[i < 10 ? 0 : 1];
    const result = await client.query<{ id: string }>(
      `INSERT INTO contacts (first_name, last_name, email, phone, title, department, account_id, owner_id, is_demo)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true)
       RETURNING id`,
      [
        contact.first_name,
        contact.last_name,
        contact.email,
        contact.phone,
        contact.title,
        contact.department,
        accountId,
        adminId,
      ],
    );
    contactIds.push(result.rows[0].id);
  }

  // 3. Deals — first 5 → account 0, next 5 → account 1
  const dealIds: string[] = [];
  for (let i = 0; i < DEMO_DEALS.length; i++) {
    const deal = DEMO_DEALS[i];
    const accountId = accountIds[i < 5 ? 0 : 1];
    const lossReason = (deal as { loss_reason?: string | null }).loss_reason ?? null;
    const result = await client.query<{ id: string }>(
      `INSERT INTO deals (name, stage, value, close_date, loss_reason, account_id, owner_id, is_demo)
       VALUES ($1, $2, $3, $4, $5, $6, $7, true)
       RETURNING id`,
      [deal.name, deal.stage, deal.value, deal.close_date, lossReason, accountId, adminId],
    );
    dealIds.push(result.rows[0].id);
  }

  // 4. Link primary contact to each deal
  for (let i = 0; i < DEMO_DEALS.length; i++) {
    const primaryContactIndex = i < 5 ? i : i + 5;
    await client.query(
      `INSERT INTO deal_contacts (deal_id, contact_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [dealIds[i], contactIds[primaryContactIndex]],
    );
  }

  // 5. Activities
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
}

/**
 * Seeds demo data if not already present.
 * Returns { seeded: true } on success or { seeded: false, reason: 'already_exists' } when demo data is already present.
 */
export async function seedDemo(): Promise<{ seeded: boolean; reason?: string }> {
  const client = await pool.connect();
  try {
    const already = await hasDemoData(client);
    if (already) {
      return { seeded: false, reason: 'already_exists' };
    }

    const adminId = await getAdminUserId(client);
    await client.query('BEGIN');
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
    const active = await hasDemoData(client);
    if (!active) {
      return { removed: false, reason: 'not_present' };
    }

    await client.query('BEGIN');
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
    const adminId = await getAdminUserId(client);
    await client.query('BEGIN');
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
