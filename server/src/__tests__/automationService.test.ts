/**
 * Integration tests for automationService.
 *
 * Runs against a real PostgreSQL test database.
 * A single admin user is created in beforeAll and reused.
 * Automation rules and logs tables are truncated before each test.
 *
 * Run: npm test (from /server)
 */

import 'dotenv/config';
import {
  createAutomationRule,
  findAutomationRuleById,
  listAutomationRules,
  updateAutomationRule,
  deleteAutomationRule,
  listRuleLogs,
  fireAutomationTrigger,
  type AutomationRuleLogRow,
} from '../services/automationService.js';
import { createUser } from '../services/userService.js';
import { getDefaultPipelineId } from '../services/pipelineService.js';
import pool from '../db.js';

const FILE_PREFIX = 'auto-svc';

/** Minimal admin user fixture */
const ADMIN_USER = {
  email: `${FILE_PREFIX}-admin@example.com`,
  name: 'Automation Admin',
  role: 'admin' as const,
  passwordHash: '$2b$12$placeholder_hash',
  status: 'active' as const,
};

/** Minimal rep user fixture (used as task assignee) */
const REP_USER = {
  email: `${FILE_PREFIX}-rep@example.com`,
  name: 'Automation Rep',
  role: 'rep' as const,
  passwordHash: '$2b$12$placeholder_hash',
  status: 'active' as const,
};

/** Base rule fixture — create_task action on deal_created */
const BASE_RULE = {
  name: 'New deal follow-up task',
  enabled: true,
  trigger_type: 'deal_created' as const,
  trigger_config: {},
  action_type: 'create_task' as const,
  action_config: {
    subject: 'Follow up with new lead',
    task_type: 'Task',
    assignee_type: 'owner',
    due_date_offset_days: 1,
  },
};

let adminId: string;
let repId: string;
let dealId: string;
let contactId: string;
let defaultPipelineId: string;

beforeAll(async () => {
  // Clean up any leftovers from prior runs
  await pool.query(
    'DELETE FROM automation_rule_logs WHERE rule_id IN (SELECT id FROM automation_rules WHERE created_by IN (SELECT id FROM users WHERE email LIKE $1))',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    'DELETE FROM automation_rules WHERE created_by IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    'DELETE FROM activities WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    'DELETE FROM deal_contacts WHERE deal_id IN (SELECT id FROM deals WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1))',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    'DELETE FROM deals WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    'DELETE FROM contacts WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);

  const admin = await createUser(ADMIN_USER);
  adminId = admin.id;

  const rep = await createUser(REP_USER);
  repId = rep.id;

  defaultPipelineId = await getDefaultPipelineId();

  // Create a deal and a contact for trigger execution tests
  const stageIdForTrigger = (
    await pool.query<{ id: string }>(
      'SELECT id FROM pipeline_stages WHERE name = $1 AND pipeline_id = $2 LIMIT 1',
      ['Prospecting', defaultPipelineId],
    )
  ).rows[0].id;
  const dealResult = await pool.query<{ id: string }>(
    `INSERT INTO deals (name, stage, owner_id, pipeline_id, pipeline_stage_id) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    ['Trigger Test Deal', 'Prospecting', adminId, defaultPipelineId, stageIdForTrigger],
  );
  dealId = dealResult.rows[0].id;

  const contactResult = await pool.query<{ id: string }>(
    `INSERT INTO contacts (first_name, last_name, email, owner_id)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    ['Trigger', 'Contact', `${FILE_PREFIX}-trigger-contact@example.com`, adminId],
  );
  contactId = contactResult.rows[0].id;
});

