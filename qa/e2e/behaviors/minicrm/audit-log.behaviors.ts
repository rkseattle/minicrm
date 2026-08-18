/**
 * Behaviors for the MiniCRM audit log page.
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
// API data-fetch helpers
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
 * record type and/or record ID. REST endpoint was since removed.
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
// so spec files never import @pages/* directly.
// ---------------------------------------------------------------------------

/**
 * Navigates to the audit log page.
 */
export async function navigateToAuditLog(context: AuditLogBehaviorContext): Promise<void> {
  const auditLogPage = new AuditLogPage(context);
  await auditLogPage.navigate();
}

/** Asserts the audit log page heading is visible. */
export async function expectAuditLogHeadingVisible(
  context: AuditLogBehaviorContext,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const locator = new AuditLogPage(context).headingLocator();
  await expect(await locator).toBeVisible();
}

/** Asserts the audit log entry list is visible, with an optional timeout (ms). */
export async function expectAuditLogListVisible(
  context: AuditLogBehaviorContext,
  timeout?: number,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const locator = new AuditLogPage(context).listLocator(timeout);
  await expect(await locator).toBeVisible(timeout !== undefined ? { timeout } : undefined);
}

/** Asserts the audit log pagination bar is visible, with an optional timeout (ms). */
export async function expectAuditLogPaginationVisible(
  context: AuditLogBehaviorContext,
  timeout?: number,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const locator = new AuditLogPage(context).paginationLocator(timeout);
  await expect(await locator).toBeVisible(timeout !== undefined ? { timeout } : undefined);
}

/** Asserts the "previous page" pagination button is disabled. */
export async function expectAuditLogPaginationPrevDisabled(
  context: AuditLogBehaviorContext,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  const locator = new AuditLogPage(context).paginationPrevLocator();
  await expect(await locator).toBeDisabled();
}

/**
 * Collapses the audit log filter panel (mobile starts expanded by default).
 */
export async function collapseAuditLogFilters(context: AuditLogBehaviorContext): Promise<void> {
  const auditLogPage = new AuditLogPage(context);
  await auditLogPage.collapseFilters();
}

// ---------------------------------------------------------------------------
// Locator helpers — keep page.locate() out of spec files.
// ---------------------------------------------------------------------------

/**
 * Returns true when the expand button for the given entry ID is visible on screen.
 * Used to guard against rows that are off-page (past pagination).
 */
export async function isAuditLogRowButtonVisible(
  entryId: string,
  context: AuditLogBehaviorContext,
): Promise<boolean> {
  // eslint-disable-next-line local/require-locator-fallback -- dynamic UUID-keyed row button has no stable role fallback
  const locator = await context.page
    .locate([{ type: 'testId', value: `audit-log-row-button-${entryId}` }])
    .resolve();
  return locator.isVisible().catch(() => false);
}

/** Clicks the expand button for the given audit log entry by ID. */
export async function clickAuditLogRowButton(
  entryId: string,
  context: AuditLogBehaviorContext,
): Promise<void> {
  // eslint-disable-next-line local/require-locator-fallback -- dynamic UUID-keyed row button has no stable role fallback
  const locator = await context.page
    .locate([{ type: 'testId', value: `audit-log-row-button-${entryId}` }])
    .resolve();
  await locator.click();
}

/** Asserts the detail panel for the given audit log entry is visible, with an optional timeout (ms). */
export async function expectAuditLogDetailPanelVisible(
  entryId: string,
  context: AuditLogBehaviorContext,
  timeout?: number,
): Promise<void> {
  const { expect } = await import('@playwright/test');
  // eslint-disable-next-line local/require-locator-fallback -- dynamic UUID-keyed detail panel has no stable role fallback
  const locator = await context.page
    .locate([{ type: 'testId', value: `audit-log-detail-${entryId}` }])
    .resolve();
  await expect(locator).toBeVisible(timeout !== undefined ? { timeout } : undefined);
}
