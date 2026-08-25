/**
 * Integration tests for demoService.
 * Verifies seed, remove, reset, and status operations against a real test DB.
 *
 * Runs against the minicrm_test database.
 */

import 'dotenv/config';
import {
  getDemoStatus,
  seedDemo,
  removeDemo,
  resetDemo,
  deleteDemoHygieneFindings,
  runPostSeedProducers,
} from '../services/demoService.js';
import pool from '../db.js';
import { claimAdminResolution } from './testUtils.js';
import {
  gatherOfflineHygieneSignals,
  getHygieneConfig,
  runDataHygieneScan,
} from '../services/dataHygieneService.js';
import { generateRepCoachingInsights } from '../services/repCoachingService.js';

const FILE_PREFIX = 'demo-svc';

const ADMIN_USER = {
  email: `${FILE_PREFIX}-admin@example.com`,
  name: 'Demo Service Admin',
  role: 'admin' as const,
  passwordHash: '$2b$12$placeholder_hash',
  status: 'active' as const,
};

/**
 * Admin id for this file's fixture, refreshed by ensureUser() in beforeEach.
 * Not captured once in beforeAll: seedDemo() requires an active admin, and this file
 * shares minicrm_test with specs that delete users wholesale — userService.test.ts
 * runs a bare `DELETE FROM users`. Serial order is duration-derived rather than fixed
 * (vitest sorts failed-first, then duration-descending), so no file can rely on running
 * before that wipe.
 */
let adminUserId: string;

// Derived from DEMO_WEBHOOK_SUBSCRIPTIONS in demoService.ts
const DEMO_WEBHOOK_URLS = [
  'https://hooks.example.com/slack/minicrm-deals',
  'https://hooks.zapier.com/example/minicrm',
];
// Derived from DEMO_CUSTOM_FIELD_DEFINITIONS in demoService.ts
const DEMO_CUSTOM_FIELD_NAMES = [
  'LinkedIn URL',
  'Lead Source Detail',
  'Contract Signed Date',
  'Estimated ARR',
];
// Derived from DEMO_CURRENCIES in demoService.ts (JPY added in a later change for i18n demo)
const DEMO_CURRENCY_CODES = ['GBP', 'EUR', 'CAD', 'JPY'];
// Derived from DEMO_PIPELINE_NAME / DEMO_PIPELINE_STAGES in demoService.ts
const DEMO_PIPELINE_NAME = 'Enterprise B2B';
const DEMO_PIPELINE_STAGE_NAMES = [
  'Discovery',
  'Technical Scoping',
  'Technical Validation',
  'Proposal',
  'Contract Review',
  'Closed Won',
  'Closed Lost',
];

async function cleanDemoData(): Promise<void> {
  // Delete notes created by demo rep first (no is_demo column on notes)
  await pool.query(`DELETE FROM notes WHERE created_by = (SELECT id FROM users WHERE email = $1)`, [
    'alex.rivera@demo.minicrm.app',
  ]);
  // Delete notes linked to demo entities
  await pool.query(
    `DELETE FROM notes WHERE entity_id IN (
       SELECT id FROM contacts WHERE is_demo = true
       UNION SELECT id FROM accounts WHERE is_demo = true
       UNION SELECT id FROM deals WHERE is_demo = true
       UNION SELECT id FROM leads WHERE is_demo = true
     )`,
  );
  await pool.query(
    `DELETE FROM custom_field_values WHERE record_id IN (
       SELECT id FROM contacts WHERE is_demo = true
       UNION SELECT id FROM deals WHERE is_demo = true
     )`,
  );
  // Same predicate the production path uses, so the two cannot drift.
  await deleteDemoHygieneFindings(pool);
  // The coaching generator this file invokes writes for every eligible rep in the shared
  // database, so its rows outlive the demo users unless cleared here.
  await pool.query(`DELETE FROM rep_coaching_insight_history`);
  await pool.query(`DELETE FROM rep_coaching_insights`);
  await pool.query(`DELETE FROM custom_field_definitions WHERE name = ANY($1::text[])`, [
    DEMO_CUSTOM_FIELD_NAMES,
  ]);
  await pool.query(`DELETE FROM webhook_subscriptions WHERE url = ANY($1::text[])`, [
    DEMO_WEBHOOK_URLS,
  ]);
  await pool.query(`DELETE FROM currencies WHERE code = ANY($1::text[]) AND is_home = false`, [
    DEMO_CURRENCY_CODES,
  ]);
  await pool.query(`DELETE FROM leads WHERE is_demo = true`);
  await pool.query(
    `DELETE FROM contact_addresses
     WHERE contact_id IN (SELECT id FROM contacts WHERE is_demo = true)`,
  );
  await pool.query(
    `DELETE FROM contact_tags
     WHERE contact_id IN (SELECT id FROM contacts WHERE is_demo = true)`,
  );
  await pool.query(
    `DELETE FROM account_tags
     WHERE account_id IN (SELECT id FROM accounts WHERE is_demo = true)`,
  );
  await pool.query(
    `DELETE FROM deal_tags
     WHERE deal_id IN (SELECT id FROM deals WHERE is_demo = true)`,
  );
  await pool.query(
    `DELETE FROM tags
     WHERE id NOT IN (SELECT tag_id FROM contact_tags)
       AND id NOT IN (SELECT tag_id FROM account_tags)
       AND id NOT IN (SELECT tag_id FROM deal_tags)`,
  );
  await pool.query('DELETE FROM automation_rules WHERE is_demo = true');
  await pool.query(`DELETE FROM activities WHERE is_demo = true`);
  await pool.query(
    `DELETE FROM deal_contacts
     WHERE deal_id IN (SELECT id FROM deals WHERE is_demo = true)
        OR contact_id IN (SELECT id FROM contacts WHERE is_demo = true)`,
  );
  await pool.query(`DELETE FROM deals WHERE is_demo = true`);
  // Remove the demo pipeline — stages cascade via ON DELETE CASCADE
  await pool.query(`DELETE FROM pipelines WHERE name = $1 AND is_default = false`, [
    DEMO_PIPELINE_NAME,
  ]);
  await pool.query(`DELETE FROM contacts WHERE is_demo = true`);
  await pool.query(`DELETE FROM accounts WHERE is_demo = true`);
  // Remove demo rep user — created by insertDemoData, not covered by is_demo flag
  await pool.query(`DELETE FROM users WHERE email = 'alex.rivera@demo.minicrm.app'`);
  // The demo IAM users are also created by insertDemoData and also carry no
  // is_demo flag. admin@demo.minicrm.dev is an ACTIVE ADMIN, so leaving it resident makes
  // it a candidate for getAdminUserId()'s ORDER BY created_at — the same leftover-fixture
  // residue this file's other cleanup exists to prevent.
  await pool.query(`DELETE FROM users WHERE email LIKE '%@demo.minicrm.dev'`);
}

beforeAll(async () => {
  await cleanDemoData();
  // Delete notes created_by admin user before deleting the user
  await pool.query(`DELETE FROM notes WHERE created_by = (SELECT id FROM users WHERE email = $1)`, [
    ADMIN_USER.email,
  ]);
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
  adminUserId = await claimAdminResolution(ADMIN_USER);
});

