/**
 * Audit log API module.
 * Wraps the audit log endpoints. (MINCRM-170, MINCRM-171, MINCRM-172)
 */

import apiClient from './axiosInstance.js';
import type { AuditLogEntry } from '@shared/schemas/auditSchema.js';
import type { PaginatedResponse } from '@shared/schemas/paginationSchema.js';

/** React Query key for per-record audit log */
export const RECORD_AUDIT_LOG_QUERY_KEY = (recordType: string, recordId: string) =>
  ['audit-log', 'record', recordType, recordId] as const;

/** React Query key for the admin audit log list */
export const AUDIT_LOG_LIST_QUERY_KEY = 'audit-log-list';

/** React Query key for audit log actors */
export const AUDIT_LOG_ACTORS_QUERY_KEY = ['audit-log', 'actors'] as const;

/** Filter parameters for the system-wide audit log */
export interface AuditLogFilters {
  from?: string;
  to?: string;
  userId?: string;
  recordType?: string;
  eventType?: string;
  page?: number;
  limit?: number;
}

/** Response shape for the per-record audit log endpoint */
export interface RecordAuditLogResponse {
  entries: AuditLogEntry[];
}

/**
 * Returns audit log entries for a single record.
 * Used by the Change History section on Contact, Account, and Deal detail pages.
 * (MINCRM-171)
 *
 * @param recordType - Type of the record (contact, account, deal)
 * @param recordId - UUID of the record
 * @param all - When true, returns all history (default: 20 most recent)
 */
export async function getRecordAuditLog(
  recordType: string,
  recordId: string,
  all = false,
): Promise<RecordAuditLogResponse> {
  const params: Record<string, string> = { record_type: recordType, record_id: recordId };
  if (all) params.all = 'true';
  const response = await apiClient.get<RecordAuditLogResponse>('/audit-log/record', { params });
  return response.data;
}

/**
 * Returns paginated, filtered audit log entries for the admin view. (MINCRM-172)
 *
 * @param filters - Optional filters (date range, user, record type, event type, pagination)
 */
export async function listAuditLog(
  filters: AuditLogFilters = {},
): Promise<PaginatedResponse<AuditLogEntry>> {
  const params: Record<string, string> = {};
  if (filters.from) params.from = filters.from;
  if (filters.to) params.to = filters.to;
  if (filters.userId) params.userId = filters.userId;
  if (filters.recordType) params.recordType = filters.recordType;
  if (filters.eventType) params.eventType = filters.eventType;
  if (filters.page !== undefined) params.page = String(filters.page);
  if (filters.limit !== undefined) params.limit = String(filters.limit);

  const response = await apiClient.get<PaginatedResponse<AuditLogEntry>>('/audit-log', {
    params: Object.keys(params).length > 0 ? params : undefined,
  });
  return response.data;
}

/**
 * Returns distinct users who appear in the audit log.
 * Used for the user filter dropdown on the admin audit log page. (MINCRM-172)
 */
export async function listAuditLogActors(): Promise<{ actors: { id: string; name: string }[] }> {
  const response = await apiClient.get<{ actors: { id: string; name: string }[] }>(
    '/audit-log/actors',
  );
  return response.data;
}
