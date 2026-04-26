/**
 * Import service — CSV import logic for accounts, contacts, and deals.
 * Handles CSV parsing, field validation, duplicate detection, and DB insertion.
 * MINCRM-158, MINCRM-159, MINCRM-160
 */

import { parse } from 'csv-parse/sync';
import pool from '../db.js';
import { PIPELINE_STAGES } from '@minicrm/shared/schemas/dealSchema.js';

/** Maximum CSV file size in bytes (10 MB) */
export const MAX_CSV_BYTES = 10 * 1024 * 1024;

/** Number of preview rows to return after parsing */
const PREVIEW_ROW_COUNT = 5;

/** How often (in rows) the onProgress callback is fired during a background import */
export const PROGRESS_UPDATE_INTERVAL = 100;

/** Raw parsed CSV row — all values are strings */
export type CsvRow = Record<string, string>;

/** A single import failure record */
export interface ImportFailure {
  /** 1-based row number in the CSV (excluding header) */
  row: number;
  /** Raw CSV values for this row */
  data: CsvRow;
  /** Human-readable reason for the failure */
  reason: string;
}

/** Result returned by each importXxx function */
export interface ImportResult {
  created: number;
  skipped: number;
  failed: ImportFailure[];
}

/**
 * Called every PROGRESS_UPDATE_INTERVAL rows during a background import.
 * Receives the current running totals so the caller can write to import_jobs.
 */
export type ProgressCallback = (
  processedRows: number,
  created: number,
  skipped: number,
  failed: number,
) => Promise<void>;

/** A parsed CSV payload ready for import processing */
export interface ParsedCsv {
  /** Column headers from the CSV */
  headers: string[];
  /** All data rows (including those beyond the preview) */
  rows: CsvRow[];
  /** First PREVIEW_ROW_COUNT rows for the UI preview */
  preview: CsvRow[];
}

// ── Field definitions ──────────────────────────────────────────────────────────

/** A CRM field that a CSV column can be mapped to */
export interface CrmField {
  key: string;
  label: string;
  required: boolean;
}

/** Importable CRM fields for accounts (MINCRM-159) */
export const ACCOUNT_FIELDS: CrmField[] = [
  { key: 'name', label: 'Company Name', required: true },
  { key: 'industry', label: 'Industry', required: false },
  { key: 'website', label: 'Website', required: false },
  { key: 'employee_range', label: 'Employee Range', required: false },
  { key: 'revenue_range', label: 'Revenue Range', required: false },
];

/** Importable CRM fields for contacts (MINCRM-158) */
export const CONTACT_FIELDS: CrmField[] = [
  { key: 'first_name', label: 'First Name', required: true },
  { key: 'last_name', label: 'Last Name', required: true },
  { key: 'email', label: 'Email', required: true },
  { key: 'phone', label: 'Phone', required: false },
  { key: 'title', label: 'Title', required: false },
  { key: 'department', label: 'Department', required: false },
  { key: 'account_name', label: 'Account Name (for lookup)', required: false },
];

/** Importable CRM fields for deals (MINCRM-160) */
export const DEAL_FIELDS: CrmField[] = [
  { key: 'name', label: 'Deal Name', required: true },
  { key: 'stage', label: 'Stage', required: true },
  { key: 'value', label: 'Value', required: false },
  { key: 'close_date', label: 'Close Date (YYYY-MM-DD)', required: false },
  { key: 'loss_reason', label: 'Loss Reason', required: false },
  { key: 'account_name', label: 'Account Name (for lookup)', required: false },
];

// ── CSV parsing ────────────────────────────────────────────────────────────────

/**
 * Parses a CSV buffer into headers, all rows, and a preview slice.
 *
 * @param buffer - Raw CSV file bytes.
 * @returns Parsed CSV structure with headers, rows, and preview.
 * @throws Error if the CSV cannot be parsed or has no data rows.
 */
