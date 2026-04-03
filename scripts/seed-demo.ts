/**
 * seed-demo.ts — Insert realistic demo data into MiniCRM.
 *
 * All inserted records are tagged with is_demo = true so they can be
 * identified and removed without touching real data (see remove-demo.ts).
 *
 * Usage:
 *   npm run seed:demo             # insert demo data (idempotent — skips if already seeded)
 *   npm run seed:demo -- --dry-run  # preview what would be inserted without writing to the DB
 *
 * Requires a running PostgreSQL instance and a .env file (or environment variables)
 * that configure DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME.
 *
 * Demo data volume:
 *   - 2 demo accounts
 *   - 20 demo contacts (10 per account)
 *   - 10 demo deals across 4 pipeline stages
 *   - 15 demo activities linked to the deals
 *
 * The script uses the first active admin user it finds as owner_id. If no admin
 * exists the script exits with an error message.
 *
 * MINCRM-102
 */

import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;

const isDryRun = process.argv.includes('--dry-run');

/** Connect using the same env vars as the server. */
const pool = new Pool({
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT) || 5432,
});

/** Prints a message and exits with a non-zero code. */
function fatal(message: string): never {
  console.error(`[seed-demo] ERROR: ${message}`);
  process.exit(1);
}

/** Resolves to the UUID of the first active admin user. */
async function getAdminUserId(client: pg.PoolClient): Promise<string> {
  const result = await client.query<{ id: string }>(
    `SELECT id FROM users WHERE role = 'admin' AND status = 'active' ORDER BY created_at LIMIT 1`,
  );
  if (!result.rows[0]) {
    fatal('No active admin user found. Create an admin account before running seed-demo.');
  }
  return result.rows[0].id;
}

/** Allowlist of tables that carry the is_demo flag — guards against SQL injection. */
const DEMO_TABLES = ['contacts', 'accounts', 'deals', 'activities'] as const;
type DemoTable = (typeof DEMO_TABLES)[number];

