/**
 * Teams API module — wraps the team management endpoints.
 */

import apiClient from './axiosInstance.js';
import type {
  TeamResponse,
  TeamMemberResponse,
  CreateTeamInput,
  UpdateTeamInput,
  AddTeamMemberInput,
} from '@shared/schemas/teamSchema.js';

export type { TeamResponse, TeamMemberResponse };

/** React Query cache key for the teams list. */
export const TEAMS_QUERY_KEY = ['teams'] as const;

/** React Query cache key factory for a single team. */
export const teamQueryKey = (id: string) => ['teams', id] as const;

/** React Query cache key factory for a team's member list. */
export const teamMembersQueryKey = (id: string) => ['teams', id, 'members'] as const;

/** GET /api/v1/teams */
export async function listTeams(): Promise<TeamResponse[]> {
  const response = await apiClient.get<{ teams: TeamResponse[] }>('/teams');
  return response.data.teams;
}

/** GET /api/v1/teams/:id */
export async function getTeam(id: string): Promise<TeamResponse> {
  const response = await apiClient.get<{ team: TeamResponse }>(`/teams/${id}`);
  return response.data.team;
}

/** POST /api/v1/teams */
export async function createTeam(input: CreateTeamInput): Promise<TeamResponse> {
  const response = await apiClient.post<{ team: TeamResponse }>('/teams', input);
  return response.data.team;
}

/** PUT /api/v1/teams/:id */
export async function updateTeam(id: string, input: UpdateTeamInput): Promise<TeamResponse> {
  const response = await apiClient.put<{ team: TeamResponse }>(`/teams/${id}`, input);
  return response.data.team;
}

/** DELETE /api/v1/teams/:id */
export async function deleteTeam(id: string): Promise<void> {
  await apiClient.delete(`/teams/${id}`);
}

/** GET /api/v1/teams/:id/members */
export async function listTeamMembers(teamId: string): Promise<TeamMemberResponse[]> {
  const response = await apiClient.get<{ members: TeamMemberResponse[] }>(
    `/teams/${teamId}/members`,
  );
  return response.data.members;
}

/** POST /api/v1/teams/:id/members */
export async function addTeamMember(
  teamId: string,
  input: AddTeamMemberInput,
): Promise<TeamMemberResponse> {
  const response = await apiClient.post<{ member: TeamMemberResponse }>(
    `/teams/${teamId}/members`,
    input,
  );
  return response.data.member;
}

/** DELETE /api/v1/teams/:id/members/:userId */
export async function removeTeamMember(teamId: string, userId: string): Promise<void> {
  await apiClient.delete(`/teams/${teamId}/members/${userId}`);
}
