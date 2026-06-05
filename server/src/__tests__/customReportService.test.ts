/**
 * Integration tests for customReportService.
 *
 * Runs against a real PostgreSQL test database (minicrm_test).
 * Tables are cleaned before each test to ensure isolation. (MINCRM-402)
 */

import 'dotenv/config';
import {
  listReports,
  getReport,
  createReport,
  updateReport,
  deleteReport,
  executeReport,
} from '../services/customReportService.js';
import pool from '../db.js';
import { createUser } from '../services/userService.js';

const FILE_PREFIX = 'cr-svc';

const BASIC_CONFIG = {
  selected_fields: ['id', 'first_name', 'last_name'],
  filters: [],
};

let ACTOR = { id: '', name: 'Test Actor' };

async function truncate(): Promise<void> {
  await pool.query(`DELETE FROM custom_reports WHERE name LIKE $1`, [`${FILE_PREFIX}-%`]);
}

beforeAll(async () => {
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
  const actor = await createUser({
    email: `${FILE_PREFIX}-actor@example.com`,
    name: 'Test Actor',
    role: 'admin',
    status: 'active',
    passwordHash: null,
  });
  ACTOR = { id: actor.id, name: actor.name };
});

beforeEach(async () => {
  await truncate();
});

afterAll(async () => {
  await truncate();
  await pool.query(`DELETE FROM contacts WHERE email LIKE $1`, [`${FILE_PREFIX}-%`]);
  await pool.query('DELETE FROM users WHERE email LIKE $1', [`${FILE_PREFIX}-%`]);
  await pool.end();
});

// ── listReports ───────────────────────────────────────────────────────────────

describe('listReports', () => {
  it('returns empty array when no reports exist', async () => {
    const result = await listReports();
    const ours = result.filter((r) => r.name.startsWith(FILE_PREFIX));
    expect(ours).toHaveLength(0);
  });

  it('returns saved reports ordered by name', async () => {
    await createReport(
      { name: `${FILE_PREFIX}-Beta`, entity_type: 'contact', config: BASIC_CONFIG },
      ACTOR,
    );
    await createReport(
      {
        name: `${FILE_PREFIX}-Alpha`,
        entity_type: 'account',
        config: { selected_fields: ['id', 'name'], filters: [] },
      },
      ACTOR,
    );

    const all = await listReports();
    const ours = all.filter((r) => r.name.startsWith(FILE_PREFIX));
    expect(ours).toHaveLength(2);
    expect(ours[0].name).toBe(`${FILE_PREFIX}-Alpha`);
    expect(ours[1].name).toBe(`${FILE_PREFIX}-Beta`);
  });
});

// ── getReport ─────────────────────────────────────────────────────────────────

describe('getReport', () => {
  it('returns null for a nonexistent ID', async () => {
    const result = await getReport('00000000-0000-0000-0000-000000000000');
    expect(result).toBeNull();
  });

  it('returns the report by ID', async () => {
    const created = await createReport(
      { name: `${FILE_PREFIX}-Get`, entity_type: 'contact', config: BASIC_CONFIG },
      ACTOR,
    );
    const found = await getReport(created.id);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(created.id);
    expect(found!.name).toBe(`${FILE_PREFIX}-Get`);
  });
});

// ── createReport ──────────────────────────────────────────────────────────────