beforeEach(async () => {
  // Admin first, matching beforeAll's order: cleanDemoData resolves users by email and
  // prunes owned rows behind ON DELETE RESTRICT owner FKs. Re-established every test
  // because a sibling spec's `DELETE FROM users` or an interrupted prior run removes it,
  // and seedDemo() has no way to recover from its absence.
  // Claims admin resolution rather than assuming it: seedDemo() resolves the OLDEST active
  // admin globally, so a sibling demo spec's surviving fixture would otherwise own the
  // seeded data while this file's owner-scoped cleanup missed it.
  adminUserId = await claimAdminResolution(ADMIN_USER);
  await cleanDemoData();
});

afterAll(async () => {
  // Live lookup, not the cached adminUserId: a sibling spec's `DELETE FROM users` can
  // land between the last test and this hook, and cleaning by a stale id would run ~20
  // owner-scoped DELETEs against a row that no longer exists while leaving the rows that
  // do. Reading current state means an absent fixture skips the block, as before.
  const adminResult = await pool.query<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [
    ADMIN_USER.email,
  ]);
  const adminId = adminResult.rows[0]?.id;

  if (adminId) {
    // Delete notes created_by admin and rep before deleting their entities/users
    await pool.query(`DELETE FROM notes WHERE created_by = $1`, [adminId]);
    await pool.query(
      `DELETE FROM notes WHERE created_by = (SELECT id FROM users WHERE email = $1)`,
      ['alex.rivera@demo.minicrm.app'],
    );
    // Delete notes linked to admin-owned entities
    await pool.query(
      `DELETE FROM notes WHERE entity_id IN (
         SELECT id FROM contacts WHERE owner_id = $1
         UNION SELECT id FROM accounts WHERE owner_id = $1
         UNION SELECT id FROM deals WHERE owner_id = $1
       )`,
      [adminId],
    );
    await pool.query(
      `DELETE FROM custom_field_values WHERE record_id IN (
       SELECT id FROM contacts WHERE is_demo = true OR owner_id = $1
       UNION SELECT id FROM deals WHERE is_demo = true OR owner_id = $1
    )`,
      [adminId],
    );
    // Shared predicate for the demo-flagged half, then this file's own fixtures, which
    // are demo-shaped without carrying the flag.
    await deleteDemoHygieneFindings(pool);
    await pool.query(
      `DELETE FROM data_hygiene_findings WHERE entity_id IN (
         SELECT id FROM contacts WHERE owner_id = $1
         UNION SELECT id FROM accounts WHERE owner_id = $1
         UNION SELECT id FROM deals WHERE owner_id = $1
       )`,
      [adminId],
    );
    await pool.query(`DELETE FROM custom_field_definitions WHERE name = ANY($1::text[])`, [
      DEMO_CUSTOM_FIELD_NAMES,
    ]);
    await pool.query(`DELETE FROM webhook_subscriptions WHERE url = ANY($1::text[])`, [
      DEMO_WEBHOOK_URLS,
    ]);
    await pool.query(`DELETE FROM currencies WHERE code = ANY($1::text[]) AND is_home = false`, [
      DEMO_CURRENCY_CODES,
    ]);
    await pool.query(`DELETE FROM leads WHERE is_demo = true OR owner_id = $1`, [adminId]);
    await pool.query(
      `DELETE FROM contact_addresses
       WHERE contact_id IN (SELECT id FROM contacts WHERE is_demo = true OR owner_id = $1)`,
      [adminId],
    );
    await pool.query(
      `DELETE FROM contact_tags
       WHERE contact_id IN (SELECT id FROM contacts WHERE is_demo = true OR owner_id = $1)`,
      [adminId],
    );
    await pool.query(
      `DELETE FROM account_tags
       WHERE account_id IN (SELECT id FROM accounts WHERE is_demo = true OR owner_id = $1)`,
      [adminId],
    );
    await pool.query(
      `DELETE FROM deal_tags
       WHERE deal_id IN (SELECT id FROM deals WHERE is_demo = true OR owner_id = $1)`,
      [adminId],
    );
    await pool.query(
      `DELETE FROM tags
       WHERE id NOT IN (SELECT tag_id FROM contact_tags)
         AND id NOT IN (SELECT tag_id FROM account_tags)
         AND id NOT IN (SELECT tag_id FROM deal_tags)`,
    );
    await pool.query(`DELETE FROM automation_rules WHERE is_demo = true OR created_by = $1`, [
      adminId,
    ]);
    await pool.query(`DELETE FROM activities WHERE is_demo = true OR owner_id = $1`, [adminId]);
    await pool.query(
      `DELETE FROM deal_contacts
       WHERE deal_id IN (SELECT id FROM deals WHERE is_demo = true OR owner_id = $1)
          OR contact_id IN (SELECT id FROM contacts WHERE is_demo = true OR owner_id = $1)`,
      [adminId],
    );
    await pool.query(`DELETE FROM deals WHERE is_demo = true OR owner_id = $1`, [adminId]);
    // Remove the demo pipeline — stages cascade via ON DELETE CASCADE
    await pool.query(`DELETE FROM pipelines WHERE name = $1 AND is_default = false`, [
      DEMO_PIPELINE_NAME,
    ]);
    await pool.query(`DELETE FROM contacts WHERE is_demo = true OR owner_id = $1`, [adminId]);
    await pool.query(`DELETE FROM accounts WHERE is_demo = true OR owner_id = $1`, [adminId]);
  }
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
  // Outside the demo-svc prefix, so the widened delete above does not cover it.
  await pool.query(`DELETE FROM users WHERE email = 'alex.rivera@demo.minicrm.app'`);
});

// ── no-active-admin precondition ───────────────────────────

describe('seedDemo — no active admin', () => {
  it('rejects with the service’s own named error when no active admin exists', async () => {
    // Asserts getAdminUserId's throw directly, not a helper's copy of its query.
    // assertResolvedAdminIs re-implements the same SELECT, so a test written against it
    // would stay green if the service dropped `AND status = 'active'` or changed its
    // ORDER BY — while every demo spec silently seeded under the wrong owner. The rule
    // has to be asserted where it lives.
    //
    // seedDemo() opens its own pool connection, so it cannot see an uncommitted
    // deactivation: the state must really exist for the duration of the call. Every
    // affected id is snapshotted and restored in an unconditional finally so no sibling
    // spec inherits it — and the window is one seedDemo() call that rejects immediately,
    // since getAdminUserId runs before any insert work (demoService.ts:2309).
    const activeAdmins = await pool.query<{ id: string }>(
      `SELECT id FROM users WHERE role = 'admin' AND status = 'active'`,
    );
    const deactivatedIds = activeAdmins.rows.map((row) => row.id);

    await pool.query(`UPDATE users SET status = 'inactive' WHERE id = ANY($1::uuid[])`, [
      deactivatedIds,
    ]);
    try {
      await expect(seedDemo()).rejects.toThrow(
        'No active admin user found — cannot seed demo data.',
      );
    } finally {
      await pool.query(`UPDATE users SET status = 'active' WHERE id = ANY($1::uuid[])`, [
        deactivatedIds,
      ]);
    }
  });
});

// ── getDemoStatus ─────────────────────────────────────────────────────────────

describe('getDemoStatus', () => {
  it('returns active: false when no demo data exists', async () => {
    const status = await getDemoStatus();
    expect(status.active).toBe(false);
  });

  it('returns active: true after seeding', async () => {
    await seedDemo();
    const status = await getDemoStatus();
    expect(status.active).toBe(true);
  });
});

// ── seedDemo ──────────────────────────────────────────────────────────────────

