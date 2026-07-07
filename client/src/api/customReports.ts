/**
 * Custom reports API module. (MINCRM-402)
 * Wraps CRUD and execution endpoints for saved custom reports.
 */

import apiClient from './axiosInstance.js';
import type {
  CustomReportResponse,
  CreateCustomReportBody,
  UpdateCustomReportInput,
  RunReportResponse,
  ReportConfig,
  ReportEntityType,
  ReportVisibility,
} from '@shared/schemas/customReportSchema.js';

export type { ReportVisibility };

/** React Query cache key for the list of all saved custom reports */
export const CUSTOM_REPORTS_QUERY_KEY = ['reports', 'custom'] as const;

/** Produces a scoped cache key for a single saved report */
export function customReportQueryKey(id: string): readonly [string, string, string] {
  return ['reports', 'custom', id] as const;
}

/** Produces a scoped cache key for a report's run result */
export function customReportRunQueryKey(id: string): readonly [string, string, string, string] {
  return ['reports', 'custom', id, 'run'] as const;
}

/** Response envelope for the list endpoint */
interface ListCustomReportsResponse {
  reports: CustomReportResponse[];
}

/**
 * Fetches all saved custom reports, ordered by name.
 */
export async function listCustomReports(): Promise<CustomReportResponse[]> {
  const response = await apiClient.get<ListCustomReportsResponse>('/reports/custom');
  return response.data.reports;
}

/**
 * Fetches a single saved custom report by ID.
 */
export async function getCustomReport(id: string): Promise<CustomReportResponse> {
  const response = await apiClient.get<CustomReportResponse>(`/reports/custom/${id}`);
  return response.data;
}

/**
 * Creates a new saved custom report.
 */
export async function createCustomReport(
  input: CreateCustomReportBody,
): Promise<CustomReportResponse> {
  const response = await apiClient.post<CustomReportResponse>('/reports/custom', input);
  return response.data;
}

/**
 * Updates a saved custom report.
 */
export async function updateCustomReport(
  id: string,
  input: UpdateCustomReportInput,
): Promise<CustomReportResponse> {
  const response = await apiClient.patch<CustomReportResponse>(`/reports/custom/${id}`, input);
  return response.data;
}

/**
 * Deletes a saved custom report.
 */
export async function deleteCustomReport(id: string): Promise<void> {
  await apiClient.delete(`/reports/custom/${id}`);
}

/**
 * Executes a saved custom report and returns the result rows.
 */
export async function runCustomReport(id: string): Promise<RunReportResponse> {
  const response = await apiClient.post<RunReportResponse>(`/reports/custom/${id}/run`);
  return response.data;
}

/**
 * Executes an unsaved (ad-hoc) report config and returns the result rows.
 */
export async function runAdHocReport(
  entityType: ReportEntityType,
  config: ReportConfig,
): Promise<RunReportResponse> {
  const response = await apiClient.post<RunReportResponse>('/reports/custom/run', {
    entity_type: entityType,
    config,
  });
  return response.data;
}

/**
 * Returns the URL for exporting a saved report as CSV.
 * Triggers a download when assigned to an anchor `href`.
 */
export function getCustomReportExportUrl(id: string): string {
  return `/api/v1/reports/custom/${id}/export`;
}

/**
 * Returns the URL for exporting a saved report as PDF. (MINCRM-601)
 * Triggers a download when assigned to an anchor `href`.
 */
export function getCustomReportExportPdfUrl(id: string): string {
  return `/api/v1/reports/custom/${id}/export.pdf`;
}
