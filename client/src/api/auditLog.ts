/**
 * Audit log API module.
 * Wraps the audit log REST endpoints.
 *
 * Note: The paginated system-wide list (listAuditLog) has since been removed.
 * AuditLogPage now fetches via ConnectRPC (gRPC-Web) instead.
 */

import apiClient from './axiosInstance.js';
import type { AuditLogEntry } from '@shared/schemas/auditSchema.js';

/** React Query key for per-record audit log */
export const RECORD_AUDIT_LOG_QUERY_KEY = (recordType: string, recordId: string) =>
  ['audit-log', 'record', recordType, recordId] as const;

/** React Query key for audit log actors */
export const AUDIT_LOG_ACTORS_QUERY_KEY = ['audit-log', 'actors'] as const;

/** Response shape for the per-record audit log endpoint */
export interface RecordAuditLogResponse {
  entries: AuditLogEntry[];
}

/**
 * Returns audit log entries for a single record.
 * Used by the Change History section on Contact, Account, and Deal detail pages.
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
 * Returns distinct users who appear in the audit log.
 * Used for the user filter dropdown on the admin audit log page.
 */
export async function listAuditLogActors(): Promise<{ actors: { id: string; name: string }[] }> {
  const response = await apiClient.get<{ actors: { id: string; name: string }[] }>(
    '/audit-log/actors',
  );
  return response.data;
}
