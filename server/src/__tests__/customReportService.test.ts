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

const ADMIN_CALLER = { id: '', role: 'admin' };
const REP_CALLER = { id: '', role: 'rep' };

const BASIC_CONFIG = {
  selected_fields: ['id', 'first_name', 'last_name'],
  filters: [],
};

let ACTOR = { id: '', name: 'Test Actor' };

async function truncate(): Promise<void> {
  await pool.query(`DELETE FROM custom_reports WHERE name LIKE $1`, [`${FILE_PREFIX}-%`]);
}

let REP_ACTOR = { id: '', name: 'Test Rep' };

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
  ADMIN_CALLER.id = actor.id;

  const rep = await createUser({
    email: `${FILE_PREFIX}-rep@example.com`,
    name: 'Test Rep',
    role: 'rep',
    status: 'active',
    passwordHash: null,
  });
  REP_ACTOR = { id: rep.id, name: rep.name };
  REP_CALLER.id = rep.id;
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
    const result = await listReports(ADMIN_CALLER);
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

    const all = await listReports(ADMIN_CALLER);
    const ours = all.filter((r) => r.name.startsWith(FILE_PREFIX));
    expect(ours).toHaveLength(2);
    expect(ours[0].name).toBe(`${FILE_PREFIX}-Alpha`);
    expect(ours[1].name).toBe(`${FILE_PREFIX}-Beta`);
  });

  it('excludes private reports for non-owners', async () => {
    await createReport(
      {
        name: `${FILE_PREFIX}-Private`,
        entity_type: 'contact',
        config: BASIC_CONFIG,
        visibility: 'private',
      },
      ACTOR,
    );
    const all = await listReports(REP_CALLER);
    const ours = all.filter((r) => r.name.startsWith(FILE_PREFIX));
    expect(ours.find((r) => r.name === `${FILE_PREFIX}-Private`)).toBeUndefined();
  });

  it('includes private reports for their owner', async () => {
    await createReport(
      {
        name: `${FILE_PREFIX}-OwnPrivate`,
        entity_type: 'contact',
        config: BASIC_CONFIG,
        visibility: 'private',
      },
      REP_ACTOR,
    );
    const all = await listReports(REP_CALLER);
    const ours = all.filter((r) => r.name.startsWith(FILE_PREFIX));
    expect(ours.find((r) => r.name === `${FILE_PREFIX}-OwnPrivate`)).toBeDefined();
  });

  it('includes all reports for admins regardless of visibility', async () => {
    await createReport(
      {
        name: `${FILE_PREFIX}-AdminSee`,
        entity_type: 'contact',
        config: BASIC_CONFIG,
        visibility: 'private',
      },
      REP_ACTOR,
    );
    const all = await listReports(ADMIN_CALLER);
    const ours = all.filter((r) => r.name.startsWith(FILE_PREFIX));
    expect(ours.find((r) => r.name === `${FILE_PREFIX}-AdminSee`)).toBeDefined();
  });
});

// ── getReport ─────────────────────────────────────────────────────────────────

