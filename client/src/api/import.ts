/**
 * CSV import API module.
 * Two-step flow per entity: parse (preview) then run (import).
 * MINCRM-158 (contacts), MINCRM-159 (accounts), MINCRM-160 (deals)
 */

import apiClient from './axiosInstance.js';

/** A CRM field definition returned by the parse endpoint */
export interface CrmField {
  key: string;
  label: string;
  required: boolean;
}

/** Response from the /parse endpoint */
export interface ParseResponse {
  headers: string[];
  preview: Record<string, string>[];
  fields: CrmField[];
}

/** A single import failure row */
export interface ImportFailure {
  row: number;
  data: Record<string, string>;
  reason: string;
}

/** Response from the /run endpoint */
export interface ImportRunResponse {
  created: number;
  skipped: number;
  failedCount: number;
  failed: ImportFailure[];
  /** CSV string for the downloadable error report; empty when there are no failures */
  errorCsv: string;
}

export type ImportEntity = 'accounts' | 'contacts' | 'deals';

/**
 * Uploads a CSV file to the parse endpoint for the given entity.
 * Returns column headers, CRM field definitions, and a 5-row preview.
 *
 * @param entity - The CRM entity type being imported.
 * @param file - The CSV File selected by the user.
 */
export async function parseCsv(entity: ImportEntity, file: File): Promise<ParseResponse> {
  const formData = new FormData();
  formData.append('file', file);
  const response = await apiClient.post<ParseResponse>(`/admin/import/${entity}/parse`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
  return response.data;
}

/**
 * Uploads a CSV file together with a column mapping to run the import.
 * Returns the full import summary including any failures and an error CSV string.
 *
 * @param entity - The CRM entity type being imported.
 * @param file - The CSV File (same file as parsed in step 1).
 * @param mapping - Maps CRM field keys to CSV column headers.
 * @param options - Additional entity-specific flags (e.g. unassigned_ownership, skip_duplicates).
 */
export async function runImport(
  entity: ImportEntity,
  file: File,
  mapping: Record<string, string>,
  options: Record<string, boolean> = {},
): Promise<ImportRunResponse> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('mapping', JSON.stringify({ ...mapping, ...options }));
  const response = await apiClient.post<ImportRunResponse>(
    `/admin/import/${entity}/run`,
    formData,
    { headers: { 'Content-Type': 'multipart/form-data' } },
  );
  return response.data;
}
