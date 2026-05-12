/**
 * Behaviors for the MiniCRM audit log page (MINCRM-201, MINCRM-344).
 *
 * Each behavior composes AuditLogPage interactions into named, intent-describing
 * async functions. No assertions inside behaviors — return typed result objects
 * instead.
 */

import type { RestClient } from '@framework/clients/rest-client.js';
import { AuditLogPage } from '@pages/minicrm/AuditLogPage.js';
import type { PageFacade } from '@framework/fixtures/index.js';

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

export interface AuditLogBehaviorContext {
  page: PageFacade;
}

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface FilterAuditLogResult {
  /** The record type that was filtered on. */
  recordType: string;
}

// ---------------------------------------------------------------------------
// Behaviors
// ---------------------------------------------------------------------------

/**
 * Filters the audit log by a specific record type and applies the filter.
 * Expands the filter panel first if it is collapsed (mobile starts collapsed).
 *
 * @param recordType - Record type to filter on (e.g. 'contact', 'account', 'deal').
 * @param context    - Playwright fixture context.
 */
export async function filterAuditLog(
  recordType: string,
  context: AuditLogBehaviorContext,
): Promise<FilterAuditLogResult> {
  const auditLogPage = new AuditLogPage(context);
  await auditLogPage.expandFilters();
  await auditLogPage.selectFilterRecordType(recordType);
  await auditLogPage.applyFilters();
  return { recordType };
}

// ---------------------------------------------------------------------------
// API data-fetch helpers (MINCRM-357)
// ---------------------------------------------------------------------------

/** Shape of a single audit log entry. */
export interface AuditLogEntry {
  id: string;
  record_type: string;
  record_id: string | null;
  record_name: string | null;
  event_type: string;
  field_name: string | null;
  old_value: string | null;
  new_value: string | null;
  changed_by_id: string | null;
  changed_by_name: string | null;
  created_at: string;
}

/**
 * Fetches audit log entries, optionally filtered by record type and/or record ID.
 *
 * @param restClient - Authenticated RestClient.
 * @param options - Optional filters.
 * @returns Object with entries array and total count.
 */
export async function getAuditLog(
  restClient: RestClient,
  options: { recordType?: string; recordId?: string } = {},
): Promise<{ entries: AuditLogEntry[]; total: number }> {
  const params = new URLSearchParams();
  if (options.recordType) params.set('recordType', options.recordType);
  if (options.recordId) params.set('recordId', options.recordId);
  const query = params.toString() ? `?${params.toString()}` : '';
  const res = await restClient.get<{ data: AuditLogEntry[]; total: number }>(
    `/api/v1/audit-log${query}`,
  );
  return { entries: res.body.data, total: res.body.total };
}
