/**
 * Custom report service — CRUD and query execution for saved custom reports. (MINCRM-402)
 * All database access for custom_reports goes through this module.
 */

import pool from '../db.js';
import type { PoolClient } from 'pg';
import type {
  CreateCustomReportInput,
  UpdateCustomReportInput,
  ReportConfig,
  FilterCondition,
  Aggregate,
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
  created_by: string | null;
  created_at: Date;
  updated_at: Date;
}

const REPORT_SELECT = 'id, name, entity_type, config, created_by, created_at, updated_at';

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

function validateConfig(entityType: string, config: ReportConfig): void {
  for (const field of config.selected_fields) {
    assertFieldAllowed(entityType, field);
  }
  for (const filter of config.filters) {
    assertFieldAllowed(entityType, filter.field);
  }
  if (config.group_by) {
    assertFieldAllowed(entityType, config.group_by);
  }
  if (config.sort_field) {
    assertFieldAllowed(entityType, config.sort_field);
  }
  if (config.aggregate?.type === 'sum' && config.aggregate.field) {
    assertFieldAllowed(entityType, config.aggregate.field);
    assertSumFieldAllowed(entityType, config.aggregate.field);
  }
}

// ── CRUD ──────────────────────────────────────────────────────────────────────

/**
 * Returns all saved custom reports, ordered by name.
 */
export async function listReports(): Promise<CustomReportRow[]> {
  const result = await pool.query<CustomReportRow>(
    `SELECT ${REPORT_SELECT} FROM custom_reports ORDER BY name ASC`,
  );
  return result.rows;
}

/**
 * Returns a single saved custom report by ID.
 *
 * @returns The report row, or null if not found
 */
export async function getReport(id: string): Promise<CustomReportRow | null> {
  const result = await pool.query<CustomReportRow>(
    `SELECT ${REPORT_SELECT} FROM custom_reports WHERE id = $1`,
    [id],
  );
  return result.rows[0] ?? null;
}

/**
 * Creates a new saved custom report.
 *
 * @throws Error with code CUSTOM_REPORT_NAME_CONFLICT if name already exists
 * @throws Error with code INVALID_REPORT_FIELD if config references a disallowed field
 */
export async function createReport(
  input: CreateCustomReportInput,
  actor: AuditActor = SYSTEM_ACTOR,
): Promise<CustomReportRow> {
  validateConfig(input.entity_type, input.config);

  const client: PoolClient = await pool.connect();
  try {
    await client.query('BEGIN');

    let result: { rows: CustomReportRow[] };
    try {
      result = await client.query<CustomReportRow>(
        `INSERT INTO custom_reports (name, entity_type, config, created_by)
         VALUES ($1, $2, $3, $4)
         RETURNING ${REPORT_SELECT}`,
        [input.name, input.entity_type, JSON.stringify(input.config), actor.id],
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
 */
export async function updateReport(
  id: string,
  input: UpdateCustomReportInput,
  actor: AuditActor = SYSTEM_ACTOR,
): Promise<CustomReportRow | null> {
  if (input.config) {
    // entity_type cannot change — fetch it first to validate the updated config
    const existing = await getReport(id);
    if (!existing) return null;
    validateConfig(existing.entity_type, input.config);
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
 */
export async function deleteReport(
  id: string,
  actor: AuditActor = SYSTEM_ACTOR,
): Promise<CustomReportRow | null> {
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
      } else if (typeof val === 'number') {
        out[col] = val;
      } else {
        out[col] = String(val);
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

// ── Response mapping ──────────────────────────────────────────────────────────

export function toReportResponse(row: CustomReportRow): {
  id: string;
  name: string;
  entity_type: string;
  config: ReportConfig;
  created_by: string | null;
  created_at: string;
  updated_at: string;
} {
  return {
    id: row.id,
    name: row.name,
    entity_type: row.entity_type,
    config: row.config,
    created_by: row.created_by,
    created_at:
      row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    updated_at:
      row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
  };
}