describe('seedDemo', () => {
  it('inserts demo accounts, contacts, deals, and activities', async () => {
    await seedDemo();

    const accounts = await pool.query(`SELECT id FROM accounts WHERE is_demo = true`);
    const contacts = await pool.query(`SELECT id FROM contacts WHERE is_demo = true`);
    const deals = await pool.query(`SELECT id FROM deals WHERE is_demo = true`);
    const activities = await pool.query(`SELECT id FROM activities WHERE is_demo = true`);

    expect(accounts.rowCount).toBeGreaterThan(0);
    expect(contacts.rowCount).toBeGreaterThan(0);
    expect(deals.rowCount).toBeGreaterThan(0);
    expect(activities.rowCount).toBeGreaterThan(0);
  });

  it('returns seeded: true on first call', async () => {
    const result = await seedDemo();
    expect(result.seeded).toBe(true);
  });

  it('returns seeded: false with reason "already_exists" when called again', async () => {
    await seedDemo();
    const result = await seedDemo();
    expect(result.seeded).toBe(false);
    expect(result.reason).toBe('already_exists');
  });

  it('does not insert real data (all inserted rows have is_demo = true)', async () => {
    const beforeAccounts = await pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM accounts WHERE is_demo = false`,
    );
    await seedDemo();
    const afterAccounts = await pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM accounts WHERE is_demo = false`,
    );
    expect(afterAccounts.rows[0].count).toBe(beforeAccounts.rows[0].count);
  });

  it('inserts 7 demo leads with correct statuses', async () => {
    await seedDemo();

    const leads = await pool.query<{ first_name: string; status: string }>(
      `SELECT first_name, status FROM leads WHERE is_demo = true ORDER BY first_name`,
    );
    // 5 admin-owned leads + 2 rep-owned leads
    expect(leads.rowCount).toBe(7);

    const statuses = leads.rows.map((r) => r.status).sort();
    expect(statuses).toEqual(
      ['Contacted', 'Contacted', 'Disqualified', 'New', 'New', 'Qualified', 'Qualified'].sort(),
    );
  });

  it('sets Priya Nair disqualification_reason', async () => {
    await seedDemo();

    const lead = await pool.query<{ disqualification_reason: string }>(
      `SELECT disqualification_reason FROM leads WHERE first_name = 'Priya' AND is_demo = true`,
    );
    expect(lead.rows[0]?.disqualification_reason).toBe('Not the right fit — too small');
  });

  it('sets account_type on demo accounts', async () => {
    await seedDemo();

    const acme = await pool.query<{ account_type: string }>(
      `SELECT account_type FROM accounts WHERE name = 'Acme Corporation' AND is_demo = true`,
    );
    expect(acme.rows[0]?.account_type).toBe('Customer');

    const globex = await pool.query<{ account_type: string }>(
      `SELECT account_type FROM accounts WHERE name = 'Globex Industries' AND is_demo = true`,
    );
    expect(globex.rows[0]?.account_type).toBe('Prospect');
  });

  it('sets parent_account_id linking Globex to Acme', async () => {
    await seedDemo();

    const result = await pool.query<{ parent_name: string }>(
      `SELECT p.name AS parent_name
       FROM accounts g
       JOIN accounts p ON g.parent_account_id = p.id
       WHERE g.name = 'Globex Industries' AND g.is_demo = true`,
    );
    expect(result.rows[0]?.parent_name).toBe('Acme Corporation');
  });

  it('sets social profile URLs on the correct contacts', async () => {
    await seedDemo();

    const alice = await pool.query<{ linkedin_url: string }>(
      `SELECT linkedin_url FROM contacts WHERE first_name = 'Alice' AND last_name = 'Chen' AND is_demo = true`,
    );
    expect(alice.rows[0]?.linkedin_url).toBe('https://www.linkedin.com/in/alice-chen-demo');

    const jack = await pool.query<{ linkedin_url: string; twitter_x_url: string }>(
      `SELECT linkedin_url, twitter_x_url FROM contacts WHERE first_name = 'Jack' AND last_name = 'Wilson' AND is_demo = true`,
    );
    expect(jack.rows[0]?.linkedin_url).toBe('https://www.linkedin.com/in/jack-wilson-demo');
    expect(jack.rows[0]?.twitter_x_url).toBe('https://twitter.com/jackwilsondemo');

    const tina = await pool.query<{ linkedin_url: string }>(
      `SELECT linkedin_url FROM contacts WHERE first_name = 'Tina' AND last_name = 'Clark' AND is_demo = true`,
    );
    expect(tina.rows[0]?.linkedin_url).toBe('https://www.linkedin.com/in/tina-clark-demo');

    const mia = await pool.query<{ linkedin_url: string }>(
      `SELECT linkedin_url FROM contacts WHERE first_name = 'Mia' AND last_name = 'Thompson' AND is_demo = true`,
    );
    expect(mia.rows[0]?.linkedin_url).toBe('https://www.linkedin.com/in/mia-thompson-demo');
  });

  it('inserts 5 contact_addresses rows with is_default = true', async () => {
    await seedDemo();

    const addresses = await pool.query(
      `SELECT ca.label, ca.city, ca.is_default
       FROM contact_addresses ca
       JOIN contacts c ON ca.contact_id = c.id
       WHERE c.is_demo = true`,
    );
    expect(addresses.rowCount).toBe(5);
    expect(addresses.rows.every((r: { is_default: boolean }) => r.is_default)).toBe(true);
  });

  it('sets probability overrides on the correct deals', async () => {
    await seedDemo();

    const analyticsAddOn = await pool.query<{ probability: number }>(
      `SELECT probability FROM deals WHERE name = 'Acme — Analytics Add-on' AND is_demo = true`,
    );
    expect(analyticsAddOn.rows[0]?.probability).toBe(85);

    const erpMigration = await pool.query<{ probability: number }>(
      `SELECT probability FROM deals WHERE name = 'Globex — ERP Migration' AND is_demo = true`,
    );
    expect(erpMigration.rows[0]?.probability).toBe(40);
  });

  it('sets currency on Globex ERP and IoT deals', async () => {
    await seedDemo();

    const erp = await pool.query<{ currency: string }>(
      `SELECT currency FROM deals WHERE name = 'Globex — ERP Migration' AND is_demo = true`,
    );
    expect(erp.rows[0]?.currency).toBe('GBP');

    const iot = await pool.query<{ currency: string }>(
      `SELECT currency FROM deals WHERE name = 'Globex — IoT Integration' AND is_demo = true`,
    );
    expect(iot.rows[0]?.currency).toBe('EUR');
  });

  it('inserts 7 tags with correct junction rows', async () => {
    await seedDemo();

    // Total tag count
    const tags = await pool.query<{ name: string }>(
      `SELECT t.name FROM tags t
       WHERE t.id IN (SELECT tag_id FROM contact_tags)
          OR t.id IN (SELECT tag_id FROM account_tags)
          OR t.id IN (SELECT tag_id FROM deal_tags)`,
    );
    const tagNames = tags.rows.map((r) => r.name).sort();
    expect(tagNames).toEqual(
      [
        'at-risk',
        'conference-2026',
        'decision-maker',
        'enterprise',
        'key-account',
        'needs-renewal',
        'vip',
      ].sort(),
    );

    // vip: 2 contacts + 1 account
    const vipContacts = await pool.query(
      `SELECT ct.contact_id FROM contact_tags ct JOIN tags t ON ct.tag_id = t.id WHERE t.name = 'vip'`,
    );
    expect(vipContacts.rowCount).toBe(2);

    const vipAccounts = await pool.query(
      `SELECT at.account_id FROM account_tags at JOIN tags t ON at.tag_id = t.id WHERE t.name = 'vip'`,
    );
    expect(vipAccounts.rowCount).toBe(1);

    // conference-2026: 2 contacts
    const conf = await pool.query(
      `SELECT ct.contact_id FROM contact_tags ct JOIN tags t ON ct.tag_id = t.id WHERE t.name = 'conference-2026'`,
    );
    expect(conf.rowCount).toBe(2);

    // decision-maker: 3 contacts
    const dm = await pool.query(
      `SELECT ct.contact_id FROM contact_tags ct JOIN tags t ON ct.tag_id = t.id WHERE t.name = 'decision-maker'`,
    );
    expect(dm.rowCount).toBe(3);

    // key-account: 2 accounts
    const ka = await pool.query(
      `SELECT at.account_id FROM account_tags at JOIN tags t ON at.tag_id = t.id WHERE t.name = 'key-account'`,
    );
    expect(ka.rowCount).toBe(2);

    // needs-renewal: 1 deal
    const nr = await pool.query(
      `SELECT dt.deal_id FROM deal_tags dt JOIN tags t ON dt.tag_id = t.id WHERE t.name = 'needs-renewal'`,
    );
    expect(nr.rowCount).toBe(1);

    // at-risk: 1 deal
    const ar = await pool.query(
      `SELECT dt.deal_id FROM deal_tags dt JOIN tags t ON dt.tag_id = t.id WHERE t.name = 'at-risk'`,
    );
    expect(ar.rowCount).toBe(1);
  });

  it('inserts exactly 3 automation rules with correct trigger types', async () => {
    await seedDemo();

    const rules = await pool.query<{ trigger_type: string }>(
      `SELECT trigger_type FROM automation_rules WHERE is_demo = true`,
    );
    expect(rules.rowCount).toBe(3);

    const triggerTypes = rules.rows.map((r) => r.trigger_type).sort();
    expect(triggerTypes).toEqual(['contact_created', 'deal_created', 'deal_stage_changed'].sort());
  });
});

