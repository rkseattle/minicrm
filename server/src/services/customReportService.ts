/**
 * Custom report service — CRUD and query execution for saved custom reports. (MINCRM-402)
 * All database access for custom_reports goes through this module.
 */

import pool from '../db.js';
import type { PoolClient } from 'pg';
import type {
  CreateCustomReportBody,
  UpdateCustomReportInput,
  ReportConfig,
  FilterCondition,
  Aggregate,
  ReportVisibility,
} from '@minicrm/shared/schemas/customReportSchema.js';
import { writeAuditEntry } from './auditService.js';
import { SYSTEM_ACTOR } from './auditService.js';
import type { AuditActor } from './auditService.js';

// ── Row shapes ────────────────────────────────────────────────────────────────

export interface CustomReportRow {
  id: string;
  name: string;
  entity_type: string;
  config: ReportConfig;
  visibility: ReportVisibility;
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
}

/**
 * Caller context passed to service functions that enforce visibility/ownership.
 * The role is included so service functions avoid an extra DB lookup — it is
 * already resolved by the auth middleware and available on req.user.
 */
export interface ReportCaller {
  id: string;
  role: string;
}

const REPORT_SELECT =
  'id, name, entity_type, config, visibility, created_by, created_at, updated_at';

// ── Visibility / ownership helpers ────────────────────────────────────────────

function isAdmin(caller: ReportCaller): boolean {
  return caller.role === 'admin';
}

/** Returns true when caller can see this report. */
function canView(report: CustomReportRow, caller: ReportCaller): boolean {
  if (isAdmin(caller)) return true;
  if (report.created_by === caller.id) return true;
  return report.visibility !== 'private';
}

/** Returns true when caller can create/update/delete this report. */
function canMutate(report: CustomReportRow, caller: ReportCaller): boolean {
  if (isAdmin(caller)) return true;
  if (report.created_by === caller.id) return true;
  return report.visibility === 'public';
}

// ── Field allowlists (SQL injection prevention) ───────────────────────────────
// All field names used in SELECT, WHERE, GROUP BY, or ORDER BY must be in these
// sets. Any field not listed is rejected before any SQL is built.

const ALLOWED_FIELDS: Record<string, ReadonlySet<string>> = {
  contact: new Set([
    'id',
    'first_name',
    'last_name',
    'email',
    'phone',
    'title',
    'account_id',
    'created_at',
    'owner_id',
  ]),
  account: new Set(['id', 'name', 'account_type', 'website', 'created_at', 'owner_id']),
  deal: new Set([
    'id',
    'name',
    'stage',
    'value',
    'currency',
    'probability',
    'close_date',
    'created_at',
    'owner_id',
  ]),
  lead: new Set([
    'id',
    'first_name',
    'last_name',
    'email',
    'company_name',
    'status',
    'lead_source',
    'created_at',
    'owner_id',
  ]),
  activity: new Set(['id', 'type', 'status', 'direction', 'outcome', 'created_at', 'owner_id']),
};

/** Table name for each entity type */
const ENTITY_TABLE: Record<string, string> = {
  contact: 'contacts',
  account: 'accounts',
  deal: 'deals',
  lead: 'leads',
  activity: 'activities',
};

/** Numeric fields eligible for sum aggregation, per entity type */
const NUMERIC_FIELDS: Record<string, ReadonlySet<string>> = {
  deal: new Set(['value', 'probability']),
  activity: new Set(),
  contact: new Set(),
  account: new Set(),
  lead: new Set(),
};

/** SQL operator for each filter operator token */
const SQL_OPERATOR: Record<string, string> = {
  eq: '=',
  neq: '!=',
  gt: '>',
  gte: '>=',
  lt: '<',
  lte: '<=',
  contains: 'ILIKE',
  is_null: 'IS NULL',
  is_not_null: 'IS NOT NULL',
};

// ── Validation helpers ────────────────────────────────────────────────────────

function assertFieldAllowed(entityType: string, field: string): void {
  const allowed = ALLOWED_FIELDS[entityType];
  if (!allowed || !allowed.has(field)) {
    throw Object.assign(
      new Error(`Field "${field}" is not allowed for entity type "${entityType}"`),
      {
        code: 'INVALID_REPORT_FIELD',
      },
    );
  }
}

