/**
 * CSV import API module.
 * Two-step flow per entity: parse (preview) then run (import).
 * Run now returns a job_id immediately; poll getImportJob for progress.
 * contacts, accounts, deals
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

export type ImportJobStatus = 'pending' | 'running' | 'complete' | 'failed';

/** Response from GET /api/admin/import/jobs/:job_id */
export interface ImportJobResponse {
  job_id: string;
  type: string;
  status: ImportJobStatus;
  total_rows: number | null;
  processed_rows: number;
  created: number;
  skipped: number;
  failed: number;
  error_csv: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}

/** Response from POST /api/admin/import/:entity/run (202) */
export interface StartImportResponse {
  job_id: string;
  status: 'pending';
}

export type ImportEntity = 'accounts' | 'contacts' | 'deals';

export const IMPORT_JOB_QUERY_KEY = ['import-job'] as const;

/**
 * Uploads a CSV file to the parse endpoint for the given entity.
 * Returns column headers, CRM field definitions, and a 5-row preview.
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
 * Uploads a CSV file together with a column mapping to start the background import.
 * Returns immediately with a job_id — the actual import runs in the background.
 * Poll getImportJob() for progress.
 */
export async function startImport(
  entity: ImportEntity,
  file: File,
  mapping: Record<string, string>,
  options: Record<string, boolean> = {},
): Promise<StartImportResponse> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('mapping', JSON.stringify({ ...mapping, ...options }));
  const response = await apiClient.post<StartImportResponse>(
    `/admin/import/${entity}/run`,
    formData,
    { headers: { 'Content-Type': 'multipart/form-data' } },
  );
  return response.data;
}

/**
 * Fetches the current status of a background import job.
 */
export async function getImportJob(jobId: string): Promise<ImportJobResponse> {
  const response = await apiClient.get<ImportJobResponse>(`/admin/import/jobs/${jobId}`);
  return response.data;
}