// ── removeDemo ────────────────────────────────────────────────────────────────

describe('removeDemo', () => {
  it('removes all demo-flagged records', async () => {
    await seedDemo();
    await removeDemo();

    const accounts = await pool.query(`SELECT id FROM accounts WHERE is_demo = true`);
    const contacts = await pool.query(`SELECT id FROM contacts WHERE is_demo = true`);
    const deals = await pool.query(`SELECT id FROM deals WHERE is_demo = true`);
    const activities = await pool.query(`SELECT id FROM activities WHERE is_demo = true`);

    expect(accounts.rowCount).toBe(0);
    expect(contacts.rowCount).toBe(0);
    expect(deals.rowCount).toBe(0);
    expect(activities.rowCount).toBe(0);
  });

  it('removes demo leads', async () => {
    await seedDemo();
    await removeDemo();

    const leads = await pool.query(`SELECT id FROM leads WHERE is_demo = true`);
    expect(leads.rowCount).toBe(0);
  });

  it('removes demo automation rules', async () => {
    await seedDemo();
    await removeDemo();

    const rules = await pool.query(`SELECT id FROM automation_rules WHERE is_demo = true`);
    expect(rules.rowCount).toBe(0);
  });

  it('removes contact_addresses linked to demo contacts', async () => {
    await seedDemo();
    await removeDemo();

    const addresses = await pool.query(
      `SELECT ca.id FROM contact_addresses ca
       JOIN contacts c ON ca.contact_id = c.id
       WHERE c.is_demo = true`,
    );
    expect(addresses.rowCount).toBe(0);
  });

  it('leaves no findings naming deleted records when removal races the producers', async () => {
    await seedDemo();

    // The producers are fire-and-forget in the controller and write outside any seed
    // transaction, so without serialization a removal landing mid-scan is overwritten by
    // findings for records it just deleted — surfacing as "Unknown" rows linking nowhere.
    await Promise.all([runPostSeedProducers(), removeDemo()]);

    const orphaned = await pool.query<{ n: string }>(
      `SELECT COUNT(*) AS n
       FROM data_hygiene_findings f
       WHERE NOT EXISTS (SELECT 1 FROM contacts c WHERE c.id = f.entity_id)
         AND NOT EXISTS (SELECT 1 FROM accounts a WHERE a.id = f.entity_id)
         AND NOT EXISTS (SELECT 1 FROM deals d WHERE d.id = f.entity_id)`,
    );
    expect(Number(orphaned.rows[0]!.n)).toBe(0);
  });

  it('leaves no findings naming deleted records when reset races the producers', async () => {
    await seedDemo();

    // resetDemo deletes the same records removeDemo does, so it needs the same lock —
    // a producer run still in flight would otherwise write findings for rows it removed.
    await Promise.all([runPostSeedProducers(), resetDemo()]);

    const orphaned = await pool.query<{ n: string }>(
      `SELECT COUNT(*) AS n
       FROM data_hygiene_findings f
       WHERE NOT EXISTS (SELECT 1 FROM contacts c WHERE c.id = f.entity_id)
         AND NOT EXISTS (SELECT 1 FROM accounts a WHERE a.id = f.entity_id)
         AND NOT EXISTS (SELECT 1 FROM deals d WHERE d.id = f.entity_id)`,
    );
    expect(Number(orphaned.rows[0]!.n)).toBe(0);
  });

  it('removes all junction rows for demo records and prunes orphaned tags', async () => {
    await seedDemo();
    await removeDemo();

    const contactTags = await pool.query(
      `SELECT ct.contact_id FROM contact_tags ct
       JOIN contacts c ON ct.contact_id = c.id
       WHERE c.is_demo = true`,
    );
    expect(contactTags.rowCount).toBe(0);

    const accountTags = await pool.query(
      `SELECT at.account_id FROM account_tags at
       JOIN accounts a ON at.account_id = a.id
       WHERE a.is_demo = true`,
    );
    expect(accountTags.rowCount).toBe(0);

    const dealTags = await pool.query(
      `SELECT dt.deal_id FROM deal_tags dt
       JOIN deals d ON dt.deal_id = d.id
       WHERE d.is_demo = true`,
    );
    expect(dealTags.rowCount).toBe(0);

    // Orphaned demo tags should be pruned (no real users applied them in test DB)
    const orphanedTags = await pool.query(
      `SELECT id FROM tags
       WHERE id NOT IN (SELECT tag_id FROM contact_tags)
         AND id NOT IN (SELECT tag_id FROM account_tags)
         AND id NOT IN (SELECT tag_id FROM deal_tags)`,
    );
    expect(orphanedTags.rowCount).toBe(0);
  });

  it('returns removed: true when demo data existed', async () => {
    await seedDemo();
    const result = await removeDemo();
    expect(result.removed).toBe(true);
  });

  it('returns removed: false with reason "not_present" when no demo data exists', async () => {
    const result = await removeDemo();
    expect(result.removed).toBe(false);
    expect(result.reason).toBe('not_present');
  });

  it('does not remove non-demo records', async () => {
    const adminId = adminUserId;
    await pool.query(
      `INSERT INTO accounts (name, owner_id, is_demo) VALUES ('Real Account', $1, false)`,
      [adminId],
    );

    await seedDemo();
    await removeDemo();

    const real = await pool.query(`SELECT id FROM accounts WHERE is_demo = false`);
    expect(real.rowCount).toBeGreaterThanOrEqual(1);
  });

  it('preserves tags applied to real (non-demo) records', async () => {
    const adminId = adminUserId;

    // Create a real account and apply the 'vip' tag to it before seeding demo data
    const realAccountResult = await pool.query<{ id: string }>(
      `INSERT INTO accounts (name, owner_id, is_demo) VALUES ('Real Corp', $1, false) RETURNING id`,
      [adminId],
    );
    const realAccountId = realAccountResult.rows[0].id;

    const tagResult = await pool.query<{ id: string }>(
      `INSERT INTO tags (name) VALUES ('vip') ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
    );
    const tagId = tagResult.rows[0].id;

    await pool.query(`INSERT INTO account_tags (account_id, tag_id) VALUES ($1, $2)`, [
      realAccountId,
      tagId,
    ]);

    await seedDemo();
    await removeDemo();

    // The 'vip' tag should survive because the real account still references it
    const surviving = await pool.query(`SELECT id FROM tags WHERE id = $1`, [tagId]);
    expect(surviving.rowCount).toBe(1);

    // Cleanup
    await pool.query(`DELETE FROM account_tags WHERE account_id = $1`, [realAccountId]);
    await pool.query(`DELETE FROM tags WHERE id = $1`, [tagId]);
    await pool.query(`DELETE FROM accounts WHERE id = $1`, [realAccountId]);
  });
});

// ── resetDemo ─────────────────────────────────────────────────────────────────

describe('resetDemo', () => {
  it('returns reset: true', async () => {
    const result = await resetDemo();
    expect(result.reset).toBe(true);
  });

  it('leaves demo data present after reset', async () => {
    await resetDemo();
    const status = await getDemoStatus();
    expect(status.active).toBe(true);
  });

  it('replaces existing demo data (not additive)', async () => {
    await seedDemo();
    const beforeAccounts = await pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM accounts WHERE is_demo = true`,
    );

    await resetDemo();

    const afterAccounts = await pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM accounts WHERE is_demo = true`,
    );

    // After reset, count should equal the initial seed count — not double
    expect(afterAccounts.rows[0].count).toBe(beforeAccounts.rows[0].count);
  });

  it('produces same leads count as a fresh seed', async () => {
    await seedDemo();
    const beforeLeads = await pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM leads WHERE is_demo = true`,
    );

    await resetDemo();

    const afterLeads = await pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM leads WHERE is_demo = true`,
    );
    expect(afterLeads.rows[0].count).toBe(beforeLeads.rows[0].count);
  });
});

// ── seedDemo — notes ──────────────────────────────────────────────────────────

describe('seedDemo — notes', () => {
  it('inserts 8 notes linked to demo entities', async () => {
    await seedDemo();

    const notes = await pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM notes
       WHERE entity_id IN (
         SELECT id FROM contacts WHERE is_demo = true
         UNION SELECT id FROM accounts WHERE is_demo = true
         UNION SELECT id FROM deals WHERE is_demo = true
       )`,
    );
    expect(parseInt(notes.rows[0].count, 10)).toBe(8);
  });

  it('notes have valid Tiptap JSON body', async () => {
    await seedDemo();

    const notes = await pool.query<{ body: string }>(
      `SELECT body FROM notes
       WHERE entity_id IN (SELECT id FROM contacts WHERE is_demo = true)
       LIMIT 1`,
    );
    expect(notes.rowCount).toBeGreaterThan(0);
    // body column is text, not jsonb — parse manually
    const body = JSON.parse(notes.rows[0].body) as Record<string, unknown>;
    expect(body).toHaveProperty('type', 'doc');
    expect(Array.isArray((body as { content: unknown[] }).content)).toBe(true);
  });

  it('notes are spread across contacts, accounts, and deals', async () => {
    await seedDemo();

    const contactNotes = await pool.query(
      `SELECT n.id FROM notes n
       JOIN contacts c ON n.entity_id = c.id
       WHERE c.is_demo = true`,
    );
    const accountNotes = await pool.query(
      `SELECT n.id FROM notes n
       JOIN accounts a ON n.entity_id = a.id
       WHERE a.is_demo = true`,
    );
    const dealNotes = await pool.query(
      `SELECT n.id FROM notes n
       JOIN deals d ON n.entity_id = d.id
       WHERE d.is_demo = true`,
    );

    expect(contactNotes.rowCount).toBeGreaterThan(0);
    expect(accountNotes.rowCount).toBeGreaterThan(0);
    expect(dealNotes.rowCount).toBeGreaterThan(0);
  });
});

