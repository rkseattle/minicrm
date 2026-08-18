/**
 * Data hygiene assistant API module.
 * Wraps the hygiene queue read/action endpoints and admin config endpoints.
 */

import apiClient from './axiosInstance.js';
import type {
  DataHygieneFinding,
  DataHygieneEntityType,
  DataHygieneConfigResponse,
  SetDataHygieneConfigInput,
} from '@shared/schemas/dataHygieneSchema.js';

export function hygieneFindingsQueryKey(
  scope: 'mine' | 'all',
  entityType?: DataHygieneEntityType,
): readonly unknown[] {
  return ['data_hygiene_findings', scope, entityType ?? null] as const;
}

export const DATA_HYGIENE_CONFIG_QUERY_KEY = ['admin', 'ai', 'data-hygiene-config'] as const;

export async function listHygieneFindings(
  scope: 'mine' | 'all',
  entityType?: DataHygieneEntityType,
): Promise<{ findings: DataHygieneFinding[]; total: number }> {
  const response = await apiClient.get<{ findings: DataHygieneFinding[]; total: number }>(
    '/data-hygiene/findings',
    { params: { scope, entity_type: entityType } },
  );
  return response.data;
}

export async function dismissHygieneFinding(findingId: string, reason: string): Promise<void> {
  await apiClient.post(`/data-hygiene/findings/${findingId}/dismiss`, { reason });
}

export async function clearHygieneFindingsForEntity(
  entityType: DataHygieneEntityType,
  entityId: string,
): Promise<void> {
  await apiClient.post(`/data-hygiene/findings/clear/${entityType}/${entityId}`);
}

export async function mergeDuplicateContactFindings(
  winnerId: string,
  loserId: string,
): Promise<void> {
  await apiClient.post('/data-hygiene/findings/merge-contacts', { winnerId, loserId });
}

export async function getDataHygieneConfig(): Promise<DataHygieneConfigResponse> {
  const response = await apiClient.get<DataHygieneConfigResponse>('/admin/ai/data-hygiene-config');
  return response.data;
}

export async function setDataHygieneConfig(
  patch: SetDataHygieneConfigInput,
): Promise<DataHygieneConfigResponse> {
  const response = await apiClient.patch<DataHygieneConfigResponse>(
    '/admin/ai/data-hygiene-config',
    patch,
  );
  return response.data;
}

export async function triggerManualHygieneScan(): Promise<{
  accepted: boolean;
  message: string;
}> {
  const response = await apiClient.post<{ accepted: boolean; message: string }>(
    '/admin/ai/data-hygiene/run',
  );
  return response.data;
}