beforeEach(async () => {
  await pool.query(
    'DELETE FROM automation_rule_logs WHERE rule_id IN (SELECT id FROM automation_rules WHERE created_by IN (SELECT id FROM users WHERE email LIKE $1))',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    'DELETE FROM automation_rules WHERE created_by IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    'DELETE FROM activities WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
});

afterAll(async () => {
  await pool.query(
    'DELETE FROM automation_rule_logs WHERE rule_id IN (SELECT id FROM automation_rules WHERE created_by IN (SELECT id FROM users WHERE email LIKE $1))',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    'DELETE FROM automation_rules WHERE created_by IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    'DELETE FROM activities WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    'DELETE FROM deal_contacts WHERE deal_id IN (SELECT id FROM deals WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1))',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    'DELETE FROM deals WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query(
    'DELETE FROM contacts WHERE owner_id IN (SELECT id FROM users WHERE email LIKE $1)',
    [`${FILE_PREFIX}-%`],
  );
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
});

// ── createAutomationRule ────────────────────────────────────────────────────────

describe('createAutomationRule', () => {
  it('inserts a rule and returns the full row', async () => {
    const rule = await createAutomationRule({ ...BASE_RULE, created_by: adminId });

    expect(rule.id).toBeDefined();
    expect(rule.name).toBe(BASE_RULE.name);
    expect(rule.enabled).toBe(true);
    expect(rule.trigger_type).toBe('deal_created');
    expect(rule.action_type).toBe('create_task');
    expect(rule.created_by).toBe(adminId);
    expect(rule.created_at).toBeInstanceOf(Date);
  });

  it('stores trigger_config and action_config as objects', async () => {
    const rule = await createAutomationRule({ ...BASE_RULE, created_by: adminId });

    expect(rule.trigger_config).toEqual({});
    expect(rule.action_config).toMatchObject({ subject: 'Follow up with new lead' });
  });

  it('creates a disabled rule when enabled is false', async () => {
    const rule = await createAutomationRule({
      ...BASE_RULE,
      enabled: false,
      created_by: adminId,
    });
    expect(rule.enabled).toBe(false);
  });

  it('creates a deal_stage_changed rule with trigger_config', async () => {
    const rule = await createAutomationRule({
      name: 'Stage change rule',
      enabled: true,
      trigger_type: 'deal_stage_changed',
      trigger_config: { stage: 'Proposal' },
      action_type: 'send_notification',
      action_config: { message: 'Deal moved to Proposal!' },
      created_by: adminId,
    });

    expect(rule.trigger_type).toBe('deal_stage_changed');
    expect(rule.trigger_config).toEqual({ stage: 'Proposal' });
  });
});

// ── findAutomationRuleById ──────────────────────────────────────────────────────

describe('findAutomationRuleById', () => {
  it('returns the rule when found', async () => {
    const created = await createAutomationRule({ ...BASE_RULE, created_by: adminId });
    const found = await findAutomationRuleById(created.id);

    expect(found).not.toBeNull();
    expect(found!.id).toBe(created.id);
    expect(found!.name).toBe(BASE_RULE.name);
  });

  it('returns null for a non-existent UUID', async () => {
    const found = await findAutomationRuleById('00000000-0000-0000-0000-000000000000');
    expect(found).toBeNull();
  });
});

// ── listAutomationRules ─────────────────────────────────────────────────────────

describe('listAutomationRules', () => {
  it('returns an empty array when no rules exist', async () => {
    const result = await listAutomationRules();
    const mine = result.data.filter((r) => r.created_by === adminId);
    expect(mine).toEqual([]);
  });

  it('returns all rules ordered by created_at descending', async () => {
    await createAutomationRule({ ...BASE_RULE, name: 'Alpha Rule', created_by: adminId });
    await createAutomationRule({ ...BASE_RULE, name: 'Beta Rule', created_by: adminId });

    const result = await listAutomationRules();
    const mine = result.data.filter((r) => r.created_by === adminId);
    expect(mine).toHaveLength(2);
    // Most recently created rule should be first
    expect(mine[0].name).toBe('Beta Rule');
    expect(mine[1].name).toBe('Alpha Rule');
  });

  it('returns pagination metadata', async () => {
    const result = await listAutomationRules(1, 25);
    expect(result).toHaveProperty('data');
    expect(result).toHaveProperty('total');
    expect(result).toHaveProperty('page', 1);
    expect(result).toHaveProperty('limit', 25);
    expect(Array.isArray(result.data)).toBe(true);
  });

  it('respects page and limit parameters', async () => {
    for (let i = 0; i < 3; i++) {
      await createAutomationRule({ ...BASE_RULE, name: `Paginate Rule ${i}`, created_by: adminId });
    }
    const page1 = await listAutomationRules(1, 2);
    expect(page1.data.length).toBeLessThanOrEqual(2);
    expect(page1.page).toBe(1);
    expect(page1.limit).toBe(2);
    expect(page1.total).toBeGreaterThanOrEqual(3);
  });
});

// ── updateAutomationRule ────────────────────────────────────────────────────────

describe('updateAutomationRule', () => {
  it('updates the name field', async () => {
    const rule = await createAutomationRule({ ...BASE_RULE, created_by: adminId });
    const updated = await updateAutomationRule(rule.id, { name: 'Renamed Rule' });

    expect(updated!.name).toBe('Renamed Rule');
    expect(updated!.trigger_type).toBe('deal_created'); // unchanged
  });

  it('toggles enabled to false', async () => {
    const rule = await createAutomationRule({ ...BASE_RULE, created_by: adminId });
    const updated = await updateAutomationRule(rule.id, { enabled: false });

    expect(updated!.enabled).toBe(false);
  });

  it('updates action_config', async () => {
    const rule = await createAutomationRule({ ...BASE_RULE, created_by: adminId });
    const newConfig = {
      subject: 'Updated subject',
      task_type: 'Call',
      assignee_type: 'owner',
      due_date_offset_days: 3,
    };
    const updated = await updateAutomationRule(rule.id, { action_config: newConfig });

    expect(updated!.action_config).toMatchObject({ subject: 'Updated subject' });
  });

  it('returns null for a non-existent rule', async () => {
    const result = await updateAutomationRule('00000000-0000-0000-0000-000000000000', {
      name: 'Ghost',
    });
    expect(result).toBeNull();
  });
});

// ── deleteAutomationRule ────────────────────────────────────────────────────────

describe('deleteAutomationRule', () => {
  it('removes the rule and returns the deleted row', async () => {
    const rule = await createAutomationRule({ ...BASE_RULE, created_by: adminId });

    const deleted = await deleteAutomationRule(rule.id);
    expect(deleted!.id).toBe(rule.id);

    const found = await findAutomationRuleById(rule.id);
    expect(found).toBeNull();
  });

  it('returns null for a non-existent rule', async () => {
    const result = await deleteAutomationRule('00000000-0000-0000-0000-000000000000');
    expect(result).toBeNull();
  });
});

// ── listRuleLogs ────────────────────────────────────────────────────────────────

describe('listRuleLogs', () => {
  it('returns an empty array when no logs exist', async () => {
    const rule = await createAutomationRule({ ...BASE_RULE, created_by: adminId });
    const logs = await listRuleLogs(rule.id);
    expect(logs).toEqual([]);
  });

  it('returns logs with rule_name joined from automation_rules', async () => {
    const rule = await createAutomationRule({ ...BASE_RULE, created_by: adminId });

    // Insert a log directly
    await pool.query(
      `INSERT INTO automation_rule_logs
         (rule_id, triggering_record_type, triggering_record_id, outcome)
       VALUES ($1, $2, $3, $4)`,
      [rule.id, 'deal', dealId, 'success'],
    );

    const logs = await listRuleLogs(rule.id);
    expect(logs).toHaveLength(1);
    expect(logs[0].rule_id).toBe(rule.id);
    expect(logs[0].rule_name).toBe(BASE_RULE.name);
    expect(logs[0].outcome).toBe('success');
    expect(logs[0].error_message).toBeNull();
  });

  it('caps results at 20 most recent entries', async () => {
    const rule = await createAutomationRule({ ...BASE_RULE, created_by: adminId });

    // Insert 25 logs
    for (let i = 0; i < 25; i++) {
      await pool.query(
        `INSERT INTO automation_rule_logs
           (rule_id, triggering_record_type, triggering_record_id, outcome)
         VALUES ($1, $2, $3, $4)`,
        [rule.id, 'deal', dealId, 'success'],
      );
    }

    const logs = await listRuleLogs(rule.id);
    expect(logs).toHaveLength(20);
  });
});

// ── fireAutomationTrigger — create_task action ─────────────────────────────────

describe('fireAutomationTrigger — create_task action', () => {
  it('creates a task activity when deal_created fires and a matching rule is enabled', async () => {
    await createAutomationRule({ ...BASE_RULE, created_by: adminId });

    await fireAutomationTrigger('deal_created', {
      recordId: dealId,
      recordType: 'deal',
      ownerId: adminId,
    });

    const tasks = await pool.query(
      `SELECT * FROM activities WHERE deal_id = $1 AND type = 'Task'`,
      [dealId],
    );
    expect(tasks.rows).toHaveLength(1);
    expect(tasks.rows[0].subject).toBe('Follow up with new lead');
    expect(tasks.rows[0].owner_id).toBe(adminId); // assignee_type = 'owner'
  });

  it('assigns to a specific user when assignee_type is specific', async () => {
    await createAutomationRule({
      ...BASE_RULE,
      action_config: {
        subject: 'Specific assignee task',
        task_type: 'Task',
        assignee_type: 'specific',
        assignee_id: repId,
        due_date_offset_days: 0,
      },
      created_by: adminId,
    });

    await fireAutomationTrigger('deal_created', {
      recordId: dealId,
      recordType: 'deal',
      ownerId: adminId,
    });

    const tasks = await pool.query(
      `SELECT * FROM activities WHERE deal_id = $1 AND subject = 'Specific assignee task'`,
      [dealId],
    );
    expect(tasks.rows).toHaveLength(1);
    expect(tasks.rows[0].owner_id).toBe(repId);
  });

  it('writes a success log entry', async () => {
    const rule = await createAutomationRule({ ...BASE_RULE, created_by: adminId });

    await fireAutomationTrigger('deal_created', {
      recordId: dealId,
      recordType: 'deal',
      ownerId: adminId,
    });

    const logs = await listRuleLogs(rule.id);
    expect(logs).toHaveLength(1);
    expect(logs[0].outcome).toBe('success');
  });

  it('does not fire disabled rules', async () => {
    await createAutomationRule({ ...BASE_RULE, enabled: false, created_by: adminId });

    await fireAutomationTrigger('deal_created', {
      recordId: dealId,
      recordType: 'deal',
      ownerId: adminId,
    });

    const tasks = await pool.query(
      `SELECT * FROM activities WHERE deal_id = $1 AND type = 'Task'`,
      [dealId],
    );
    expect(tasks.rows).toHaveLength(0);
  });

  it('writes an error log when action_config is invalid', async () => {
    const rule = await createAutomationRule({
      ...BASE_RULE,
      action_config: { subject: '' }, // missing required fields
      created_by: adminId,
    });

    await fireAutomationTrigger('deal_created', {
      recordId: dealId,
      recordType: 'deal',
      ownerId: adminId,
    });

    // Parallel tests may fire deal_created independently, producing extra log entries
    // for this rule. Check that at least one error log was written.
    const logs = await listRuleLogs(rule.id);
    expect(logs.length).toBeGreaterThanOrEqual(1);
    expect(logs.every((l) => l.outcome === 'error')).toBe(true);
    expect(logs[0].error_message).not.toBeNull();
  });
});

// ── fireAutomationTrigger — deal_stage_changed ─────────────────────────────────

describe('fireAutomationTrigger — deal_stage_changed', () => {
  it('fires only when the stage matches trigger_config.stage', async () => {
    await createAutomationRule({
      name: 'Proposal stage rule',
      enabled: true,
      trigger_type: 'deal_stage_changed',
      trigger_config: { stage: 'Proposal' },
      action_type: 'create_task',
      action_config: {
        subject: 'Prepare proposal document',
        task_type: 'Task',
        assignee_type: 'owner',
        due_date_offset_days: 2,
      },
      created_by: adminId,
    });

    // Fire with a non-matching stage — no task should be created
    await fireAutomationTrigger('deal_stage_changed', {
      recordId: dealId,
      recordType: 'deal',
      ownerId: adminId,
      newStage: 'Qualification',
    });

    const noTasksResult = await pool.query(
      `SELECT * FROM activities WHERE deal_id = $1 AND subject = 'Prepare proposal document'`,
      [dealId],
    );
    expect(noTasksResult.rows).toHaveLength(0);

    // Fire with the matching stage — task should be created
    await fireAutomationTrigger('deal_stage_changed', {
      recordId: dealId,
      recordType: 'deal',
      ownerId: adminId,
      newStage: 'Proposal',
    });

    const tasksResult = await pool.query(
      `SELECT * FROM activities WHERE deal_id = $1 AND subject = 'Prepare proposal document'`,
      [dealId],
    );
    expect(tasksResult.rows).toHaveLength(1);
  });
});

// ── fireAutomationTrigger — contact_created ────────────────────────────────────

describe('fireAutomationTrigger — contact_created', () => {
  it('creates a task linked to the contact', async () => {
    await createAutomationRule({
      name: 'New contact task',
      enabled: true,
      trigger_type: 'contact_created',
      trigger_config: {},
      action_type: 'create_task',
      action_config: {
        subject: 'Welcome new contact',
        task_type: 'Task',
        assignee_type: 'owner',
        due_date_offset_days: 0,
      },
      created_by: adminId,
    });

    await fireAutomationTrigger('contact_created', {
      recordId: contactId,
      recordType: 'contact',
      ownerId: adminId,
    });

    const tasks = await pool.query(
      `SELECT * FROM activities WHERE contact_id = $1 AND subject = 'Welcome new contact'`,
      [contactId],
    );
    expect(tasks.rows).toHaveLength(1);
  });
});

// ── MINCRM-83: Failure isolation ───────────────────────────────────────────────

describe('MINCRM-83 — failing rule does not abort the triggering operation', () => {
  it('does not throw when a rule action fails, and writes an error log', async () => {
    const failingRule = await createAutomationRule({
      ...BASE_RULE,
      // Omitting required action_config fields causes execution to throw internally
      action_config: { subject: '' },
      created_by: adminId,
    });

    // fireAutomationTrigger must resolve without throwing even when all rules fail
    await expect(
      fireAutomationTrigger('deal_created', {
        recordId: dealId,
        recordType: 'deal',
        ownerId: adminId,
      }),
    ).resolves.toBeUndefined();

    // The error log must have been written (parallel tests may fire the same
    // trigger, so there can be more than one log entry for this rule).
    const logs = await listRuleLogs(failingRule.id);
    expect(logs.length).toBeGreaterThanOrEqual(1);
    expect(logs.every((l) => l.outcome === 'error')).toBe(true);
    expect(logs[0].error_message).not.toBeNull();

    // The DB should show no tasks were created (action failed)
    const tasks = await pool.query(
      `SELECT * FROM activities WHERE deal_id = $1 AND type = 'Task'`,
      [dealId],
    );
    expect(tasks.rows).toHaveLength(0);
  });

  it('runs rule 2 and logs success even when rule 1 throws', async () => {
    // Rule 1: bad config → will throw during execution
    const failingRule = await createAutomationRule({
      name: 'Failing contact rule',
      enabled: true,
      trigger_type: 'contact_created',
      trigger_config: {},
      action_type: 'create_task',
      action_config: { subject: '' }, // missing required fields → throws
      created_by: adminId,
    });

    // Rule 2: valid config → should succeed regardless of rule 1
    const succeedingRule = await createAutomationRule({
      name: 'Succeeding contact rule',
      enabled: true,
      trigger_type: 'contact_created',
      trigger_config: {},
      action_type: 'create_task',
      action_config: {
        subject: 'Welcome new contact',
        task_type: 'Task',
        assignee_type: 'owner',
        due_date_offset_days: 0,
      },
      created_by: adminId,
    });

    await fireAutomationTrigger('contact_created', {
      recordId: contactId,
      recordType: 'contact',
      ownerId: adminId,
    });

    const failingLogs = await listRuleLogs(failingRule.id);
    expect(failingLogs).toHaveLength(1);
    expect(failingLogs[0].outcome).toBe('error');
    expect(failingLogs[0].error_message).not.toBeNull();

    const succeedingLogs = await listRuleLogs(succeedingRule.id);
    expect(succeedingLogs).toHaveLength(1);
    expect(succeedingLogs[0].outcome).toBe('success');

    // Verify the task from rule 2 was actually created
    const tasks = await pool.query(
      `SELECT * FROM activities WHERE contact_id = $1 AND subject = 'Welcome new contact'`,
      [contactId],
    );
    expect(tasks.rows).toHaveLength(1);
  });
});

// Note: MINCRM-83 Scenario 2 (disabled rule does not fire) is covered by
// the 'does not fire disabled rules' test in the create_task section above.

// ── fireAutomationTrigger — send_notification ──────────────────────────────────

describe('fireAutomationTrigger — send_notification', () => {
  it('writes a success log without creating an activity', async () => {
    const rule = await createAutomationRule({
      name: 'Notification rule',
      enabled: true,
      trigger_type: 'deal_created',
      trigger_config: {},
      action_type: 'send_notification',
      action_config: { message: 'A new deal was created!' },
      created_by: adminId,
    });

    await fireAutomationTrigger('deal_created', {
      recordId: dealId,
      recordType: 'deal',
      ownerId: adminId,
    });

    const logs = await listRuleLogs(rule.id);
    expect(logs).toHaveLength(1);
    expect(logs[0].outcome).toBe('success');

    // No activities should be created by this file's rules (owner scoped to adminId)
    const activities = await pool.query(
      `SELECT * FROM activities WHERE deal_id = $1 AND owner_id = $2`,
      [dealId, adminId],
    );
    expect(activities.rows).toHaveLength(0);
  });
});

// ── Audit log coverage (MINCRM-382) ─────────────────────────────────────────────

const AUDIT_ACTOR = { id: '00000000-0000-0000-0000-000000000003', name: 'Automation Audit Actor' };

describe('audit log entries for automation rules (MINCRM-382)', () => {
  beforeEach(async () => {
    await pool.query('ALTER TABLE audit_log DISABLE TRIGGER audit_log_no_modify');
    await pool.query(`DELETE FROM audit_log WHERE changed_by_id = $1`, [AUDIT_ACTOR.id]);
    await pool.query('ALTER TABLE audit_log ENABLE TRIGGER audit_log_no_modify');
  });

  it('createAutomationRule writes an audit entry with event_type=created', async () => {
    const rule = await createAutomationRule(
      { ...BASE_RULE, name: 'Audit create rule', created_by: adminId },
      AUDIT_ACTOR,
    );

    await new Promise((r) => setTimeout(r, 50));

    const result = await pool.query(
      `SELECT * FROM audit_log WHERE record_id = $1 AND changed_by_id = $2`,
      [rule.id, AUDIT_ACTOR.id],
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].record_type).toBe('system_settings');
    expect(result.rows[0].event_type).toBe('created');
    expect(result.rows[0].record_name).toBe('Audit create rule');
  });

  it('updateAutomationRule writes an audit entry with event_type=updated', async () => {
    const rule = await createAutomationRule(
      { ...BASE_RULE, name: 'Audit update rule', created_by: adminId },
      AUDIT_ACTOR,
    );

    await updateAutomationRule(rule.id, { enabled: false }, AUDIT_ACTOR);

    await new Promise((r) => setTimeout(r, 50));

    const result = await pool.query(
      `SELECT * FROM audit_log WHERE record_id = $1 AND changed_by_id = $2 AND event_type = 'updated'`,
      [rule.id, AUDIT_ACTOR.id],
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].record_type).toBe('system_settings');
  });

  it('deleteAutomationRule writes an audit entry with event_type=deleted', async () => {
    const rule = await createAutomationRule(
      { ...BASE_RULE, name: 'Audit delete rule', created_by: adminId },
      AUDIT_ACTOR,
    );
    const ruleId = rule.id;

    await deleteAutomationRule(ruleId, AUDIT_ACTOR);

    await new Promise((r) => setTimeout(r, 50));

    const result = await pool.query(
      `SELECT * FROM audit_log WHERE record_id = $1 AND changed_by_id = $2 AND event_type = 'deleted'`,
      [ruleId, AUDIT_ACTOR.id],
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].record_type).toBe('system_settings');
    expect(result.rows[0].record_name).toBe('Audit delete rule');
  });
});