/** Returns true if any demo records already exist in the given table. */
async function hasDemoRows(client: pg.PoolClient, table: DemoTable): Promise<boolean> {
  if (!(DEMO_TABLES as readonly string[]).includes(table)) {
    throw new Error(`hasDemoRows: unexpected table "${table}"`);
  }
  const result = await client.query<{ exists: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM ${table} WHERE is_demo = true) AS exists`,
  );
  return result.rows[0].exists;
}

// ── Demo data fixtures ────────────────────────────────────────────────────────

const DEMO_ACCOUNTS = [
  {
    name: 'Acme Corporation',
    industry: 'Technology',
    website: 'https://www.acme-demo.example.com',
    employee_range: '201-500',
    revenue_range: '$10M-$50M',
  },
  {
    name: 'Globex Industries',
    industry: 'Manufacturing',
    website: 'https://www.globex-demo.example.com',
    employee_range: '51-200',
    revenue_range: '$1M-$10M',
  },
];

/** 10 contacts per account — indices 0-9 go to account 0, 10-19 to account 1. */
const DEMO_CONTACTS = [
  {
    first_name: 'Alice',
    last_name: 'Nguyen',
    email: 'alice.nguyen.demo@acme-demo.example.com',
    phone: '+1-415-555-0101',
    title: 'VP of Engineering',
    department: 'Engineering',
  },
  {
    first_name: 'Bob',
    last_name: 'Patel',
    email: 'bob.patel.demo@acme-demo.example.com',
    phone: '+1-415-555-0102',
    title: 'Director of Product',
    department: 'Product',
  },
  {
    first_name: 'Carol',
    last_name: 'Kim',
    email: 'carol.kim.demo@acme-demo.example.com',
    phone: '+1-415-555-0103',
    title: 'CFO',
    department: 'Finance',
  },
  {
    first_name: 'David',
    last_name: 'Chen',
    email: 'david.chen.demo@acme-demo.example.com',
    phone: '+1-415-555-0104',
    title: 'Head of Sales',
    department: 'Sales',
  },
  {
    first_name: 'Eva',
    last_name: 'Martinez',
    email: 'eva.martinez.demo@acme-demo.example.com',
    phone: '+1-415-555-0105',
    title: 'Account Executive',
    department: 'Sales',
  },
  {
    first_name: 'Frank',
    last_name: 'Thompson',
    email: 'frank.thompson.demo@acme-demo.example.com',
    phone: '+1-415-555-0106',
    title: 'CTO',
    department: 'Engineering',
  },
  {
    first_name: 'Grace',
    last_name: 'Liu',
    email: 'grace.liu.demo@acme-demo.example.com',
    phone: '+1-415-555-0107',
    title: 'Marketing Manager',
    department: 'Marketing',
  },
  {
    first_name: 'Henry',
    last_name: 'Wilson',
    email: 'henry.wilson.demo@acme-demo.example.com',
    phone: '+1-415-555-0108',
    title: 'Operations Lead',
    department: 'Operations',
  },
  {
    first_name: 'Iris',
    last_name: 'Okafor',
    email: 'iris.okafor.demo@acme-demo.example.com',
    phone: '+1-415-555-0109',
    title: 'Legal Counsel',
    department: 'Legal',
  },
  {
    first_name: 'James',
    last_name: 'Brown',
    email: 'james.brown.demo@acme-demo.example.com',
    phone: '+1-415-555-0110',
    title: 'CEO',
    department: 'Executive',
  },
  {
    first_name: 'Karen',
    last_name: 'Singh',
    email: 'karen.singh.demo@globex-demo.example.com',
    phone: '+1-312-555-0201',
    title: 'Plant Manager',
    department: 'Operations',
  },
  {
    first_name: 'Leo',
    last_name: 'Garcia',
    email: 'leo.garcia.demo@globex-demo.example.com',
    phone: '+1-312-555-0202',
    title: 'Procurement Director',
    department: 'Procurement',
  },
  {
    first_name: 'Mia',
    last_name: 'Robinson',
    email: 'mia.robinson.demo@globex-demo.example.com',
    phone: '+1-312-555-0203',
    title: 'Supply Chain Manager',
    department: 'Supply Chain',
  },
  {
    first_name: 'Noah',
    last_name: 'Davis',
    email: 'noah.davis.demo@globex-demo.example.com',
    phone: '+1-312-555-0204',
    title: 'Quality Assurance Lead',
    department: 'Quality',
  },
  {
    first_name: 'Olivia',
    last_name: 'Hernandez',
    email: 'olivia.hernandez.demo@globex-demo.example.com',
    phone: '+1-312-555-0205',
    title: 'Sales Manager',
    department: 'Sales',
  },
  {
    first_name: 'Paul',
    last_name: 'Lee',
    email: 'paul.lee.demo@globex-demo.example.com',
    phone: '+1-312-555-0206',
    title: 'CFO',
    department: 'Finance',
  },
  {
    first_name: 'Quinn',
    last_name: 'Jackson',
    email: 'quinn.jackson.demo@globex-demo.example.com',
    phone: '+1-312-555-0207',
    title: 'R&D Director',
    department: 'Research',
  },
  {
    first_name: 'Rachel',
    last_name: 'White',
    email: 'rachel.white.demo@globex-demo.example.com',
    phone: '+1-312-555-0208',
    title: 'HR Manager',
    department: 'HR',
  },
  {
    first_name: 'Samuel',
    last_name: 'Taylor',
    email: 'samuel.taylor.demo@globex-demo.example.com',
    phone: '+1-312-555-0209',
    title: 'IT Director',
    department: 'IT',
  },
  {
    first_name: 'Tara',
    last_name: 'Anderson',
    email: 'tara.anderson.demo@globex-demo.example.com',
    phone: '+1-312-555-0210',
    title: 'COO',
    department: 'Executive',
  },
];

/** 10 deals spread across 4 stages. Indices 0-4 linked to account 0, 5-9 to account 1. */
const DEMO_DEALS = [
  { name: 'Acme Platform Upgrade', stage: 'Prospecting', value: 45000, close_date: '2026-06-30' },
  { name: 'Acme Analytics Suite', stage: 'Qualification', value: 28500, close_date: '2026-05-31' },
  { name: 'Acme Security Audit', stage: 'Proposal', value: 12000, close_date: '2026-04-30' },
  { name: 'Acme DevOps Tooling', stage: 'Negotiation', value: 62000, close_date: '2026-04-15' },
  {
    name: 'Acme Annual License Renewal',
    stage: 'Closed Won',
    value: 87000,
    close_date: '2026-03-31',
    loss_reason: null,
  },
  { name: 'Globex ERP Integration', stage: 'Prospecting', value: 35000, close_date: '2026-07-31' },
  {
    name: 'Globex Supply Chain Visibility',
    stage: 'Qualification',
    value: 19800,
    close_date: '2026-06-15',
  },
  { name: 'Globex Quality Management', stage: 'Proposal', value: 24500, close_date: '2026-05-15' },
  {
    name: 'Globex Reporting Dashboard',
    stage: 'Closed Won',
    value: 41000,
    close_date: '2026-03-15',
    loss_reason: null,
  },
  {
    name: 'Globex Mobile Rollout',
    stage: 'Closed Lost',
    value: 15000,
    close_date: '2026-02-28',
    loss_reason: 'Lost to competitor',
  },
];

type ActivityFixture = {
  type: string;
  subject: string;
  notes: string | null;
  due_date: string;
  status: string;
  direction: string | null;
  /** Index into DEMO_DEALS */
  dealIndex: number;
  /** Index into DEMO_CONTACTS, used as contact_id */
  contactIndex: number;
};

/** 15 activities linked to deals and contacts. */
const DEMO_ACTIVITIES: ActivityFixture[] = [
  {
    type: 'Call',
    subject: 'Discovery call — platform needs',
    notes: 'Discussed current pain points and budget window.',
    due_date: '2026-04-05',
    status: 'complete',
    direction: 'Outbound',
    dealIndex: 0,
    contactIndex: 0,
  },
  {
    type: 'Email',
    subject: 'Sent platform overview deck',
    notes: 'Attached the 2026 product roadmap PDF.',
    due_date: '2026-04-07',
    status: 'complete',
    direction: 'Outbound',
    dealIndex: 0,
    contactIndex: 1,
  },
  {
    type: 'Task',
    subject: 'Follow up on deck review',
    notes: null,
    due_date: '2026-04-12',
    status: 'open',
    direction: null,
    dealIndex: 0,
    contactIndex: 1,
  },
  {
    type: 'Meeting',
    subject: 'Analytics demo — stakeholders',
    notes: 'Showed live demo of reporting module to Carol and Frank.',
    due_date: '2026-04-10',
    status: 'complete',
    direction: null,
    dealIndex: 1,
    contactIndex: 2,
  },
  {
    type: 'Note',
    subject: 'Budget approval needed',
    notes: 'Carol confirmed budget is locked until Q3. Revisit in June.',
    due_date: '2026-05-01',
    status: 'open',
    direction: null,
    dealIndex: 1,
    contactIndex: 2,
  },
  {
    type: 'Call',
    subject: 'Security requirements review',
    notes: 'Frank outlined SOC 2 compliance requirements.',
    due_date: '2026-04-02',
    status: 'complete',
    direction: 'Inbound',
    dealIndex: 2,
    contactIndex: 5,
  },
  {
    type: 'Email',
    subject: 'Proposal sent — security audit',
    notes: 'Sent scoped proposal with 3-week delivery timeline.',
    due_date: '2026-04-08',
    status: 'complete',
    direction: 'Outbound',
    dealIndex: 2,
    contactIndex: 5,
  },
  {
    type: 'Task',
    subject: 'Schedule final negotiation call',
    notes: null,
    due_date: '2026-04-14',
    status: 'open',
    direction: null,
    dealIndex: 3,
    contactIndex: 3,
  },
  {
    type: 'Call',
    subject: 'Pricing negotiation',
    notes: 'David pushed back on seat licensing. Counter-offer at $58k.',
    due_date: '2026-04-10',
    status: 'complete',
    direction: 'Inbound',
    dealIndex: 3,
    contactIndex: 3,
  },
  {
    type: 'Note',
    subject: 'Deal signed — Acme renewal',
    notes: 'MSA and SOW executed. Kick-off scheduled for April 20.',
    due_date: '2026-03-28',
    status: 'complete',
    direction: null,
    dealIndex: 4,
    contactIndex: 9,
  },
  {
    type: 'Call',
    subject: 'Initial discovery — ERP project',
    notes: 'Karen confirmed Globex is evaluating 3 vendors.',
    due_date: '2026-04-01',
    status: 'complete',
    direction: 'Outbound',
    dealIndex: 5,
    contactIndex: 10,
  },
  {
    type: 'Meeting',
    subject: 'Supply chain workshop',
    notes: 'Ran a 2-hour workshop with Mia and Leo on current workflow gaps.',
    due_date: '2026-04-08',
    status: 'complete',
    direction: null,
    dealIndex: 6,
    contactIndex: 12,
  },
  {
    type: 'Email',
    subject: 'Quality management proposal',
    notes: 'Sent detailed scope and pricing for QMS module.',
    due_date: '2026-04-11',
    status: 'complete',
    direction: 'Outbound',
    dealIndex: 7,
    contactIndex: 13,
  },
  {
    type: 'Note',
    subject: 'Globex reporting — closed won',
    notes: 'Contract signed. Onboarding starts next Monday.',
    due_date: '2026-03-12',
    status: 'complete',
    direction: null,
    dealIndex: 8,
    contactIndex: 15,
  },
  {
    type: 'Note',
    subject: 'Mobile deal lost',
    notes: 'Globex chose a competitor with a native mobile app. Revisit in H2.',
    due_date: '2026-02-25',
    status: 'complete',
    direction: null,
    dealIndex: 9,
    contactIndex: 14,
  },
];

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const client = await pool.connect();

  try {
    // Idempotency check — bail out if demo data already exists
    const alreadySeeded = await hasDemoRows(client, 'accounts');
    if (alreadySeeded) {
      console.log(
        '[seed-demo] Demo data already exists. Run `npm run remove:demo` first to re-seed.',
      );
      return;
    }

    const adminId = await getAdminUserId(client);
    console.log(`[seed-demo] Using admin user ${adminId} as owner.`);

    if (isDryRun) {
      console.log('[seed-demo] DRY RUN — no data will be written.\n');
      console.log(`  Accounts  : ${DEMO_ACCOUNTS.length}`);
      console.log(`  Contacts  : ${DEMO_CONTACTS.length}`);
      console.log(`  Deals     : ${DEMO_DEALS.length}`);
      console.log(`  Activities: ${DEMO_ACTIVITIES.length}`);
      return;
    }

    await client.query('BEGIN');

    // 1. Insert accounts
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
      console.log(`[seed-demo] Account: ${account.name}`);
    }

    // 2. Insert contacts — first 10 → account 0, next 10 → account 1
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
      console.log(`[seed-demo] Contact: ${contact.first_name} ${contact.last_name}`);
    }

    // 3. Insert deals — first 5 → account 0, next 5 → account 1
    const dealIds: string[] = [];
    for (let i = 0; i < DEMO_DEALS.length; i++) {
      const deal = DEMO_DEALS[i];
      const accountId = accountIds[i < 5 ? 0 : 1];
      const result = await client.query<{ id: string }>(
        `INSERT INTO deals (name, stage, value, close_date, loss_reason, account_id, owner_id, is_demo)
         VALUES ($1, $2, $3, $4, $5, $6, $7, true)
         RETURNING id`,
        [
          deal.name,
          deal.stage,
          deal.value,
          deal.close_date,
          (deal as { loss_reason?: string | null }).loss_reason ?? null,
          accountId,
          adminId,
        ],
      );
      dealIds.push(result.rows[0].id);
      console.log(`[seed-demo] Deal: ${deal.name} (${deal.stage})`);
    }

    // 4. Link primary contact to each deal via deal_contacts
    for (let i = 0; i < DEMO_DEALS.length; i++) {
      const primaryContactIndex = i < 5 ? i : i + 5;
      await client.query(
        `INSERT INTO deal_contacts (deal_id, contact_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [dealIds[i], contactIds[primaryContactIndex]],
      );
    }

    // 5. Insert activities
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
      console.log(`[seed-demo] Activity: ${activity.type} — ${activity.subject}`);
    }

    await client.query('COMMIT');

    console.log('\n[seed-demo] Done.');
    console.log(`  Accounts  : ${accountIds.length}`);
    console.log(`  Contacts  : ${contactIds.length}`);
    console.log(`  Deals     : ${dealIds.length}`);
    console.log(`  Activities: ${DEMO_ACTIVITIES.length}`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('[seed-demo] Fatal error:', err);
  process.exit(1);
});
