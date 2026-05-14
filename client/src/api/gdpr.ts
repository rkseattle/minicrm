/**
 * GDPR API module.
 * Wraps the GDPR erasure, export, and status endpoints. (MINCRM-364)
 */

import apiClient from './axiosInstance.js';

/** Shape of a GDPR deletion log row returned from the API */
export interface GdprDeletionLogEntry {
  id: string;
  record_type: string;
  record_id: string;
  requested_by: string;
  requested_at: string;
  completed_at: string | null;
  erasure_scope: string[];
  notes: string | null;
}

/** Response from a successful erasure */
export interface GdprEraseResponse {
  success: boolean;
  erasedAt: string | null;
}

/** Query key for GDPR status per record */
export const gdprStatusQueryKey = (recordType: string, recordId: string) =>
  ['gdpr-status', recordType, recordId] as const;

/**
 * Returns the GDPR deletion log entry for a record, or null if the record
 * has not been erased. Admin only.
 *
 * @param recordType - 'contact' or 'lead'
 * @param recordId - UUID of the record
 */
export async function getGdprStatus(
  recordType: string,
  recordId: string,
): Promise<GdprDeletionLogEntry | null> {
  const response = await apiClient.get<{ status: GdprDeletionLogEntry | null }>(
    `/gdpr/status/${recordType}/${recordId}`,
  );
  return response.data.status;
}

/**
 * Erases personal data for a contact under GDPR Art. 17. Admin only.
 *
 * @param contactId - UUID of the contact
 * @param notes - Optional reference note (e.g. ticket or request method)
 */
export async function eraseContactGdpr(
  contactId: string,
  notes?: string,
): Promise<GdprEraseResponse> {
  const response = await apiClient.post<GdprEraseResponse>(`/contacts/${contactId}/gdpr-erase`, {
    notes,
  });
  return response.data;
}

/**
 * Erases personal data for a lead under GDPR Art. 17. Admin only.
 *
 * @param leadId - UUID of the lead
 * @param notes - Optional reference note
 */
export async function eraseLeadGdpr(leadId: string, notes?: string): Promise<GdprEraseResponse> {
  const response = await apiClient.post<GdprEraseResponse>(`/leads/${leadId}/gdpr-erase`, {
    notes,
  });
  return response.data;
}

/**
 * Triggers download of a full GDPR subject-access JSON export for a contact.
 * Admin only.
 *
 * @param contactId - UUID of the contact
 */
export async function downloadContactGdprExport(contactId: string): Promise<void> {
  const response = await apiClient.get<Blob>(`/contacts/${contactId}/gdpr-export`, {
    responseType: 'blob',
  });
  const url = window.URL.createObjectURL(response.data);
  const a = document.createElement('a');
  a.href = url;
  a.download = `gdpr-export-contact-${contactId}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(url);
}

/**
 * Triggers download of a full GDPR subject-access JSON export for a lead.
 * Admin only.
 *
 * @param leadId - UUID of the lead
 */
export async function downloadLeadGdprExport(leadId: string): Promise<void> {
  const response = await apiClient.get<Blob>(`/leads/${leadId}/gdpr-export`, {
    responseType: 'blob',
  });
  const url = window.URL.createObjectURL(response.data);
  const a = document.createElement('a');
  a.href = url;
  a.download = `gdpr-export-lead-${leadId}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(url);
}