// ── action_config_snapshot (MINCRM-509) ────────────────────────────────────────

describe('action_config_snapshot', () => {
  it('log row captures the action_config at fire time', async () => {
    const rule = await createAutomationRule({ ...BASE_RULE, created_by: adminId });

    await fireAutomationTrigger('deal_created', {
      recordId: dealId,
      recordType: 'deal',
      ownerId: adminId,
    });

    const logs = await listRuleLogs(rule.id);
    expect(logs).toHaveLength(1);
    expect(logs[0].action_config_snapshot).toEqual(BASE_RULE.action_config);
  });

  it('snapshot is frozen at fire time — subsequent rule edits do not affect it', async () => {
    const originalConfig = {
      subject: 'Original task subject',
      task_type: 'Task',
      assignee_type: 'owner' as const,
      due_date_offset_days: 1,
    };
    const rule = await createAutomationRule({
      ...BASE_RULE,
      action_config: originalConfig,
      created_by: adminId,
    });

    await fireAutomationTrigger('deal_created', {
      recordId: dealId,
      recordType: 'deal',
      ownerId: adminId,
    });

    // Edit the rule's action_config after execution
    await updateAutomationRule(
      rule.id,
      {
        action_config: {
          subject: 'Edited subject',
          task_type: 'Task',
          assignee_type: 'owner',
          due_date_offset_days: 3,
        },
      },
      { id: adminId, name: 'Automation Admin' },
    );

    // The log snapshot must still reflect the config that was live at execution time
    const logs = await listRuleLogs(rule.id);
    expect(logs).toHaveLength(1);
    expect((logs[0] as AutomationRuleLogRow).action_config_snapshot).toEqual(originalConfig);
    expect((logs[0] as AutomationRuleLogRow).action_config_snapshot).not.toMatchObject({
      subject: 'Edited subject',
    });
  });

  it('snapshot is captured even when execution fails', async () => {
    const invalidConfig = { subject: '' }; // missing required fields → throws
    const rule = await createAutomationRule({
      ...BASE_RULE,
      action_config: invalidConfig,
      created_by: adminId,
    });

    await fireAutomationTrigger('deal_created', {
      recordId: dealId,
      recordType: 'deal',
      ownerId: adminId,
    });

    const logs = await listRuleLogs(rule.id);
    expect(logs.length).toBeGreaterThanOrEqual(1);
    const errorLog = logs.find((l) => l.outcome === 'error');
    expect(errorLog).toBeDefined();
    expect(errorLog!.action_config_snapshot).toEqual(invalidConfig);
  });
});