// ── removeDemo — notes ────────────────────────────────────────────────────────

describe('removeDemo — notes', () => {
  it('removes all notes linked to demo entities', async () => {
    await seedDemo();
    await removeDemo();

    const notes = await pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM notes
       WHERE entity_id IN (
         SELECT id FROM contacts WHERE is_demo = true
         UNION SELECT id FROM accounts WHERE is_demo = true
         UNION SELECT id FROM deals WHERE is_demo = true
       )`,
    );
    expect(parseInt(notes.rows[0].count, 10)).toBe(0);
  });
});

// ── seedDemo — custom fields ──────────────────────────────────────────────────

describe('seedDemo — custom fields', () => {
  it('inserts 4 custom field definitions', async () => {
    await seedDemo();

    const defs = await pool.query<{ name: string; entity_type: string; field_type: string }>(
      `SELECT name, entity_type, field_type FROM custom_field_definitions
       WHERE name = ANY($1::text[])
       ORDER BY name`,
      [DEMO_CUSTOM_FIELD_NAMES],
    );
    expect(defs.rowCount).toBe(4);
  });

  it('inserts correct field types for each definition', async () => {
    await seedDemo();

    const defs = await pool.query<{ name: string; field_type: string }>(
      `SELECT name, field_type FROM custom_field_definitions
       WHERE name = ANY($1::text[])`,
      [DEMO_CUSTOM_FIELD_NAMES],
    );
    const byName = Object.fromEntries(defs.rows.map((r) => [r.name, r.field_type]));
    expect(byName['LinkedIn URL']).toBe('text');
    expect(byName['Lead Source Detail']).toBe('select');
    expect(byName['Contract Signed Date']).toBe('date');
    expect(byName['Estimated ARR']).toBe('number');
  });

  it('inserts select options for Lead Source Detail', async () => {
    await seedDemo();

    const def = await pool.query<{ options: string[] }>(
      `SELECT options FROM custom_field_definitions WHERE name = 'Lead Source Detail'`,
    );
    // pg returns jsonb as a parsed JS value
    const opts = def.rows[0].options;
    expect(Array.isArray(opts)).toBe(true);
    expect(opts.length).toBeGreaterThan(0);
  });

  it('inserts custom field values for demo contacts and deals', async () => {
    await seedDemo();

    const values = await pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM custom_field_values
       WHERE record_id IN (
         SELECT id FROM contacts WHERE is_demo = true
         UNION SELECT id FROM deals WHERE is_demo = true
       )`,
    );
    expect(parseInt(values.rows[0].count, 10)).toBeGreaterThan(0);
  });

  it('is idempotent — second seed does not duplicate definitions', async () => {
    await seedDemo();
    await removeDemo();
    await seedDemo();

    const defs = await pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM custom_field_definitions WHERE name = ANY($1::text[])`,
      [DEMO_CUSTOM_FIELD_NAMES],
    );
    expect(parseInt(defs.rows[0].count, 10)).toBe(4);
  });
});

// ── removeDemo — custom fields ────────────────────────────────────────────────

describe('removeDemo — custom fields', () => {
  it('removes demo custom field definitions and their values', async () => {
    await seedDemo();
    await removeDemo();

    const defs = await pool.query(
      `SELECT id FROM custom_field_definitions WHERE name = ANY($1::text[])`,
      [DEMO_CUSTOM_FIELD_NAMES],
    );
    expect(defs.rowCount).toBe(0);
  });
});

// ── seedDemo — webhooks ───────────────────────────────────────────────────────

describe('seedDemo — webhooks', () => {
  it('inserts 2 demo webhook subscriptions', async () => {
    await seedDemo();

    const webhooks = await pool.query(
      `SELECT url, events FROM webhook_subscriptions WHERE url = ANY($1::text[])`,
      [DEMO_WEBHOOK_URLS],
    );
    expect(webhooks.rowCount).toBe(2);
  });

  it('stores a non-empty secret_hash for each webhook', async () => {
    await seedDemo();

    const webhooks = await pool.query<{ secret_hash: string }>(
      `SELECT secret_hash FROM webhook_subscriptions WHERE url = ANY($1::text[])`,
      [DEMO_WEBHOOK_URLS],
    );
    for (const row of webhooks.rows) {
      expect(typeof row.secret_hash).toBe('string');
      expect(row.secret_hash.length).toBeGreaterThan(0);
    }
  });

  it('Slack webhook subscribes to deal.won and deal.lost events', async () => {
    await seedDemo();

    const slack = await pool.query<{ events: string[] }>(
      `SELECT events FROM webhook_subscriptions
       WHERE url = 'https://hooks.example.com/slack/minicrm-deals'`,
    );
    expect(slack.rowCount).toBe(1);
    // pg returns arrays as JS arrays for array columns
    const events = slack.rows[0].events;
    expect(events).toContain('deal.won');
    expect(events).toContain('deal.lost');
  });

  it('Zapier webhook subscribes to contact.created and contact.updated events', async () => {
    await seedDemo();

    const zapier = await pool.query<{ events: string[] }>(
      `SELECT events FROM webhook_subscriptions
       WHERE url = 'https://hooks.zapier.com/example/minicrm'`,
    );
    expect(zapier.rowCount).toBe(1);
    const events = zapier.rows[0].events;
    expect(events).toContain('contact.created');
    expect(events).toContain('contact.updated');
  });
});

// ── removeDemo — webhooks ─────────────────────────────────────────────────────

describe('removeDemo — webhooks', () => {
  it('removes demo webhook subscriptions', async () => {
    await seedDemo();
    await removeDemo();

    const webhooks = await pool.query(
      `SELECT id FROM webhook_subscriptions WHERE url = ANY($1::text[])`,
      [DEMO_WEBHOOK_URLS],
    );
    expect(webhooks.rowCount).toBe(0);
  });
});

// ── seedDemo — currencies ─────────────────────────────────────────────────────

describe('seedDemo — currencies', () => {
  it('inserts GBP, EUR, CAD, and JPY exchange rates', async () => {
    await seedDemo();

    const currencies = await pool.query<{ code: string; rate_to_home: string }>(
      `SELECT code, rate_to_home FROM currencies WHERE code = ANY($1::text[]) ORDER BY code`,
      [DEMO_CURRENCY_CODES],
    );
    expect(currencies.rowCount).toBe(4);

    const byCode = Object.fromEntries(
      currencies.rows.map((r) => [r.code, parseFloat(r.rate_to_home)]),
    );
    expect(byCode['GBP']).toBeCloseTo(1.27, 2);
    expect(byCode['EUR']).toBeCloseTo(1.09, 2);
    expect(byCode['CAD']).toBeCloseTo(0.73, 2);
    expect(byCode['JPY']).toBeCloseTo(0.0067, 4);
  });

  it('inserted currencies are not the home currency', async () => {
    await seedDemo();

    const currencies = await pool.query<{ is_home: boolean }>(
      `SELECT is_home FROM currencies WHERE code = ANY($1::text[])`,
      [DEMO_CURRENCY_CODES],
    );
    expect(currencies.rows.every((r) => r.is_home === false)).toBe(true);
  });

  it('is idempotent — second seed does not create duplicate currencies', async () => {
    await seedDemo();
    await removeDemo();
    await seedDemo();

    const currencies = await pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM currencies WHERE code = ANY($1::text[])`,
      [DEMO_CURRENCY_CODES],
    );
    expect(parseInt(currencies.rows[0].count, 10)).toBe(4);
  });
});