export function parseCsvBuffer(buffer: Buffer): ParsedCsv {
  const rows = parse(buffer, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  }) as CsvRow[];

  if (rows.length === 0) {
    throw new Error('CSV file contains no data rows');
  }

  const headers = Object.keys(rows[0]);

  return {
    headers,
    rows,
    preview: rows.slice(0, PREVIEW_ROW_COUNT),
  };
}

// ── Error CSV generation ───────────────────────────────────────────────────────

/**
 * Builds a downloadable CSV string from a list of import failures.
 *
 * @param failures - The failures to serialize.
 * @returns A CSV string with row number, reason, and original field values.
 */
export function buildErrorCsv(failures: ImportFailure[]): string {
  if (failures.length === 0) return '';

  const allKeys = Array.from(new Set(failures.flatMap((f) => Object.keys(f.data))));
  const header = ['row_number', 'reason', ...allKeys].join(',');

  const lines = failures.map((f) => {
    const cells = [
      String(f.row),
      `"${f.reason.replace(/"/g, '""')}"`,
      ...allKeys.map((k) => {
        const val = f.data[k] ?? '';
        return `"${val.replace(/"/g, '""')}"`;
      }),
    ];
    return cells.join(',');
  });

  return [header, ...lines].join('\n');
}

// ── Account import (MINCRM-159) ────────────────────────────────────────────────

/** Column mapping for account import: CRM field key → CSV column header */
export type AccountMapping = {
  name: string;
  industry?: string;
  website?: string;
  employee_range?: string;
  revenue_range?: string;
};

/**
 * Imports accounts from parsed CSV rows using the provided column mapping.
 * Skips rows where an account with the same name already exists.
 * Admin may override duplicate behavior on a per-row basis via the mapping flag,
 * but the default is to skip duplicates.
 *
 * @param rows - All CSV data rows.
 * @param mapping - Maps CRM field keys to CSV column headers.
 * @param adminId - The importing admin's user ID (becomes owner_id).
 * @param skipDuplicates - When true (default), skip rows where account name already exists.
 * @returns Import summary with counts and failure details.
 */
