/**
 * Champion/blocker detection API module.
 * Wraps the contact classification and deal stakeholder-map endpoints.
 * Requires authentication and the ai_champion_blocker_detection feature flag.
 */

import apiClient from './axiosInstance.js';
import type {
  ChampionBlockerStatus,
  ContactChampionBlockerResponse,
  StakeholderMapResponse,
} from '@shared/schemas/championBlockerSchema.js';

export function contactChampionBlockerQueryKey(
  contactId: string,
): readonly [string, string, string] {
  return ['contacts', contactId, 'championBlocker'] as const;
}

export function dealStakeholderMapQueryKey(dealId: string): readonly [string, string, string] {
  return ['deals', dealId, 'stakeholderMap'] as const;
}

export async function getContactChampionBlocker(
  contactId: string,
): Promise<ContactChampionBlockerResponse> {
  const response = await apiClient.get<ContactChampionBlockerResponse>(
    `/contacts/${contactId}/champion-blocker`,
  );
  return response.data;
}

export async function dismissContactChampionBlocker(
  contactId: string,
): Promise<ContactChampionBlockerResponse> {
  const response = await apiClient.post<ContactChampionBlockerResponse>(
    `/contacts/${contactId}/champion-blocker/dismiss`,
  );
  return response.data;
}

export async function overrideContactChampionBlocker(
  contactId: string,
  status: ChampionBlockerStatus,
  reason?: string,
): Promise<ContactChampionBlockerResponse> {
  const response = await apiClient.patch<ContactChampionBlockerResponse>(
    `/contacts/${contactId}/champion-blocker/override`,
    { status, reason },
  );
  return response.data;
}

export async function getDealStakeholderMap(dealId: string): Promise<StakeholderMapResponse> {
  const response = await apiClient.get<StakeholderMapResponse>(`/deals/${dealId}/stakeholder-map`);
  return response.data;
}