// ── removeDemo — currencies ───────────────────────────────────────────────────

describe('removeDemo — currencies', () => {
  it('removes demo currencies after removeDemo', async () => {
    await seedDemo();
    await removeDemo();

    const currencies = await pool.query(
      `SELECT code FROM currencies WHERE code = ANY($1::text[]) AND is_home = false`,
      [DEMO_CURRENCY_CODES],
    );
    expect(currencies.rowCount).toBe(0);
  });
});

// ── seedDemo — pipeline ─────────────────────────────────────────

describe('seedDemo — pipeline', () => {
  it('creates the Enterprise B2B pipeline as a non-default pipeline', async () => {
    await seedDemo();

    const pipeline = await pool.query<{ name: string; is_default: boolean }>(
      `SELECT name, is_default FROM pipelines WHERE name = $1`,
      [DEMO_PIPELINE_NAME],
    );
    expect(pipeline.rowCount).toBe(1);
    expect(pipeline.rows[0].is_default).toBe(false);
  });

  it('Enterprise B2B pipeline has all 7 expected stages in sort order', async () => {
    await seedDemo();

    const stages = await pool.query<{ name: string; sort_order: number; probability: number }>(
      `SELECT name, sort_order, probability
       FROM pipeline_stages
       WHERE pipeline_id = (SELECT id FROM pipelines WHERE name = $1)
       ORDER BY sort_order`,
      [DEMO_PIPELINE_NAME],
    );
    expect(stages.rowCount).toBe(7);
    expect(stages.rows.map((r) => r.name)).toEqual(DEMO_PIPELINE_STAGE_NAMES);
  });

  it('Technical Validation has probability 60, Contract Review has probability 85', async () => {
    await seedDemo();

    const stages = await pool.query<{ name: string; probability: number }>(
      `SELECT name, probability
       FROM pipeline_stages
       WHERE pipeline_id = (SELECT id FROM pipelines WHERE name = $1)
         AND name = ANY($2::text[])`,
      [DEMO_PIPELINE_NAME, ['Technical Validation', 'Contract Review']],
    );
    const byName = Object.fromEntries(stages.rows.map((r) => [r.name, r.probability]));
    expect(byName['Technical Validation']).toBe(60);
    expect(byName['Contract Review']).toBe(85);
  });

  it('Enterprise B2B stages are not is_fixed', async () => {
    await seedDemo();

    const stages = await pool.query<{ is_fixed: boolean }>(
      `SELECT is_fixed FROM pipeline_stages
       WHERE pipeline_id = (SELECT id FROM pipelines WHERE name = $1)`,
      [DEMO_PIPELINE_NAME],
    );
    expect(stages.rows.every((r) => r.is_fixed === false)).toBe(true);
  });

  it('deals on Technical Validation and Contract Review are linked to the Enterprise B2B pipeline', async () => {
    await seedDemo();

    for (const stageName of ['Technical Validation', 'Contract Review']) {
      const deals = await pool.query<{ count: string }>(
        `SELECT COUNT(*) AS count
         FROM deals
         WHERE stage = $1 AND is_demo = true
           AND pipeline_id = (SELECT id FROM pipelines WHERE name = $2)`,
        [stageName, DEMO_PIPELINE_NAME],
      );
      expect(parseInt(deals.rows[0].count, 10)).toBeGreaterThanOrEqual(1);
    }
  });

  it('default pipeline still has only 6 stages after seeding', async () => {
    await seedDemo();

    const stages = await pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM pipeline_stages WHERE pipeline_id = (SELECT id FROM pipelines WHERE is_default = true)`,
    );
    expect(parseInt(stages.rows[0].count, 10)).toBe(6);
  });

  it('is idempotent — seeding twice produces exactly one Enterprise B2B pipeline', async () => {
    await seedDemo();
    await removeDemo();
    await seedDemo();

    const pipelines = await pool.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM pipelines WHERE name = $1`,
      [DEMO_PIPELINE_NAME],
    );
    expect(parseInt(pipelines.rows[0].count, 10)).toBe(1);
  });
});