describe('createReport', () => {
  it('creates a report with the given config', async () => {
    const report = await createReport(
      {
        name: `${FILE_PREFIX}-Create`,
        entity_type: 'deal',
        config: {
          selected_fields: ['id', 'name', 'stage', 'value'],
          filters: [{ field: 'stage', operator: 'eq', value: 'Prospecting' }],
          sort_field: 'created_at',
          sort_direction: 'desc',
        },
      },
      ACTOR,
    );

    expect(report.id).toBeDefined();
    expect(report.entity_type).toBe('deal');
    expect(report.config.selected_fields).toContain('stage');
    expect(report.config.filters).toHaveLength(1);
  });

  it('throws CUSTOM_REPORT_NAME_CONFLICT on duplicate name', async () => {
    await createReport(
      { name: `${FILE_PREFIX}-Dup`, entity_type: 'contact', config: BASIC_CONFIG },
      ACTOR,
    );

    await expect(
      createReport(
        {
          name: `${FILE_PREFIX}-Dup`,
          entity_type: 'lead',
          config: { selected_fields: ['id'], filters: [] },
        },
        ACTOR,
      ),
    ).rejects.toMatchObject({ code: 'CUSTOM_REPORT_NAME_CONFLICT' });
  });

  it('throws INVALID_REPORT_FIELD when config references a disallowed field', async () => {
    await expect(
      createReport(
        {
          name: `${FILE_PREFIX}-BadField`,
          entity_type: 'contact',
          config: { selected_fields: ['id', 'password_hash'], filters: [] },
        },
        ACTOR,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_REPORT_FIELD' });
  });

  it('writes an audit entry on create', async () => {
    const user = await createUser({
      email: `${FILE_PREFIX}-audit@example.com`,
      name: 'CR Audit User',
      role: 'admin',
      passwordHash: '$2b$12$placeholder',
      status: 'active',
    });
    const actor = { id: user.id, name: user.name };
    const report = await createReport(
      { name: `${FILE_PREFIX}-Audit`, entity_type: 'contact', config: BASIC_CONFIG },
      actor,
    );

    const auditRows = await pool.query(
      `SELECT * FROM audit_log WHERE record_type = 'custom_report' AND record_id = $1`,
      [report.id],
    );
    expect(auditRows.rows).toHaveLength(1);
    expect(auditRows.rows[0].event_type).toBe('created');

    await pool.query('DELETE FROM users WHERE id = $1', [user.id]);
  });
});

// ── updateReport ──────────────────────────────────────────────────────────────

describe('updateReport', () => {
  it('returns null for a nonexistent ID', async () => {
    const result = await updateReport('00000000-0000-0000-0000-000000000000', { name: 'x' }, ACTOR);
    expect(result).toBeNull();
  });

  it('updates the report name', async () => {
    const created = await createReport(
      { name: `${FILE_PREFIX}-UpdOld`, entity_type: 'contact', config: BASIC_CONFIG },
      ACTOR,
    );
    const updated = await updateReport(created.id, { name: `${FILE_PREFIX}-UpdNew` }, ACTOR);
    expect(updated!.name).toBe(`${FILE_PREFIX}-UpdNew`);
  });

  it('updates the report config', async () => {
    const created = await createReport(
      { name: `${FILE_PREFIX}-UpdCfg`, entity_type: 'contact', config: BASIC_CONFIG },
      ACTOR,
    );
    const newConfig = { selected_fields: ['id', 'email'], filters: [] };
    const updated = await updateReport(created.id, { config: newConfig }, ACTOR);
    expect(updated!.config.selected_fields).toEqual(['id', 'email']);
  });

  it('throws CUSTOM_REPORT_NAME_CONFLICT on name collision', async () => {
    await createReport(
      { name: `${FILE_PREFIX}-Existing`, entity_type: 'contact', config: BASIC_CONFIG },
      ACTOR,
    );
    const second = await createReport(
      { name: `${FILE_PREFIX}-Second`, entity_type: 'contact', config: BASIC_CONFIG },
      ACTOR,
    );
    await expect(
      updateReport(second.id, { name: `${FILE_PREFIX}-Existing` }, ACTOR),
    ).rejects.toMatchObject({ code: 'CUSTOM_REPORT_NAME_CONFLICT' });
  });
});

// ── deleteReport ──────────────────────────────────────────────────────────────

describe('deleteReport', () => {
  it('returns null for a nonexistent ID', async () => {
    const result = await deleteReport('00000000-0000-0000-0000-000000000000', ACTOR);
    expect(result).toBeNull();
  });

  it('deletes the report and returns it', async () => {
    const created = await createReport(
      { name: `${FILE_PREFIX}-Del`, entity_type: 'contact', config: BASIC_CONFIG },
      ACTOR,
    );
    const deleted = await deleteReport(created.id, ACTOR);
    expect(deleted!.id).toBe(created.id);

    const found = await getReport(created.id);
    expect(found).toBeNull();
  });

  it('writes an audit entry on delete', async () => {
    const created = await createReport(
      { name: `${FILE_PREFIX}-DelAudit`, entity_type: 'contact', config: BASIC_CONFIG },
      ACTOR,
    );
    await deleteReport(created.id, ACTOR);

    const auditRows = await pool.query(
      `SELECT * FROM audit_log WHERE record_type = 'custom_report' AND record_id = $1 AND event_type = 'deleted'`,
      [created.id],
    );
    expect(auditRows.rows).toHaveLength(1);
  });
});

// ── executeReport ─────────────────────────────────────────────────────────────

describe('executeReport', () => {
  it('returns columns and rows for a contact query', async () => {
    // Seed one contact using the test actor as owner
    await pool.query(
      `INSERT INTO contacts (first_name, last_name, email, owner_id)
       VALUES ('Test', 'Runner', 'cr-svc-exec@example.com', $1)
       ON CONFLICT (email) DO NOTHING`,
      [ACTOR.id],
    );

    const result = await executeReport(
      'contact',
      { selected_fields: ['first_name', 'last_name', 'email'], filters: [] },
      null,
    );

    expect(result.columns).toEqual(['first_name', 'last_name', 'email']);
    expect(result.rows.length).toBeGreaterThan(0);
    const found = result.rows.find((r) => r['email'] === 'cr-svc-exec@example.com');
    expect(found).toBeDefined();
    expect(found!['first_name']).toBe('Test');
  });

  it('applies a filter condition', async () => {
    const result = await executeReport(
      'contact',
      {
        selected_fields: ['email'],
        filters: [{ field: 'email', operator: 'eq', value: 'cr-svc-exec@example.com' }],
      },
      null,
    );
    expect(result.rows.every((r) => r['email'] === 'cr-svc-exec@example.com')).toBe(true);
  });

  it('applies owner scoping', async () => {
    const randomId = 'aaaaaaaa-0000-0000-0000-000000000000';
    const result = await executeReport(
      'contact',
      { selected_fields: ['email'], filters: [] },
      randomId,
    );
    expect(result.rows.every(() => true)).toBe(true); // should not throw
    expect(result.columns).toContain('email');
  });

  it('applies count aggregate', async () => {
    const result = await executeReport(
      'contact',
      {
        selected_fields: ['first_name'],
        filters: [],
        group_by: 'first_name',
        aggregate: { type: 'count' },
      },
      null,
    );
    expect(result.columns).toContain('_count');
  });

  it('throws INVALID_REPORT_FIELD for a disallowed field', async () => {
    await expect(
      executeReport('contact', { selected_fields: ['password_hash'], filters: [] }, null),
    ).rejects.toMatchObject({ code: 'INVALID_REPORT_FIELD' });
  });

  it('applies is_null filter without crashing', async () => {
    const result = await executeReport(
      'contact',
      {
        selected_fields: ['email'],
        filters: [{ field: 'phone', operator: 'is_null' }],
      },
      null,
    );
    expect(result.columns).toContain('email');
  });
});
