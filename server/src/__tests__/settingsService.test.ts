/**
 * Integration tests for settingsService.
 *
 * Runs against a real PostgreSQL test database.
 * The system_settings table is restored to its default state after each test.
 *
 * Run: npm test (from /server)
 */

import 'dotenv/config';
import {
  getDefaultLanguage,
  setDefaultLanguage,
  getNavLayout,
  setNavLayout,
  getEmailNotificationsEnabled,
  setEmailNotificationsEnabled,
  getDefaultCurrency,
  setDefaultCurrency,
  getOnboardingStatus,
  setOnboardingCompleted,
  markPipelineStagesReviewed,
} from '../services/settingsService.js';
import { getDefaultPipelineId } from '../services/pipelineService.js';
import pool from '../db.js';

beforeEach(async () => {
  // Reset to seeded defaults before each test
  await pool.query(
    `INSERT INTO system_settings (key, value, updated_at)
     VALUES ('default_language', 'en', now()),
            ('nav_layout', 'top', now()),
            ('email_notifications_enabled', 'true', now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
  );
});

describe('getDefaultLanguage', () => {
  it('returns "en" when no override has been set', async () => {
    const language = await getDefaultLanguage();
    expect(language).toBe('en');
  });

  it('returns the language that was last set', async () => {
    await pool.query(`UPDATE system_settings SET value = 'fr' WHERE key = 'default_language'`);
    const language = await getDefaultLanguage();
    expect(language).toBe('fr');
  });

  it('falls back to "en" when the row is missing', async () => {
    await pool.query(`DELETE FROM system_settings WHERE key = 'default_language'`);
    const language = await getDefaultLanguage();
    expect(language).toBe('en');
  });

  it('falls back to "en" when the stored value is an unsupported locale', async () => {
    await pool.query(`UPDATE system_settings SET value = 'xx' WHERE key = 'default_language'`);
    const language = await getDefaultLanguage();
    expect(language).toBe('en');
  });
});

describe('setDefaultLanguage', () => {
  it('persists and returns the new language', async () => {
    const result = await setDefaultLanguage('zh-Hans');
    expect(result).toBe('zh-Hans');

    const fetched = await getDefaultLanguage();
    expect(fetched).toBe('zh-Hans');
  });

  it('overwrites a previously set language', async () => {
    await setDefaultLanguage('de');
    await setDefaultLanguage('es');
    const fetched = await getDefaultLanguage();
    expect(fetched).toBe('es');
  });

  it('handles all supported locales without error', async () => {
    const locales = ['en', 'zh-Hans', 'es', 'fr', 'de'] as const;
    for (const locale of locales) {
      await expect(setDefaultLanguage(locale)).resolves.toBe(locale);
    }
  });
});

// ── getNavLayout ─────────────────────────��─────────────────��──────────────────

describe('getNavLayout', () => {
  it('returns "top" when the default row is present', async () => {
    const layout = await getNavLayout();
    expect(layout).toBe('top');
  });

  it('returns the layout that was last set', async () => {
    await pool.query(`UPDATE system_settings SET value = 'left' WHERE key = 'nav_layout'`);
    const layout = await getNavLayout();
    expect(layout).toBe('left');
  });

  it('falls back to "top" when the row is missing', async () => {
    await pool.query(`DELETE FROM system_settings WHERE key = 'nav_layout'`);
    const layout = await getNavLayout();
    expect(layout).toBe('top');
  });

  it('falls back to "top" when the stored value is an unsupported layout', async () => {
    await pool.query(`UPDATE system_settings SET value = 'unknown' WHERE key = 'nav_layout'`);
    const layout = await getNavLayout();
    expect(layout).toBe('top');
  });
});

// ── setNavLayout ──────────────────────────────────────────────────────────────

describe('setNavLayout', () => {
  it('persists and returns the new layout', async () => {
    const result = await setNavLayout('left');
    expect(result).toBe('left');

    const fetched = await getNavLayout();
    expect(fetched).toBe('left');
  });

  it('overwrites a previously set layout', async () => {
    await setNavLayout('left');
    await setNavLayout('hamburger');
    const fetched = await getNavLayout();
    expect(fetched).toBe('hamburger');
  });

  it('handles all supported layouts without error', async () => {
    const layouts = ['top', 'left', 'hamburger'] as const;
    for (const layout of layouts) {
      await expect(setNavLayout(layout)).resolves.toBe(layout);
    }
  });
});

// ── getEmailNotificationsEnabled ─────────────────────────────────

describe('getEmailNotificationsEnabled', () => {
  it('returns true when the setting is "true"', async () => {
    const enabled = await getEmailNotificationsEnabled();
    expect(enabled).toBe(true);
  });

  it('returns false when the setting is "false"', async () => {
    await pool.query(
      `UPDATE system_settings SET value = 'false' WHERE key = 'email_notifications_enabled'`,
    );
    const enabled = await getEmailNotificationsEnabled();
    expect(enabled).toBe(false);
  });

  it('defaults to true when the row is missing', async () => {
    await pool.query(`DELETE FROM system_settings WHERE key = 'email_notifications_enabled'`);
    const enabled = await getEmailNotificationsEnabled();
    expect(enabled).toBe(true);
  });
});

// ── setEmailNotificationsEnabled ─────────────────────────────────

describe('setEmailNotificationsEnabled', () => {
  it('persists false and returns false', async () => {
    const result = await setEmailNotificationsEnabled(false);
    expect(result).toBe(false);
    expect(await getEmailNotificationsEnabled()).toBe(false);
  });

  it('persists true and returns true', async () => {
    await setEmailNotificationsEnabled(false);
    const result = await setEmailNotificationsEnabled(true);
    expect(result).toBe(true);
    expect(await getEmailNotificationsEnabled()).toBe(true);
  });
});

// ── getDefaultCurrency ───────────────────────────────────────────

describe('getDefaultCurrency', () => {
  beforeEach(async () => {
    await pool.query(`DELETE FROM system_settings WHERE key = 'default_currency'`);
  });

  it('returns "USD" when the row is missing', async () => {
    const currency = await getDefaultCurrency();
    expect(currency).toBe('USD');
  });

  it('returns the stored currency when set', async () => {
    await pool.query(
      `INSERT INTO system_settings (key, value, updated_at) VALUES ('default_currency', 'EUR', now())`,
    );
    const currency = await getDefaultCurrency();
    expect(currency).toBe('EUR');
  });

  it('falls back to "USD" when the stored value is unsupported', async () => {
    await pool.query(
      `INSERT INTO system_settings (key, value, updated_at) VALUES ('default_currency', 'XYZ', now())`,
    );
    const currency = await getDefaultCurrency();
    expect(currency).toBe('USD');
  });
});

// ── setDefaultCurrency ───────────────────────────────────────────

describe('setDefaultCurrency', () => {
  beforeEach(async () => {
    await pool.query(`DELETE FROM system_settings WHERE key = 'default_currency'`);
  });

  afterAll(async () => {
    // The "all supported currencies" test below leaves default_currency set to
    // whichever code is last in its list (CHF) — deleting the row restores the
    // USD fallback so this doesn't leak into other test files/suites that read
    // getDefaultCurrency() (e.g. proposalDraftService.test.ts).
    await pool.query(`DELETE FROM system_settings WHERE key = 'default_currency'`);
  });

  it('persists and returns the new currency', async () => {
    const result = await setDefaultCurrency('GBP');
    expect(result).toBe('GBP');
    expect(await getDefaultCurrency()).toBe('GBP');
  });

  it('overwrites a previously set currency', async () => {
    await setDefaultCurrency('EUR');
    await setDefaultCurrency('JPY');
    expect(await getDefaultCurrency()).toBe('JPY');
  });

  it('handles all supported currencies without error', async () => {
    const currencies = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'CHF'] as const;
    for (const code of currencies) {
      await expect(setDefaultCurrency(code)).resolves.toBe(code);
    }
  });
});

// ── getOnboardingStatus / setOnboardingCompleted ──

const ADMIN_TASK_IDS = [
  'pipeline_stages_reviewed',
  'team_member_invited',
  'first_contact_added',
  'first_deal_created',
  'smtp_configured',
];

const REP_TASK_IDS = [
  'first_contact_added',
  'first_account_created',
  'first_deal_created',
  'logged_first_activity',
];

/** IDs for test users created in this describe block */
let adminUserId: string;
let repUserId: string;

describe('getOnboardingStatus — admin caller', () => {
  beforeAll(async () => {
    // Create a dedicated admin user for these tests
    const adminResult = await pool.query<{ id: string }>(
      `INSERT INTO users (email, name, role, status, password_hash)
       VALUES ('settings-svc-admin@test.com', 'Settings Admin', 'admin', 'active', 'x')
       RETURNING id`,
    );
    adminUserId = adminResult.rows[0].id;
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM users WHERE email = 'settings-svc-admin@test.com'`);
  });

  beforeEach(async () => {
    await pool.query(`DELETE FROM system_settings WHERE key IN ('pipeline_stages_reviewed')`);
    await pool.query(`UPDATE smtp_configuration SET host = '', updated_at = now()`);
    // Ensure admin's onboarding flag is false before each test
    await pool.query(`UPDATE users SET onboarding_completed = false WHERE id = $1`, [adminUserId]);
    // Remove any seeded contacts/deals from test isolation
    await pool.query('TRUNCATE contacts, accounts, deals, activities RESTART IDENTITY CASCADE');
  });

  it('returns is_first_run=true and five tasks when flag is false', async () => {
    const status = await getOnboardingStatus({ id: adminUserId, role: 'admin' });
    expect(status.is_first_run).toBe(true);
    expect(status.onboarding_completed).toBe(false);
    expect(status.tasks.map((t) => t.id)).toEqual(ADMIN_TASK_IDS);
  });

  it('returns is_first_run=false when onboarding_completed is true on user row', async () => {
    await pool.query(`UPDATE users SET onboarding_completed = true WHERE id = $1`, [adminUserId]);
    const status = await getOnboardingStatus({ id: adminUserId, role: 'admin' });
    expect(status.is_first_run).toBe(false);
    expect(status.onboarding_completed).toBe(true);
    // Tasks still returned
    expect(status.tasks).toHaveLength(5);
  });

  it('task pipeline_stages_reviewed is false by default', async () => {
    const status = await getOnboardingStatus({ id: adminUserId, role: 'admin' });
    const task = status.tasks.find((t) => t.id === 'pipeline_stages_reviewed');
    expect(task?.completed).toBe(false);
  });

  it('task pipeline_stages_reviewed is true when setting flag is set', async () => {
    await pool.query(
      `INSERT INTO system_settings (key, value, updated_at) VALUES ('pipeline_stages_reviewed', 'true', now())`,
    );
    const status = await getOnboardingStatus({ id: adminUserId, role: 'admin' });
    const task = status.tasks.find((t) => t.id === 'pipeline_stages_reviewed');
    expect(task?.completed).toBe(true);
  });

  it('task team_member_invited is true when an active non-admin user exists', async () => {
    await pool.query(
      `INSERT INTO users (email, name, role, status, password_hash)
       VALUES ('settings-svc-extra@test.com', 'Extra Rep', 'rep', 'active', 'x')`,
    );
    try {
      const status = await getOnboardingStatus({ id: adminUserId, role: 'admin' });
      const task = status.tasks.find((t) => t.id === 'team_member_invited');
      expect(task?.completed).toBe(true);
    } finally {
      await pool.query(`DELETE FROM users WHERE email = 'settings-svc-extra@test.com'`);
    }
  });

  it('task team_member_invited excludes inactive users from the count', async () => {
    // Temporarily deactivate all non-admin users (other describe blocks may have created active
    // rep users via beforeAll that are still present in the DB during this test).
    await pool.query(`UPDATE users SET status = 'inactive' WHERE role != 'admin'`);
    await pool.query(
      `INSERT INTO users (email, name, role, status, password_hash)
       VALUES ('settings-svc-inactive@test.com', 'Inactive User', 'rep', 'inactive', 'x')`,
    );
    try {
      const status = await getOnboardingStatus({ id: adminUserId, role: 'admin' });
      const task = status.tasks.find((t) => t.id === 'team_member_invited');
      // Inactive users must not count toward team_member_invited
      expect(task?.completed).toBe(false);
    } finally {
      await pool.query(`DELETE FROM users WHERE email = 'settings-svc-inactive@test.com'`);
      // Restore any non-admin users to active
      await pool.query(`UPDATE users SET status = 'active' WHERE role != 'admin'`);
    }
  });

  it('task first_contact_added is false when contacts table is empty', async () => {
    const status = await getOnboardingStatus({ id: adminUserId, role: 'admin' });
    const task = status.tasks.find((t) => t.id === 'first_contact_added');
    expect(task?.completed).toBe(false);
  });

  it('task first_contact_added is true when a non-demo contact exists', async () => {
    await pool.query(
      `INSERT INTO contacts (first_name, last_name, email, owner_id, is_demo)
       VALUES ('Test','Contact','test@test.com', $1, false)`,
      [adminUserId],
    );
    const status = await getOnboardingStatus({ id: adminUserId, role: 'admin' });
    const task = status.tasks.find((t) => t.id === 'first_contact_added');
    expect(task?.completed).toBe(true);
  });

  it('task first_deal_created is false when deals table is empty', async () => {
    const status = await getOnboardingStatus({ id: adminUserId, role: 'admin' });
    const task = status.tasks.find((t) => t.id === 'first_deal_created');
    expect(task?.completed).toBe(false);
  });

  it('task smtp_configured is false when smtp_configuration host is empty', async () => {
    const status = await getOnboardingStatus({ id: adminUserId, role: 'admin' });
    const task = status.tasks.find((t) => t.id === 'smtp_configured');
    expect(task?.completed).toBe(false);
  });

  it('task smtp_configured is true when smtp_configuration host is non-empty', async () => {
    await pool.query(`UPDATE smtp_configuration SET host = 'mail.example.com', updated_at = now()`);
    try {
      const status = await getOnboardingStatus({ id: adminUserId, role: 'admin' });
      const task = status.tasks.find((t) => t.id === 'smtp_configured');
      expect(task?.completed).toBe(true);
    } finally {
      // Reset so this write never leaks into other serial-project test files
      // (e.g. smtpController.test.ts) that assert on a cleared smtp_configuration.
      await pool.query(`UPDATE smtp_configuration SET host = '', updated_at = now()`);
    }
  });
});

