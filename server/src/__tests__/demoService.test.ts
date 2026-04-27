/**
 * Integration tests for demoService.
 * Verifies seed, remove, reset, and status operations against a real test DB. (MINCRM-103, MINCRM-206)
 *
 * Runs against the minicrm_test database.
 */

import 'dotenv/config';
import { createUser } from '../services/userService.js';
import { getDemoStatus, seedDemo, removeDemo, resetDemo } from '../services/demoService.js';
import pool from '../db.js';

const ADMIN_USER = {
  email: 'demo-svc-admin@example.com',
  name: 'Demo Service Admin',
  role: 'admin' as const,
  passwordHash: '$2b$12$placeholder_hash',
  status: 'active' as const,
};

async function cleanDemoData(): Promise<void> {
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
  await pool.query(`DELETE FROM contacts WHERE is_demo = true`);
  await pool.query(`DELETE FROM accounts WHERE is_demo = true`);
  // Remove demo rep user — created by insertDemoData, not covered by is_demo flag (MINCRM-267)
  await pool.query(`DELETE FROM users WHERE email = 'alex.rivera@demo.minicrm.app'`);
}

beforeAll(async () => {
  await cleanDemoData();
  await pool.query('DELETE FROM users WHERE email = $1', [ADMIN_USER.email]);
  await createUser(ADMIN_USER);
});

beforeEach(async () => {
  await cleanDemoData();
});

afterAll(async () => {
  const adminResult = await pool.query<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [
    ADMIN_USER.email,
  ]);
  const adminId = adminResult.rows[0]?.id;

  if (adminId) {
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
    await pool.query(`DELETE FROM contacts WHERE is_demo = true OR owner_id = $1`, [adminId]);
    await pool.query(`DELETE FROM accounts WHERE is_demo = true OR owner_id = $1`, [adminId]);
  }
  await pool.query('DELETE FROM users WHERE email = $1', [ADMIN_USER.email]);
  await pool.query(`DELETE FROM users WHERE email = 'alex.rivera@demo.minicrm.app'`);
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
    // 5 admin-owned leads + 2 rep-owned leads (MINCRM-267)
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

  it('inserts 2 contact_addresses rows with is_default = true', async () => {
    await seedDemo();

    const addresses = await pool.query(
      `SELECT ca.label, ca.city, ca.is_default
       FROM contact_addresses ca
       JOIN contacts c ON ca.contact_id = c.id
       WHERE c.is_demo = true`,
    );
    expect(addresses.rowCount).toBe(2);
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
    const adminResult = await pool.query<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [
      ADMIN_USER.email,
    ]);
    const adminId = adminResult.rows[0].id;
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
    const adminResult = await pool.query<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [
      ADMIN_USER.email,
    ]);
    const adminId = adminResult.rows[0].id;

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