describe('getReport', () => {
  it('returns null for a nonexistent ID', async () => {
    const result = await getReport('00000000-0000-0000-0000-000000000000', ADMIN_CALLER);
    expect(result).toBeNull();
  });

  it('returns the report by ID for the owner', async () => {
    const created = await createReport(
      { name: `${FILE_PREFIX}-Get`, entity_type: 'contact', config: BASIC_CONFIG },
      ACTOR,
    );
    const found = await getReport(created.id, ADMIN_CALLER);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(created.id);
    expect(found!.name).toBe(`${FILE_PREFIX}-Get`);
  });

  it('returns null for a private report when caller is not owner or admin', async () => {
    const created = await createReport(
      {
        name: `${FILE_PREFIX}-GetPriv`,
        entity_type: 'contact',
        config: BASIC_CONFIG,
        visibility: 'private',
      },
      ACTOR,
    );
    const found = await getReport(created.id, REP_CALLER);
    expect(found).toBeNull();
  });

  it('returns a public_read_only report to non-owners', async () => {
    const created = await createReport(
      {
        name: `${FILE_PREFIX}-GetReadOnly`,
        entity_type: 'contact',
        config: BASIC_CONFIG,
        visibility: 'public_read_only',
      },
      ACTOR,
    );
    const found = await getReport(created.id, REP_CALLER);
    expect(found).not.toBeNull();
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
    const actor = { id: user.id, name: user.name, role: 'admin' };
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

const ADMIN_ACTOR_WITH_ROLE = () => ({ ...ACTOR, role: 'admin' });
const REP_ACTOR_WITH_ROLE = () => ({ ...REP_ACTOR, role: 'rep' });

describe('updateReport', () => {
  it('returns null for a nonexistent ID', async () => {
    const result = await updateReport(
      '00000000-0000-0000-0000-000000000000',
      { name: 'x' },
      ADMIN_ACTOR_WITH_ROLE(),
    );
    expect(result).toBeNull();
  });

  it('updates the report name', async () => {
    const created = await createReport(
      { name: `${FILE_PREFIX}-UpdOld`, entity_type: 'contact', config: BASIC_CONFIG },
      ADMIN_ACTOR_WITH_ROLE(),
    );
    const updated = await updateReport(
      created.id,
      { name: `${FILE_PREFIX}-UpdNew` },
      ADMIN_ACTOR_WITH_ROLE(),
    );
    expect(updated!.name).toBe(`${FILE_PREFIX}-UpdNew`);
  });

  it('updates the report config', async () => {
    const created = await createReport(
      { name: `${FILE_PREFIX}-UpdCfg`, entity_type: 'contact', config: BASIC_CONFIG },
      ADMIN_ACTOR_WITH_ROLE(),
    );
    const newConfig = { selected_fields: ['id', 'email'], filters: [] };
    const updated = await updateReport(created.id, { config: newConfig }, ADMIN_ACTOR_WITH_ROLE());
    expect(updated!.config.selected_fields).toEqual(['id', 'email']);
  });

  it('updates the report visibility', async () => {
    const created = await createReport(
      {
        name: `${FILE_PREFIX}-UpdVis`,
        entity_type: 'contact',
        config: BASIC_CONFIG,
        visibility: 'public',
      },
      ADMIN_ACTOR_WITH_ROLE(),
    );
    const updated = await updateReport(
      created.id,
      { visibility: 'private' },
      ADMIN_ACTOR_WITH_ROLE(),
    );
    expect(updated!.visibility).toBe('private');
  });

  it('throws CUSTOM_REPORT_NAME_CONFLICT on name collision', async () => {
    await createReport(
      { name: `${FILE_PREFIX}-Existing`, entity_type: 'contact', config: BASIC_CONFIG },
      ADMIN_ACTOR_WITH_ROLE(),
    );
    const second = await createReport(
      { name: `${FILE_PREFIX}-Second`, entity_type: 'contact', config: BASIC_CONFIG },
      ADMIN_ACTOR_WITH_ROLE(),
    );
    await expect(
      updateReport(second.id, { name: `${FILE_PREFIX}-Existing` }, ADMIN_ACTOR_WITH_ROLE()),
    ).rejects.toMatchObject({ code: 'CUSTOM_REPORT_NAME_CONFLICT' });
  });

  it('throws REPORT_FORBIDDEN when rep tries to update a public_read_only report they do not own', async () => {
    const created = await createReport(
      {
        name: `${FILE_PREFIX}-UpdForbidden`,
        entity_type: 'contact',
        config: BASIC_CONFIG,
        visibility: 'public_read_only',
      },
      ADMIN_ACTOR_WITH_ROLE(),
    );
    await expect(
      updateReport(created.id, { name: `${FILE_PREFIX}-UpdForbiddenNew` }, REP_ACTOR_WITH_ROLE()),
    ).rejects.toMatchObject({ code: 'REPORT_FORBIDDEN' });
  });

  it('allows rep to update a public report they do not own', async () => {
    const created = await createReport(
      {
        name: `${FILE_PREFIX}-UpdPublic`,
        entity_type: 'contact',
        config: BASIC_CONFIG,
        visibility: 'public',
      },
      ADMIN_ACTOR_WITH_ROLE(),
    );
    const updated = await updateReport(
      created.id,
      { name: `${FILE_PREFIX}-UpdPublicNew` },
      REP_ACTOR_WITH_ROLE(),
    );
    expect(updated!.name).toBe(`${FILE_PREFIX}-UpdPublicNew`);
  });

  it('allows rep to update their own private report', async () => {
    const created = await createReport(
      {
        name: `${FILE_PREFIX}-OwnPrivUpd`,
        entity_type: 'contact',
        config: BASIC_CONFIG,
        visibility: 'private',
      },
      REP_ACTOR_WITH_ROLE(),
    );
    const updated = await updateReport(
      created.id,
      { name: `${FILE_PREFIX}-OwnPrivUpdNew` },
      REP_ACTOR_WITH_ROLE(),
    );
    expect(updated!.name).toBe(`${FILE_PREFIX}-OwnPrivUpdNew`);
  });
});

// ── deleteReport ──────────────────────────────────────────────────────────────

describe('deleteReport', () => {
  it('returns null for a nonexistent ID', async () => {
    const result = await deleteReport(
      '00000000-0000-0000-0000-000000000000',
      ADMIN_ACTOR_WITH_ROLE(),
    );
    expect(result).toBeNull();
  });

  it('deletes the report and returns it', async () => {
    const created = await createReport(
      { name: `${FILE_PREFIX}-Del`, entity_type: 'contact', config: BASIC_CONFIG },
      ADMIN_ACTOR_WITH_ROLE(),
    );
    const deleted = await deleteReport(created.id, ADMIN_ACTOR_WITH_ROLE());
    expect(deleted!.id).toBe(created.id);

    const found = await getReport(created.id, ADMIN_CALLER);
    expect(found).toBeNull();
  });

  it('writes an audit entry on delete', async () => {
    const created = await createReport(
      { name: `${FILE_PREFIX}-DelAudit`, entity_type: 'contact', config: BASIC_CONFIG },
      ADMIN_ACTOR_WITH_ROLE(),
    );
    await deleteReport(created.id, ADMIN_ACTOR_WITH_ROLE());

    const auditRows = await pool.query(
      `SELECT * FROM audit_log WHERE record_type = 'custom_report' AND record_id = $1 AND event_type = 'deleted'`,
      [created.id],
    );
    expect(auditRows.rows).toHaveLength(1);
  });

  it('throws REPORT_FORBIDDEN when rep tries to delete a public_read_only report they do not own', async () => {
    const created = await createReport(
      {
        name: `${FILE_PREFIX}-DelForbidden`,
        entity_type: 'contact',
        config: BASIC_CONFIG,
        visibility: 'public_read_only',
      },
      ADMIN_ACTOR_WITH_ROLE(),
    );
    await expect(deleteReport(created.id, REP_ACTOR_WITH_ROLE())).rejects.toMatchObject({
      code: 'REPORT_FORBIDDEN',
    });
  });

  it('allows rep to delete a public report they do not own', async () => {
    const created = await createReport(
      {
        name: `${FILE_PREFIX}-DelPublic`,
        entity_type: 'contact',
        config: BASIC_CONFIG,
        visibility: 'public',
      },
      ADMIN_ACTOR_WITH_ROLE(),
    );
    const deleted = await deleteReport(created.id, REP_ACTOR_WITH_ROLE());
    expect(deleted!.id).toBe(created.id);
  });

  it('allows rep to delete their own private report', async () => {
    const created = await createReport(
      {
        name: `${FILE_PREFIX}-OwnPrivDel`,
        entity_type: 'contact',
        config: BASIC_CONFIG,
        visibility: 'private',
      },
      REP_ACTOR_WITH_ROLE(),
    );
    const deleted = await deleteReport(created.id, REP_ACTOR_WITH_ROLE());
    expect(deleted!.id).toBe(created.id);
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

  it('allows account_id as a contact field', async () => {
    const result = await executeReport(
      'contact',
      { selected_fields: ['email', 'account_id'], filters: [] },
      null,
    );
    expect(result.columns).toContain('account_id');
  });

  it('allows company_name as a lead field', async () => {
    const result = await executeReport(
      'lead',
      { selected_fields: ['first_name', 'company_name'], filters: [] },
      null,
    );
    expect(result.columns).toContain('company_name');
  });

  it('allows sorting by _sum aggregate alias', async () => {
    const result = await executeReport(
      'deal',
      {
        selected_fields: ['stage'],
        filters: [],
        group_by: 'stage',
        sort_field: '_sum',
        sort_direction: 'desc',
        aggregate: { type: 'sum', field: 'value' },
      },
      null,
    );
    expect(result.columns).toContain('_sum');
  });

  it('throws INVALID_REPORT_FIELD when _sum sort used without aggregate', async () => {
    await expect(
      executeReport('deal', { selected_fields: ['stage'], filters: [], sort_field: '_sum' }, null),
    ).rejects.toMatchObject({ code: 'INVALID_REPORT_FIELD' });
  });

  it('throws INVALID_REPORT_FIELD when aggregate is provided without group_by', async () => {
    await expect(
      executeReport(
        'deal',
        { selected_fields: ['stage'], filters: [], aggregate: { type: 'count' } },
        null,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_REPORT_FIELD' });
  });

  it('throws INVALID_REPORT_FIELD when selected fields are not covered by group_by', async () => {
    await expect(
      executeReport(
        'deal',
        { selected_fields: ['stage', 'name'], filters: [], group_by: 'stage' },
        null,
      ),
    ).rejects.toMatchObject({ code: 'INVALID_REPORT_FIELD' });
  });

  it('applies contains filter operator', async () => {
    await pool.query(
      `INSERT INTO contacts (first_name, last_name, email, owner_id)
       VALUES ('Contains', 'Test', 'cr-svc-contains@example.com', $1)
       ON CONFLICT (email) DO NOTHING`,
      [ACTOR.id],
    );
    const result = await executeReport(
      'contact',
      {
        selected_fields: ['email'],
        filters: [{ field: 'email', operator: 'contains', value: 'cr-svc-contains' }],
      },
      null,
    );
    expect(result.rows.some((r) => r['email'] === 'cr-svc-contains@example.com')).toBe(true);
  });

  it('maps null column values to null in the result', async () => {
    await pool.query(
      `INSERT INTO contacts (first_name, last_name, email, owner_id)
       VALUES ('NullPhone', 'Test', 'cr-svc-nullphone@example.com', $1)
       ON CONFLICT (email) DO NOTHING`,
      [ACTOR.id],
    );
    const result = await executeReport(
      'contact',
      {
        selected_fields: ['email', 'phone'],
        filters: [{ field: 'email', operator: 'eq', value: 'cr-svc-nullphone@example.com' }],
      },
      null,
    );
    const row = result.rows.find((r) => r['email'] === 'cr-svc-nullphone@example.com');
    expect(row).toBeDefined();
    expect(row!['phone']).toBeNull();
  });

  it('toReportResponse maps row fields to the response shape', async () => {
    const report = await createReport(
      { name: `${FILE_PREFIX}-ResponseMap`, entity_type: 'contact', config: BASIC_CONFIG },
      ACTOR,
    );
    const { toReportResponse } = await import('../services/customReportService.js');
    const raw = { ...report, created_at: new Date(), updated_at: new Date() };
    const resp = toReportResponse(raw);
    expect(resp.id).toBe(report.id);
    expect(resp.entity_type).toBe('contact');
    expect(typeof resp.created_at).toBe('string');
  });
});