describe('getOnboardingStatus — rep caller', () => {
  beforeAll(async () => {
    await pool.query('TRUNCATE contacts, accounts, deals, activities RESTART IDENTITY CASCADE');
    await pool.query(`DELETE FROM users WHERE email = 'settings-svc-rep@test.com'`);
    const repResult = await pool.query<{ id: string }>(
      `INSERT INTO users (email, name, role, status, password_hash)
       VALUES ('settings-svc-rep@test.com', 'Settings Rep', 'rep', 'active', 'x')
       RETURNING id`,
    );
    repUserId = repResult.rows[0].id;
  });

  afterAll(async () => {
    await pool.query('TRUNCATE contacts, accounts, deals, activities RESTART IDENTITY CASCADE');
    await pool.query(`DELETE FROM users WHERE email = 'settings-svc-rep@test.com'`);
  });

  beforeEach(async () => {
    await pool.query(`UPDATE users SET onboarding_completed = false WHERE id = $1`, [repUserId]);
    await pool.query('TRUNCATE contacts, accounts, deals, activities RESTART IDENTITY CASCADE');
  });

  it('returns four rep-specific tasks', async () => {
    const status = await getOnboardingStatus({ id: repUserId, role: 'rep' });
    expect(status.tasks).toHaveLength(4);
    expect(status.tasks.map((t) => t.id)).toEqual(REP_TASK_IDS);
  });

  it('returns is_first_run=true when rep onboarding_completed is false', async () => {
    const status = await getOnboardingStatus({ id: repUserId, role: 'rep' });
    expect(status.is_first_run).toBe(true);
    expect(status.onboarding_completed).toBe(false);
  });

  it('first_contact_added is false when rep has no contacts', async () => {
    const status = await getOnboardingStatus({ id: repUserId, role: 'rep' });
    const task = status.tasks.find((t) => t.id === 'first_contact_added');
    expect(task?.completed).toBe(false);
  });

  it('first_contact_added is true only when the rep owns a contact', async () => {
    await pool.query(
      `INSERT INTO contacts (first_name, last_name, email, owner_id)
       VALUES ('Rep','Contact','rep-contact@test.com', $1)`,
      [repUserId],
    );
    const status = await getOnboardingStatus({ id: repUserId, role: 'rep' });
    const task = status.tasks.find((t) => t.id === 'first_contact_added');
    expect(task?.completed).toBe(true);
  });

  it('first_account_created is false when rep has no accounts', async () => {
    const status = await getOnboardingStatus({ id: repUserId, role: 'rep' });
    const task = status.tasks.find((t) => t.id === 'first_account_created');
    expect(task?.completed).toBe(false);
  });

  it('first_account_created is true only when the rep owns an account', async () => {
    await pool.query(`INSERT INTO accounts (name, owner_id) VALUES ('Rep Account', $1)`, [
      repUserId,
    ]);
    const status = await getOnboardingStatus({ id: repUserId, role: 'rep' });
    const task = status.tasks.find((t) => t.id === 'first_account_created');
    expect(task?.completed).toBe(true);
  });

  it('first_deal_created is false when rep has no deals', async () => {
    const status = await getOnboardingStatus({ id: repUserId, role: 'rep' });
    const task = status.tasks.find((t) => t.id === 'first_deal_created');
    expect(task?.completed).toBe(false);
  });

  it('logged_first_activity is false when rep has no activities', async () => {
    const status = await getOnboardingStatus({ id: repUserId, role: 'rep' });
    const task = status.tasks.find((t) => t.id === 'logged_first_activity');
    expect(task?.completed).toBe(false);
  });

  it('first_contact_added is false when the rep only owns demo contacts (is_demo filter)', async () => {
    await pool.query(
      `INSERT INTO contacts (first_name, last_name, email, owner_id, is_demo)
       VALUES ('Demo','Contact','rep-demo-contact@test.com', $1, true)`,
      [repUserId],
    );
    const status = await getOnboardingStatus({ id: repUserId, role: 'rep' });
    const task = status.tasks.find((t) => t.id === 'first_contact_added');
    expect(task?.completed).toBe(false);
  });

  it('first_deal_created is false when the rep only owns demo deals (is_demo filter)', async () => {
    const stageRow = await pool.query<{ id: string; name: string }>(
      `SELECT id, name FROM pipeline_stages LIMIT 1`,
    );
    const stage = stageRow.rows[0].name;
    const stageId = stageRow.rows[0].id;
    const defaultPipelineId = await getDefaultPipelineId();
    await pool.query(
      `INSERT INTO deals (name, stage, owner_id, is_demo, pipeline_id, pipeline_stage_id) VALUES ('Demo Deal', $1, $2, true, $3, $4)`,
      [stage, repUserId, defaultPipelineId, stageId],
    );
    const status = await getOnboardingStatus({ id: repUserId, role: 'rep' });
    const task = status.tasks.find((t) => t.id === 'first_deal_created');
    expect(task?.completed).toBe(false);
  });
});