export async function importAccounts(
  rows: CsvRow[],
  mapping: AccountMapping,
  adminId: string,
  skipDuplicates: boolean = true,
  onProgress?: ProgressCallback,
): Promise<ImportResult> {
  const result: ImportResult = { created: 0, skipped: 0, failed: [] };

  // Pre-load all existing account names (lowercase) for duplicate detection
  const { rows: existingRows } = await pool.query<{ name: string }>('SELECT name FROM accounts');
  const existingNames = new Set(existingRows.map((r) => r.name.toLowerCase()));

  for (let i = 0; i < rows.length; i++) {
    const rowNum = i + 1;
    const csvRow = rows[i];

    const name = (csvRow[mapping.name] ?? '').trim();
    if (!name) {
      result.failed.push({ row: rowNum, data: csvRow, reason: 'Missing required field: name' });
      continue;
    }

    if (existingNames.has(name.toLowerCase()) && skipDuplicates) {
      result.skipped++;
      continue;
    }

    const industry = mapping.industry ? (csvRow[mapping.industry] ?? '').trim() || null : null;
    const website = mapping.website ? (csvRow[mapping.website] ?? '').trim() || null : null;
    const employeeRange = mapping.employee_range
      ? (csvRow[mapping.employee_range] ?? '').trim() || null
      : null;
    const revenueRange = mapping.revenue_range
      ? (csvRow[mapping.revenue_range] ?? '').trim() || null
      : null;

    try {
      await pool.query(
        `INSERT INTO accounts (name, industry, website, employee_range, revenue_range, owner_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [name, industry, website, employeeRange, revenueRange, adminId],
      );
      existingNames.add(name.toLowerCase());
      result.created++;
    } catch (err) {
      result.failed.push({
        row: rowNum,
        data: csvRow,
        reason: `Database error: ${(err as Error).message}`,
      });
    }

    if (onProgress && rowNum % PROGRESS_UPDATE_INTERVAL === 0) {
      await onProgress(rowNum, result.created, result.skipped, result.failed.length);
    }
  }

  return result;
}

// ── Contact import (MINCRM-158) ────────────────────────────────────────────────

/** Column mapping for contact import: CRM field key → CSV column header */
export type ContactMapping = {
  first_name: string;
  last_name: string;
  email: string;
  phone?: string;
  title?: string;
  department?: string;
  account_name?: string;
};

/** Basic email format regex */
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Imports contacts from parsed CSV rows using the provided column mapping.
 * Skips rows where a contact with the same email already exists.
 *
 * @param rows - All CSV data rows.
 * @param mapping - Maps CRM field keys to CSV column headers.
 * @param adminId - The importing admin's user ID (becomes owner_id for all imported contacts).
 * @returns Import summary with counts and failure details.
 */
export async function importContacts(
  rows: CsvRow[],
  mapping: ContactMapping,
  adminId: string,
  onProgress?: ProgressCallback,
): Promise<ImportResult> {
  const result: ImportResult = { created: 0, skipped: 0, failed: [] };

  // Pre-load all existing emails for duplicate detection
  const { rows: existingRows } = await pool.query<{ email: string }>('SELECT email FROM contacts');
  const existingEmails = new Set(existingRows.map((r) => r.email.toLowerCase()));

  // Pre-load account name → id map for account_name lookup
  const { rows: accountRows } = await pool.query<{ id: string; name: string }>(
    'SELECT id, name FROM accounts',
  );
  const accountByName = new Map(accountRows.map((r) => [r.name.toLowerCase(), r.id]));

  for (let i = 0; i < rows.length; i++) {
    const rowNum = i + 1;
    const csvRow = rows[i];

    const firstName = (csvRow[mapping.first_name] ?? '').trim();
    const lastName = (csvRow[mapping.last_name] ?? '').trim();
    const email = (csvRow[mapping.email] ?? '').trim().toLowerCase();

    const validationErrors: string[] = [];
    if (!firstName) validationErrors.push('Missing required field: first_name');
    if (!lastName) validationErrors.push('Missing required field: last_name');
    if (!email) {
      validationErrors.push('Missing required field: email');
    } else if (!EMAIL_REGEX.test(email)) {
      validationErrors.push('Invalid email format');
    }

    if (validationErrors.length > 0) {
      result.failed.push({ row: rowNum, data: csvRow, reason: validationErrors.join('; ') });
      continue;
    }

    if (existingEmails.has(email)) {
      result.skipped++;
      continue;
    }

    const phone = mapping.phone ? (csvRow[mapping.phone] ?? '').trim() || null : null;
    const title = mapping.title ? (csvRow[mapping.title] ?? '').trim() || null : null;
    const department = mapping.department
      ? (csvRow[mapping.department] ?? '').trim() || null
      : null;

    let accountId: string | null = null;
    if (mapping.account_name) {
      const acctName = (csvRow[mapping.account_name] ?? '').trim().toLowerCase();
      if (acctName) {
        accountId = accountByName.get(acctName) ?? null;
      }
    }

    try {
      await pool.query(
        `INSERT INTO contacts
           (first_name, last_name, email, phone, title, department, account_id, owner_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [firstName, lastName, email, phone, title, department, accountId, adminId],
      );
      existingEmails.add(email);
      result.created++;
    } catch (err) {
      result.failed.push({
        row: rowNum,
        data: csvRow,
        reason: `Database error: ${(err as Error).message}`,
      });
    }

    if (onProgress && rowNum % PROGRESS_UPDATE_INTERVAL === 0) {
      await onProgress(rowNum, result.created, result.skipped, result.failed.length);
    }
  }

  return result;
}

// ── Deal import (MINCRM-160) ───────────────────────────────────────────────────

/** Column mapping for deal import: CRM field key → CSV column header */
export type DealMapping = {
  name: string;
  stage: string;
  value?: string;
  close_date?: string;
  loss_reason?: string;
  account_name?: string;
  /** When true, skip rows whose account_name doesn't resolve. Default: false (import without link). */
  skip_unresolvable_accounts?: boolean;
};

/** Pipeline stage lookup — case-insensitive */
const STAGE_MAP = new Map(PIPELINE_STAGES.map((s) => [s.toLowerCase(), s]));

/**
 * Imports deals from parsed CSV rows using the provided column mapping.
 *
 * @param rows - All CSV data rows.
 * @param mapping - Maps CRM field keys to CSV column headers.
 * @param adminId - The importing admin's user ID (becomes owner_id).
 * @returns Import summary with counts and failure details.
 */
export async function importDeals(
  rows: CsvRow[],
  mapping: DealMapping,
  adminId: string,
  onProgress?: ProgressCallback,
): Promise<ImportResult> {
  const result: ImportResult = { created: 0, skipped: 0, failed: [] };

  // Pre-load account name → id map for lookup
  const { rows: accountRows } = await pool.query<{ id: string; name: string }>(
    'SELECT id, name FROM accounts',
  );
  const accountByName = new Map(accountRows.map((r) => [r.name.toLowerCase(), r.id]));

  for (let i = 0; i < rows.length; i++) {
    const rowNum = i + 1;
    const csvRow = rows[i];

    const name = (csvRow[mapping.name] ?? '').trim();
    const stageRaw = (csvRow[mapping.stage] ?? '').trim();
    const stage = STAGE_MAP.get(stageRaw.toLowerCase());

    const validationErrors: string[] = [];
    if (!name) validationErrors.push('Missing required field: name');
    if (!stageRaw) {
      validationErrors.push('Missing required field: stage');
    } else if (!stage) {
      validationErrors.push(
        `Unrecognised stage "${stageRaw}". Must be one of: ${PIPELINE_STAGES.join(', ')}`,
      );
    }

    if (validationErrors.length > 0) {
      result.failed.push({ row: rowNum, data: csvRow, reason: validationErrors.join('; ') });
      continue;
    }

    // Account lookup
    let accountId: string | null = null;
    if (mapping.account_name) {
      const acctName = (csvRow[mapping.account_name] ?? '').trim().toLowerCase();
      if (acctName) {
        const resolved = accountByName.get(acctName);
        if (!resolved && mapping.skip_unresolvable_accounts) {
          result.skipped++;
          continue;
        }
        accountId = resolved ?? null;
      }
    }

    // Value: must be a non-negative number if provided
    let dealValue: number | null = null;
    if (mapping.value) {
      const rawValue = (csvRow[mapping.value] ?? '').trim();
      if (rawValue) {
        // Strip currency symbols and commas before parsing
        const stripped = rawValue.replace(/[^0-9.]/g, '');
        const parsed = stripped.length > 0 ? Number(stripped) : NaN;
        if (isNaN(parsed) || parsed < 0) {
          result.failed.push({
            row: rowNum,
            data: csvRow,
            reason: `Invalid value "${rawValue}" — must be a non-negative number`,
          });
          continue;
        }
        dealValue = parsed;
      }
    }

    const closeDateRaw = mapping.close_date ? (csvRow[mapping.close_date] ?? '').trim() : '';
    let closeDate: string | null = closeDateRaw || null;
    if (closeDate && !/^\d{4}-\d{2}-\d{2}$/.test(closeDate)) {
      result.failed.push({
        row: rowNum,
        data: csvRow,
        reason: `Invalid close_date "${closeDate}" — expected YYYY-MM-DD`,
      });
      continue;
    }

    const lossReason = mapping.loss_reason
      ? (csvRow[mapping.loss_reason] ?? '').trim() || null
      : null;

    try {
      await pool.query(
        `INSERT INTO deals (name, stage, value, close_date, loss_reason, account_id, owner_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [name, stage, dealValue, closeDate, lossReason, accountId, adminId],
      );
      result.created++;
    } catch (err) {
      result.failed.push({
        row: rowNum,
        data: csvRow,
        reason: `Database error: ${(err as Error).message}`,
      });
    }

    if (onProgress && rowNum % PROGRESS_UPDATE_INTERVAL === 0) {
      await onProgress(rowNum, result.created, result.skipped, result.failed.length);
    }
  }

  return result;
}
