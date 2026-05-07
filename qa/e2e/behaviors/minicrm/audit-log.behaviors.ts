/**
 * Behaviors for the MiniCRM audit log page (MINCRM-201, MINCRM-344).
 *
 * Each behavior composes AuditLogPage interactions into named, intent-describing
 * async functions. No assertions inside behaviors — return typed result objects
 * instead.
 */

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