function assertSumFieldAllowed(entityType: string, field: string): void {
  const numeric = NUMERIC_FIELDS[entityType];
  if (!numeric || !numeric.has(field)) {
    throw Object.assign(
      new Error(`Field "${field}" is not a numeric field on "${entityType}" and cannot be summed`),
      { code: 'INVALID_REPORT_FIELD' },
    );
  }
}

function validateConfig(
  entityType: string,
  config:
    | ReportConfig
    | {
        selected_fields: string[];
        filters?: ReportConfig['filters'];
        group_by?: string;
        sort_field?: string;
        aggregate?: ReportConfig['aggregate'];
      },
): void {
  for (const field of config.selected_fields) {
    assertFieldAllowed(entityType, field);
  }
  for (const filter of config.filters ?? []) {
    assertFieldAllowed(entityType, filter.field);
  }
  if (config.group_by) {
    assertFieldAllowed(entityType, config.group_by);
  }
  if (config.sort_field === '_sum' || config.sort_field === '_count') {
    // Aggregate alias sort is only valid when a matching aggregate block exists.
    if (!config.aggregate) {
      throw Object.assign(
        new Error(`sort_field "${config.sort_field}" requires an aggregate block`),
        { code: 'INVALID_REPORT_FIELD' },
      );
    }
  } else if (config.sort_field) {
    assertFieldAllowed(entityType, config.sort_field);
  }
  if (config.aggregate) {
    // aggregate requires group_by; without it every selected field would need
    // to be in GROUP BY but the query builder only adds the group_by column.
    if (!config.group_by) {
      throw Object.assign(new Error(`aggregate requires a group_by field`), {
        code: 'INVALID_REPORT_FIELD',
      });
    }
    if (config.aggregate.type === 'sum' && config.aggregate.field) {
      assertFieldAllowed(entityType, config.aggregate.field);
      assertSumFieldAllowed(entityType, config.aggregate.field);
    }
  }
  // When group_by is set every selected field must equal the group_by column;
  // any other field would violate PostgreSQL GROUP BY rules at query time.
  if (config.group_by) {
    for (const field of config.selected_fields) {
      if (field !== config.group_by) {
        throw Object.assign(
          new Error(
            `Field "${field}" must appear in the GROUP BY clause or be removed from selected_fields when group_by is "${config.group_by}"`,
          ),
          { code: 'INVALID_REPORT_FIELD' },
        );
      }
    }
  }
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

/**
 * Returns saved custom reports visible to the caller, ordered by name.
 * Admins see all reports. Non-admins see public/public_read_only reports plus
 * their own private reports.
 */
export async function listReports(caller: ReportCaller): Promise<CustomReportRow[]> {
  if (isAdmin(caller)) {
    const result = await pool.query<CustomReportRow>(
      `SELECT ${REPORT_SELECT} FROM custom_reports ORDER BY name ASC`,
    );
    return result.rows;
  }

  const result = await pool.query<CustomReportRow>(
    `SELECT ${REPORT_SELECT} FROM custom_reports
     WHERE visibility != 'private' OR created_by = $1
     ORDER BY name ASC`,
    [caller.id],
  );
  return result.rows;
}

/**
 * Returns a single saved custom report by ID, or null if not found or not
 * visible to the caller.
 */
export async function getReport(id: string, caller: ReportCaller): Promise<CustomReportRow | null> {
  const result = await pool.query<CustomReportRow>(
    `SELECT ${REPORT_SELECT} FROM custom_reports WHERE id = $1`,
    [id],
  );
  const report = result.rows[0] ?? null;
  if (!report) return null;
  if (!canView(report, caller)) return null;
  return report;
}

/**
 * Creates a new saved custom report.
 *
 * @throws Error with code CUSTOM_REPORT_NAME_CONFLICT if name already exists
 * @throws Error with code INVALID_REPORT_FIELD if config references a disallowed field
 */
export async function createReport(
  input: CreateCustomReportBody,
  actor: AuditActor = SYSTEM_ACTOR,
): Promise<CustomReportRow> {
  validateConfig(input.entity_type, input.config);

  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');

    let result: { rows: CustomReportRow[] };
    try {
      result = await client.query<CustomReportRow>(
        `INSERT INTO custom_reports (name, entity_type, config, visibility, created_by)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING ${REPORT_SELECT}`,
        [
          input.name,
          input.entity_type,
          JSON.stringify(input.config),
          input.visibility ?? 'public',
          actor.id,
        ],
      );
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === '23505') {
        const e = new Error(`A report named "${input.name}" already exists`);
        (e as NodeJS.ErrnoException).code = 'CUSTOM_REPORT_NAME_CONFLICT';
        throw e;
      }
      throw err;
    }

    const report = result.rows[0];

    await writeAuditEntry(client, {
      recordType: 'custom_report',
      recordId: report.id,
      recordName: report.name,
      eventType: 'created',
      changedById: actor.id,
      changedByName: actor.name,
    });

    await client.query('COMMIT');
    return report;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Updates an existing saved custom report.
 *
 * @returns The updated row, or null if not found
 * @throws Error with code CUSTOM_REPORT_NAME_CONFLICT if the new name already exists
 * @throws Error with code INVALID_REPORT_FIELD if config references a disallowed field
 * @throws Error with code REPORT_FORBIDDEN if caller lacks mutation rights
 */
export async function updateReport(
  id: string,
  input: UpdateCustomReportInput,
  actor: AuditActor & { role: string },
): Promise<CustomReportRow | null> {
  // Fetch existing to check ownership/visibility and validate config
  const existing = await pool.query<CustomReportRow>(
    `SELECT ${REPORT_SELECT} FROM custom_reports WHERE id = $1`,
    [id],
  );
  const before = existing.rows[0] ?? null;
  if (!before) return null;

  if (!canMutate(before, { id: actor.id, role: actor.role })) {
    const e = new Error('You do not have permission to edit this report');
    (e as NodeJS.ErrnoException).code = 'REPORT_FORBIDDEN';
    throw e;
  }

  if (input.config) {
    validateConfig(before.entity_type, input.config);
  }

  const setClauses: string[] = [];
  const values: unknown[] = [id];

  if (input.name !== undefined) {
    values.push(input.name);
    setClauses.push(`name = $${values.length}`);
  }
  if (input.config !== undefined) {
    values.push(JSON.stringify(input.config));
    setClauses.push(`config = $${values.length}`);
  }
  if (input.visibility !== undefined) {
    values.push(input.visibility);
    setClauses.push(`visibility = $${values.length}`);
  }
  setClauses.push(`updated_at = now()`);

  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');

    let result: { rows: CustomReportRow[] };
    try {
      result = await client.query<CustomReportRow>(
        `UPDATE custom_reports SET ${setClauses.join(', ')} WHERE id = $1 RETURNING ${REPORT_SELECT}`,
        values,
      );
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === '23505') {
        const e = new Error(`A report named "${input.name}" already exists`);
        (e as NodeJS.ErrnoException).code = 'CUSTOM_REPORT_NAME_CONFLICT';
        throw e;
      }
      throw err;
    }

    const report = result.rows[0];
    if (!report) {
      await client.query('ROLLBACK');
      return null;
    }

    await writeAuditEntry(client, {
      recordType: 'custom_report',
      recordId: report.id,
      recordName: report.name,
      eventType: 'updated',
      changedById: actor.id,
      changedByName: actor.name,
    });

    await client.query('COMMIT');
    return report;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Deletes a saved custom report.
 *
 * @returns The deleted row, or null if not found
 * @throws Error with code REPORT_FORBIDDEN if caller lacks mutation rights
 */
export async function deleteReport(
  id: string,
  actor: AuditActor & { role: string },
): Promise<CustomReportRow | null> {
  // Check ownership before opening a transaction
  const existing = await pool.query<CustomReportRow>(
    `SELECT ${REPORT_SELECT} FROM custom_reports WHERE id = $1`,
    [id],
  );
  const before = existing.rows[0] ?? null;
  if (!before) return null;

  if (!canMutate(before, { id: actor.id, role: actor.role })) {
    const e = new Error('You do not have permission to delete this report');
    (e as NodeJS.ErrnoException).code = 'REPORT_FORBIDDEN';
    throw e;
  }

  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');

    const result = await client.query<CustomReportRow>(
      `DELETE FROM custom_reports WHERE id = $1 RETURNING ${REPORT_SELECT}`,
      [id],
    );
    const report = result.rows[0];
    if (!report) {
      await client.query('ROLLBACK');
      return null;
    }

    await writeAuditEntry(client, {
      recordType: 'custom_report',
      recordId: report.id,
      recordName: report.name,
      eventType: 'deleted',
      changedById: actor.id,
      changedByName: actor.name,
    });

    await client.query('COMMIT');
    return report;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ── Execute ───────────────────────────────────────────────────────────────────

export interface ReportResult {
  columns: string[];
  rows: Record<string, string | number | null>[];
  row_count: number;
}

/**
 * Executes a report configuration against the database and returns raw results.
 *
 * The query is built dynamically using allowlisted field names only —
 * no user-supplied strings are ever interpolated into SQL identifiers without
 * passing through assertFieldAllowed first.
 *
 * @param entityType - The entity type to query
 * @param config - The validated report config
 * @param scopeOwnerId - When non-null, adds a WHERE owner_id = $N clause (rep scoping)
 * @returns Columns and rows of the result
 */
export async function executeReport(
  entityType: string,
  config: ReportConfig,
  scopeOwnerId: string | null,
): Promise<ReportResult> {
  validateConfig(entityType, config);

  const table = ENTITY_TABLE[entityType];
  if (!table) {
    throw Object.assign(new Error(`Unknown entity type: ${entityType}`), {
      code: 'INVALID_REPORT_FIELD',
    });
  }

  const params: unknown[] = [];

  // ── SELECT clause ──────────────────────────────────────────────────────────
  const selectParts: string[] = config.selected_fields.map((f) => `"${f}"`);

  if (config.aggregate) {
    selectParts.push(buildAggregateExpr(config.aggregate, params, entityType));
  }

  // ── WHERE clause ──────────────────────────────────────────────────────────
  const whereParts: string[] = [];

  for (const filter of config.filters) {
    const expr = buildFilterExpr(filter, params);
    if (expr) whereParts.push(expr);
  }

  if (scopeOwnerId !== null) {
    params.push(scopeOwnerId);
    whereParts.push(`"owner_id" = $${params.length}`);
  }

  // ── GROUP BY ───────────────────────────────────────────────────────────────
  const groupByClause = config.group_by ? `GROUP BY "${config.group_by}"` : '';

  // ── ORDER BY ──────────────────────────────────────────────────────────────
  let orderByClause = '';
  if (config.sort_field) {
    const dir = config.sort_direction === 'desc' ? 'DESC' : 'ASC';
    orderByClause = `ORDER BY "${config.sort_field}" ${dir}`;
  }

  const sql = [
    `SELECT ${selectParts.join(', ')}`,
    `FROM "${table}"`,
    whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')}` : '',
    groupByClause,
    orderByClause,
    'LIMIT 1000',
  ]
    .filter(Boolean)
    .join(' ');

  const result = await pool.query(sql, params);

  const columns = buildColumnNames(config);
  const rows: Record<string, string | number | null>[] = result.rows.map((row) => {
    const out: Record<string, string | number | null> = {};
    for (const col of columns) {
      const val = row[col];
      if (val === null || val === undefined) {
        out[col] = null;
      } else {
        // pg returns all SQL numeric/int types as strings; keep as-is for
        // JS numbers that might appear from custom type parsers in future.
        out[col] = typeof val === 'number' ? val : String(val);
      }
    }
    return out;
  });

  return { columns, rows, row_count: rows.length };
}

// ── SQL builder helpers ───────────────────────────────────────────────────────

function buildFilterExpr(filter: FilterCondition, params: unknown[]): string {
  const col = `"${filter.field}"`;
  const op = SQL_OPERATOR[filter.operator];

  if (filter.operator === 'is_null') return `${col} IS NULL`;
  if (filter.operator === 'is_not_null') return `${col} IS NOT NULL`;

  if (filter.value === undefined || filter.value === null) return '';

  if (filter.operator === 'contains') {
    params.push(`%${filter.value}%`);
  } else {
    params.push(filter.value);
  }
  return `${col} ${op} $${params.length}`;
}

function buildAggregateExpr(aggregate: Aggregate, params: unknown[], entityType: string): string {
  if (aggregate.type === 'count') {
    return 'COUNT(*) AS _count';
  }
  // sum — field is required and already validated against NUMERIC_FIELDS
  const field = aggregate.field ?? '';
  assertSumFieldAllowed(entityType, field);
  return `SUM("${field}") AS _sum`;
}

function buildColumnNames(config: ReportConfig): string[] {
  const cols = [...config.selected_fields];
  if (config.aggregate) {
    cols.push(config.aggregate.type === 'count' ? '_count' : '_sum');
  }
  return cols;
}

// ── NLI report save ───────────────────────────────────────────────────────────

/** Parameters captured from an NLI generateReport call for persistence. (MINCRM-424) */
export interface NliReportSaveParams {
  name: string;
  report_type: 'win_loss' | 'activity_volume' | 'stage_trend';
  date_from?: string | null;
  date_to?: string | null;
  owner_id?: string | null;
  days?: 30 | 60 | 90 | null;
}

/** Maps NLI report type to the most semantically appropriate entity_type for storage */
const NLI_REPORT_ENTITY_TYPE: Record<NliReportSaveParams['report_type'], string> = {
  win_loss: 'deal',
  activity_volume: 'activity',
  stage_trend: 'deal',
};

/**
 * Saves an NLI-generated analytic report to the custom_reports table so it appears
 * in the Reports module. The config jsonb carries an `nli_report_type` marker and
 * the original generation parameters — the custom report executor ignores unknown
 * keys so this is safe, and the Reports UI routes on `nli_report_type` to render
 * the correct analytic view. (MINCRM-424)
 */
export async function saveNliReport(
  params: NliReportSaveParams,
  actor: AuditActor,
): Promise<CustomReportRow> {
  const configJson = JSON.stringify({
    selected_fields: ['id'],
    filters: [],
    nli_report_type: params.report_type,
    nli_date_from: params.date_from ?? null,
    nli_date_to: params.date_to ?? null,
    nli_owner_id: params.owner_id ?? null,
    nli_days: params.days ?? null,
  });

  const entityType = NLI_REPORT_ENTITY_TYPE[params.report_type];

  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');

    let result: { rows: CustomReportRow[] };
    try {
      result = await client.query<CustomReportRow>(
        `INSERT INTO custom_reports (name, entity_type, config, visibility, created_by)
         VALUES ($1, $2, $3::jsonb, $4, $5)
         RETURNING ${REPORT_SELECT}`,
        [params.name, entityType, configJson, 'public', actor.id],
      );
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === '23505') {
        const e = new Error(`A report named "${params.name}" already exists`);
        (e as NodeJS.ErrnoException).code = 'CUSTOM_REPORT_NAME_CONFLICT';
        throw e;
      }
      throw err;
    }

    const report = result.rows[0]!;

    await writeAuditEntry(client, {
      recordType: 'custom_report',
      recordId: report.id,
      recordName: report.name,
      eventType: 'created',
      changedById: actor.id,
      changedByName: actor.name,
    });

    await client.query('COMMIT');
    return report;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ── Response mapping ──────────────────────────────────────────────────────────

export function toReportResponse(row: CustomReportRow): {
  id: string;
  name: string;
  entity_type: string;
  config: ReportConfig;
  visibility: ReportVisibility;
  created_by: string | null;
  created_at: string;
  updated_at: string;
} {
  return {
    id: row.id,
    name: row.name,
    entity_type: row.entity_type,
    config: row.config,
    visibility: row.visibility,
    created_by: row.created_by,
    created_at:
      row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    updated_at:
      row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
  };
}
