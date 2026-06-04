/**
 * Behaviors for the MiniCRM audit log page (MINCRM-201, MINCRM-344).
 *
 * Each behavior composes AuditLogPage interactions into named, intent-describing
 * async functions. No assertions inside behaviors — return typed result objects
 * instead.
 */

import type { RestClient } from '@framework/clients/rest-client.js';
import type { GrpcClient } from '@framework/clients/grpc-client.js';
import { AuditLogPage } from '@pages/minicrm/AuditLogPage.js';
import type { PageFacade } from '@framework/fixtures/index.js';
import { listAuditEvents } from '@apps/minicrm/grpc/auditGrpcClient.js';
import { getDevJwt } from '@behaviors/minicrm/auth.behaviors.js';

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
 * Fetches audit log entries via gRPC (ConnectRPC), optionally filtered by
 * record type and/or record ID. REST endpoint was removed in MINCRM-377.
 *
 * @param restClient - Authenticated RestClient (used to obtain a dev JWT).
 * @param grpcClient - Framework GrpcClient instance.
 * @param options - Optional filters.
 * @returns Object with entries array and total count.
 */
export async function getAuditLog(
  restClient: RestClient,
  grpcClient: GrpcClient,
  options: { recordType?: string; recordId?: string } = {},
): Promise<{ entries: AuditLogEntry[]; total: number }> {
  const jwt = await getDevJwt(restClient);
  const result = await listAuditEvents(
    grpcClient,
    {
      record_type: options.recordType,
      record_id: options.recordId,
      limit: 100,
    },
    jwt,
  );
  const entries: AuditLogEntry[] = result.events.map((e) => ({
    id: e.id,
    record_type: e.record_type,
    record_id: e.record_id || null,
    record_name: null,
    event_type: e.action,
    field_name: e.field_name || null,
    old_value: e.old_value || null,
    new_value: e.new_value || null,
    changed_by_id: null,
    changed_by_name: e.changed_by || null,
    created_at: e.changed_at,
  }));
  return { entries, total: result.total };
}

// ---------------------------------------------------------------------------
// Locator-accessor behaviors — wrap AuditLogPage locators
// so spec files never import @pages/* directly. (MINCRM-367)
// ---------------------------------------------------------------------------

/**
 * Navigates to the audit log page.
 */
export async function navigateToAuditLog(context: AuditLogBehaviorContext): Promise<void> {
  const auditLogPage = new AuditLogPage(context);
  await auditLogPage.navigate();
}

/**
 * Returns a resolved locator for the audit log page heading.
 */
export async function getAuditLogHeadingLocator(context: AuditLogBehaviorContext) {
  const auditLogPage = new AuditLogPage(context);
  return auditLogPage.headingLocator();
}

/**
 * Returns a resolved locator for the audit log entry list.
 */
export async function getAuditLogListLocator(context: AuditLogBehaviorContext) {
  const auditLogPage = new AuditLogPage(context);
  return auditLogPage.listLocator();
}

/**
 * Returns a resolved locator for the audit log pagination navigation.
 */
export async function getAuditLogPaginationLocator(context: AuditLogBehaviorContext) {
  const auditLogPage = new AuditLogPage(context);
  return auditLogPage.paginationLocator();
}

/**
 * Returns a resolved locator for the "previous page" button in audit log pagination.
 */
export async function getAuditLogPaginationPrevLocator(context: AuditLogBehaviorContext) {
  const auditLogPage = new AuditLogPage(context);
  return auditLogPage.paginationPrevLocator();
}

/**
 * Collapses the audit log filter panel (mobile starts expanded by default).
 */
export async function collapseAuditLogFilters(context: AuditLogBehaviorContext): Promise<void> {
  const auditLogPage = new AuditLogPage(context);
  await auditLogPage.collapseFilters();
}

// ---------------------------------------------------------------------------
// Locator helpers — keep page.locate() out of spec files. (MINCRM-418)
// ---------------------------------------------------------------------------

/**
 * Returns a resolved locator for an audit log row expand button by entry ID.
 * eslint-disable-next-line local/require-locator-fallback -- dynamic UUID-keyed row button has no stable role fallback
 */
export async function getAuditLogRowButtonLocator(
  entryId: string,
  context: AuditLogBehaviorContext,
) {
  // eslint-disable-next-line local/require-locator-fallback -- dynamic UUID-keyed row button has no stable role fallback
  return context.page
    .locate([{ type: 'testId', value: `audit-log-row-button-${entryId}` }])
    .resolve();
}

/**
 * Returns a resolved locator for an audit log detail panel by entry ID.
 * eslint-disable-next-line local/require-locator-fallback -- dynamic UUID-keyed detail panel has no stable role fallback
 */
export async function getAuditLogDetailPanelLocator(
  entryId: string,
  context: AuditLogBehaviorContext,
) {
  // eslint-disable-next-line local/require-locator-fallback -- dynamic UUID-keyed detail panel has no stable role fallback
  return context.page.locate([{ type: 'testId', value: `audit-log-detail-${entryId}` }]).resolve();
}