// ── removeDemo — pipeline ───────────────────────────────────────

describe('removeDemo — pipeline', () => {
  it('removes the Enterprise B2B pipeline after removeDemo', async () => {
    await seedDemo();
    await removeDemo();

    const pipeline = await pool.query(`SELECT id FROM pipelines WHERE name = $1`, [
      DEMO_PIPELINE_NAME,
    ]);
    expect(pipeline.rowCount).toBe(0);
  });

  it('Enterprise B2B stages are removed via cascade after removeDemo', async () => {
    await seedDemo();
    await removeDemo();

    const stages = await pool.query(
      `SELECT name FROM pipeline_stages WHERE name = ANY($1::text[])
         AND pipeline_id NOT IN (SELECT id FROM pipelines WHERE is_default = true)`,
      [DEMO_PIPELINE_STAGE_NAMES],
    );
    expect(stages.rowCount).toBe(0);
  });

  it('default pipeline and its six stages remain intact after removeDemo', async () => {
    const DEFAULT_STAGE_NAMES = [
      'Prospecting',
      'Qualification',
      'Proposal',
      'Negotiation',
      'Closed Won',
      'Closed Lost',
    ];
    await seedDemo();
    await removeDemo();

    const stages = await pool.query<{ name: string }>(
      `SELECT name FROM pipeline_stages
       WHERE pipeline_id = (SELECT id FROM pipelines WHERE is_default = true)`,
    );
    expect(stages.rowCount).toBe(6);
    expect(stages.rows.map((r) => r.name).sort()).toEqual([...DEFAULT_STAGE_NAMES].sort());
  });

  it('Closed Won and Closed Lost in the default pipeline remain is_fixed = true', async () => {
    await seedDemo();
    await removeDemo();

    const fixed = await pool.query<{ is_fixed: boolean }>(
      `SELECT is_fixed FROM pipeline_stages
       WHERE name IN ('Closed Won', 'Closed Lost')
         AND pipeline_id = (SELECT id FROM pipelines WHERE is_default = true)`,
    );
    expect(fixed.rowCount).toBe(2);
    expect(fixed.rows.every((r) => r.is_fixed === true)).toBe(true);
  });
});

/**
 * The seed writes no data_hygiene_findings rows — runDataHygieneScan produces them, and
 * deletes any finding it does not re-detect, so hand-written rows would not survive.
 *
 * These run the REAL gatherers via gatherOfflineHygieneSignals rather than restating
 * their SQL: a test that copies a predicate stays green while the gatherer drifts away
 * from it, which is the regression it exists to catch. The two network signals are
 * excluded from that helper, so no DNS or outbound HTTP enters the test path.
 */
describe('seedDemo — data hygiene fixtures', () => {
  /**
   * Counts findings per issue type, restricted to demo-flagged records. The gatherers
   * scan every record in the database, and this file shares minicrm_test with specs
   * that leave their own fixtures behind — an unrestricted count is theirs to change.
   */
  async function seedAndGather(): Promise<Map<string, number>> {
    await seedDemo();
    const config = await getHygieneConfig();
    const findings = await gatherOfflineHygieneSignals(config);

    const demoIds = await pool.query<{ id: string }>(
      `SELECT id FROM contacts WHERE is_demo = true
       UNION SELECT id FROM accounts WHERE is_demo = true
       UNION SELECT id FROM deals WHERE is_demo = true`,
    );
    const demoIdSet = new Set(demoIds.rows.map((row) => row.id));

    const byIssue = new Map<string, number>();
    for (const finding of findings) {
      if (!demoIdSet.has(finding.entityId)) continue;
      byIssue.set(finding.issueType, (byIssue.get(finding.issueType) ?? 0) + 1);
    }
    return byIssue;
  }

  it('trips every offline contact signal', async () => {
    const byIssue = await seedAndGather();

    expect(byIssue.get('contact_missing_contact_info')).toBe(1);
    expect(byIssue.get('contact_stale_title')).toBe(1);
    // The seeded pair yields one finding per member.
    expect(byIssue.get('contact_duplicate')).toBe(2);
    expect(byIssue.get('contact_no_activity')).toBeGreaterThan(0);
  });

  it('trips every offline account signal', async () => {
    const byIssue = await seedAndGather();

    // Both hygiene accounts take no contacts and each omits one firmographic —
    // overlapping signals on one record are what a real queue looks like.
    expect(byIssue.get('account_no_contacts')).toBe(2);
    expect(byIssue.get('account_missing_firmographics')).toBe(2);
    expect(byIssue.get('account_no_activity')).toBeGreaterThan(0);
  });

  it('trips every offline opportunity signal', async () => {
    const byIssue = await seedAndGather();

    expect(byIssue.get('opportunity_zero_value')).toBe(1);
    expect(byIssue.get('opportunity_close_date_passed')).toBe(1);
    // Every seeded deal is linked to a contact except these two, which are appended
    // outside both deal-seeding loops.
    expect(byIssue.get('opportunity_no_contact')).toBe(2);
    expect(byIssue.get('opportunity_no_activity')).toBeGreaterThan(0);
  });

  it('covers every offline signal, so the queue is never empty', async () => {
    const byIssue = await seedAndGather();

    // The offline helper by construction excludes the two network signals, so this is
    // the offline set only — the persisted queue is asserted separately below.
    expect([...byIssue.keys()].sort()).toEqual([
      'account_missing_firmographics',
      'account_no_activity',
      'account_no_contacts',
      'contact_duplicate',
      'contact_missing_contact_info',
      'contact_no_activity',
      'contact_stale_title',
      'opportunity_close_date_passed',
      'opportunity_no_activity',
      'opportunity_no_contact',
      'opportunity_zero_value',
    ]);
  });

  it('produces no website findings for the reserved demo domains', async () => {
    await seedDemo();
    await runDataHygieneScan();

    // Every demo website is a *.example.com name, which cannot resolve by definition.
    // Treating that as proof of a dead site would report our own fixtures as customer
    // defects — the same false positive the mail signal already guards against.
    const website = await pool.query(
      `SELECT f.id FROM data_hygiene_findings f
       JOIN accounts a ON a.id = f.entity_id
       WHERE a.is_demo = true AND f.issue_type = 'account_website_unreachable'`,
    );
    expect(website.rowCount).toBe(0);
  });

  it('gives the duplicate finding a counterpart, so Merge is reachable', async () => {
    await seedDemo();
    const config = await getHygieneConfig();
    const findings = await gatherOfflineHygieneSignals(config);

    const demoContacts = await pool.query<{ id: string }>(
      `SELECT id FROM contacts WHERE is_demo = true`,
    );
    const demoContactIds = new Set(demoContacts.rows.map((row) => row.id));
    const duplicates = findings.filter(
      (f) => f.issueType === 'contact_duplicate' && demoContactIds.has(f.entityId),
    );
    expect(duplicates).toHaveLength(2);
    expect(duplicates.every((f) => f.relatedEntityId !== undefined)).toBe(true);
  });

  it('owns every hygiene fixture as the admin, whose queue /hygiene shows', async () => {
    await seedDemo();
    const config = await getHygieneConfig();
    const findings = await gatherOfflineHygieneSignals(config);

    // The redistribution step reassigns most demo records to reps. /hygiene filters on
    // the caller's own owner_id, so a fixture that drifted to a rep would vanish from
    // the admin's queue — asserting on the findings covers all three entity types at once.
    const admin = await pool.query<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [
      ADMIN_USER.email,
    ]);
    const adminId = admin.rows[0]!.id;

    const fixtureNames = await pool.query<{ id: string }>(
      `SELECT id FROM accounts WHERE is_demo = true AND name IN ('Northwind Traders', 'Contoso Analytics')
       UNION SELECT id FROM contacts WHERE is_demo = true AND last_name IN ('Raghunathan', 'Lindqvist', 'Delacroix')
       UNION SELECT id FROM deals WHERE is_demo = true AND name IN ('Northwind — Unscoped Renewal', 'Contoso — Stalled Pilot')`,
    );
    const fixtureIds = new Set(fixtureNames.rows.map((row) => row.id));
    expect(fixtureIds.size).toBe(8);

    const fixtureFindings = findings.filter((f) => fixtureIds.has(f.entityId));
    expect(fixtureFindings.length).toBeGreaterThan(0);
    expect(fixtureFindings.every((f) => f.ownerId === adminId)).toBe(true);
  });
});