describe('setOnboardingCompleted', () => {
  let testUserId: string;

  beforeAll(async () => {
    const result = await pool.query<{ id: string }>(
      `INSERT INTO users (email, name, role, status, password_hash)
       VALUES ('settings-svc-onboarding@test.com', 'Onboarding User', 'rep', 'active', 'x')
       RETURNING id`,
    );
    testUserId = result.rows[0].id;
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM users WHERE email = 'settings-svc-onboarding@test.com'`);
  });

  beforeEach(async () => {
    await pool.query(`UPDATE users SET onboarding_completed = false WHERE id = $1`, [testUserId]);
  });

  it('persists true and returns true', async () => {
    const result = await setOnboardingCompleted(testUserId, true);
    expect(result).toBe(true);
    const status = await getOnboardingStatus({ id: testUserId, role: 'rep' });
    expect(status.onboarding_completed).toBe(true);
  });

  it('persists false and returns false', async () => {
    await setOnboardingCompleted(testUserId, true);
    const result = await setOnboardingCompleted(testUserId, false);
    expect(result).toBe(false);
    const status = await getOnboardingStatus({ id: testUserId, role: 'rep' });
    expect(status.onboarding_completed).toBe(false);
  });
});

describe('markPipelineStagesReviewed', () => {
  let markTestAdminId: string;

  beforeAll(async () => {
    const result = await pool.query<{ id: string }>(
      `INSERT INTO users (email, name, role, status, password_hash)
       VALUES ('settings-svc-mark-admin@test.com', 'Mark Admin', 'admin', 'active', 'x')
       RETURNING id`,
    );
    markTestAdminId = result.rows[0].id;
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM users WHERE email = 'settings-svc-mark-admin@test.com'`);
  });

  beforeEach(async () => {
    await pool.query(`DELETE FROM system_settings WHERE key = 'pipeline_stages_reviewed'`);
  });

  it('sets pipeline_stages_reviewed to true', async () => {
    await markPipelineStagesReviewed();
    const status = await getOnboardingStatus({ id: markTestAdminId, role: 'admin' });
    const task = status.tasks.find((t) => t.id === 'pipeline_stages_reviewed');
    expect(task?.completed).toBe(true);
  });

  it('is idempotent', async () => {
    await markPipelineStagesReviewed();
    await markPipelineStagesReviewed();
    const status = await getOnboardingStatus({ id: markTestAdminId, role: 'admin' });
    const task = status.tasks.find((t) => t.id === 'pipeline_stages_reviewed');
    expect(task?.completed).toBe(true);
  });
});