describe('seedDemo — rep coaching fixtures', () => {
  it('gives every selectable rep enough closed deals to clear the threshold', async () => {
    await seedDemo();

    // Asserted against the shipped default rather than the live config row: that row is a
    // globally mutable singleton other specs in this database write to, so reading it here
    // makes this test's outcome depend on run order. The seed's own contract is a fixed
    // per-rep count, which is what this pins.
    const MIGRATION_DEFAULT_MIN_CLOSED_DEALS = 10;

    // The page defaults to the first rep by name, so a rep below the threshold anywhere
    // in the list can be the one a reader lands on.
    // LEFT JOIN and the same role pair listReps/getCoachingTeamOverview select: an inner
    // join drops a user with no deals entirely, which is precisely the case that renders
    // as insufficient data, and 'rep' alone omits the two managers in that selector.
    // Scoped to the seed's own users — this database is shared, and a sibling spec's
    // leftover rep is not this seed's to satisfy.
    const perRep = await pool.query<{ name: string; closed: string }>(
      `SELECT u.name, COUNT(d.id) FILTER (WHERE d.stage IN ('Closed Won', 'Closed Lost')) AS closed
       FROM users u
       LEFT JOIN deals d ON d.owner_id = u.id
       WHERE u.role IN ('rep', 'manager') AND u.status = 'active'
         AND (u.email LIKE '%@demo.minicrm.dev' OR u.email = 'alex.rivera@demo.minicrm.app')
       GROUP BY u.id, u.name`,
    );
    expect(perRep.rowCount).toBeGreaterThan(0);
    for (const row of perRep.rows) {
      expect(
        Number(row.closed),
        `${row.name} is below the coaching minimum`,
      ).toBeGreaterThanOrEqual(MIGRATION_DEFAULT_MIN_CLOSED_DEALS);
    }
  });

  it('writes stage history with real durations, which the stage-time metric needs', async () => {
    await seedDemo();

    // entered_at defaults to now(), so history written without explicit timestamps gives
    // every stage a zero duration. Asserted per rep: a table-wide check passes even when
    // most reps got no usable history.
    // LEFT JOIN for the same reason as the test above: an inner join hides the failure.
    const perRep = await pool.query<{ name: string; avg_days: string | null }>(
      `WITH durations AS (
         SELECT d.owner_id,
                EXTRACT(EPOCH FROM (
                  LEAD(h.entered_at) OVER (PARTITION BY h.deal_id ORDER BY h.entered_at) - h.entered_at
                )) / 86400.0 AS days
         FROM deal_stage_history h
         JOIN deals d ON d.id = h.deal_id
         WHERE d.is_demo = true
       )
       SELECT u.name, AVG(durations.days)::text AS avg_days
       FROM users u
       LEFT JOIN durations ON durations.owner_id = u.id AND durations.days IS NOT NULL
       WHERE u.role IN ('rep', 'manager') AND u.status = 'active'
         AND (u.email LIKE '%@demo.minicrm.dev' OR u.email = 'alex.rivera@demo.minicrm.app')
       GROUP BY u.id, u.name`,
    );
    expect(perRep.rowCount).toBeGreaterThan(0);
    for (const row of perRep.rows) {
      expect(Number(row.avg_days), `${row.name} has no measurable stage time`).toBeGreaterThan(0);
    }
  });

  it('generates coaching insights, which the page reads', async () => {
    await seedDemo();
    // The seed shapes the inputs; this generator writes the rows the page renders.
    await generateRepCoachingInsights();

    // Scoped for the same reason: a sibling spec writes this table too.
    const perRep = await pool.query<{ name: string; n: string }>(
      `SELECT u.name, COUNT(i.id) AS n
       FROM users u
       LEFT JOIN rep_coaching_insights i ON i.rep_id = u.id
       WHERE u.role IN ('rep', 'manager') AND u.status = 'active'
         AND (u.email LIKE '%@demo.minicrm.dev' OR u.email = 'alex.rivera@demo.minicrm.app')
       GROUP BY u.id, u.name`,
    );
    expect(perRep.rowCount).toBeGreaterThan(0);
    for (const row of perRep.rows) {
      expect(Number(row.n), `${row.name} has no coaching insights`).toBeGreaterThan(0);
    }

    // Non-zero counts alone pass on entirely degenerate output — every rep matching the
    // team average exactly, which is what the page showed before the fixture varied.
    const varied = await pool.query<{ n: string }>(
      `SELECT COUNT(*) AS n
       FROM rep_coaching_insights i
       JOIN users u ON u.id = i.rep_id
       WHERE i.metric_type = 'stage_conversion_rate' AND i.rep_value <> 1
         AND (u.email LIKE '%@demo.minicrm.dev' OR u.email = 'alex.rivera@demo.minicrm.app')`,
    );
    expect(Number(varied.rows[0]!.n)).toBeGreaterThan(0);
  });
});

describe('removeDemo — data hygiene findings', () => {
  it('removes admin-owned findings, which no foreign key cascades', async () => {
    await seedDemo();

    // owner_id cascades from users, so a finding owned by a demo user would be deleted
    // even with the new statement absent. Only an admin-owned one exercises it.
    const contact = await pool.query<{ id: string; owner_id: string }>(
      `SELECT c.id, c.owner_id FROM contacts c
       JOIN users u ON u.id = c.owner_id
       WHERE c.is_demo = true AND u.role = 'admin' ORDER BY c.id LIMIT 1`,
    );
    expect(contact.rowCount).toBe(1);
    await pool.query(
      `INSERT INTO data_hygiene_findings
         (entity_type, entity_id, issue_type, owner_id, suggested_action)
       VALUES ('contact', $1, 'contact_no_activity', $2, 'Log a call or email.')`,
      [contact.rows[0].id, contact.rows[0].owner_id],
    );

    await removeDemo();

    const remaining = await pool.query(
      `SELECT id FROM data_hygiene_findings WHERE entity_id = $1`,
      [contact.rows[0].id],
    );
    expect(remaining.rowCount).toBe(0);
  });
});
