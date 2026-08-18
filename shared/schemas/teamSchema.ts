/**
 * Shared Zod schemas and TypeScript types for the teams feature.
 * Used by both client and server.
 */

import { z } from 'zod';

/** Roles a user can hold within a team */
export const TEAM_MEMBER_ROLES = ['lead', 'member'] as const;
export type TeamMemberRole = (typeof TEAM_MEMBER_ROLES)[number];

export const createTeamSchema = z.object({
  name: z.string({ required_error: 'Name is required' }).min(1, 'Name is required').trim(),
  manager_id: z.string().uuid('manager_id must be a valid UUID').optional().nullable(),
  parent_team_id: z.string().uuid('parent_team_id must be a valid UUID').optional().nullable(),
});

export const updateTeamSchema = z.object({
  name: z.string().min(1, 'Name must not be empty').trim().optional(),
  manager_id: z.string().uuid('manager_id must be a valid UUID').optional().nullable(),
  parent_team_id: z.string().uuid('parent_team_id must be a valid UUID').optional().nullable(),
});

export const addTeamMemberSchema = z.object({
  user_id: z.string({ required_error: 'user_id is required' }).uuid('user_id must be a valid UUID'),
  role: z.enum(TEAM_MEMBER_ROLES, {
    required_error: 'Role is required',
    invalid_type_error: 'Role must be one of: lead, member',
  }),
});

export type CreateTeamInput = z.infer<typeof createTeamSchema>;
export type UpdateTeamInput = z.infer<typeof updateTeamSchema>;
export type AddTeamMemberInput = z.infer<typeof addTeamMemberSchema>;

/** Team row as returned to API consumers */
export interface TeamResponse {
  id: string;
  name: string;
  manager_id: string | null;
  manager_name: string | null;
  parent_team_id: string | null;
  member_count: number;
  created_at: string;
  updated_at: string;
}

/** Team membership row as returned to API consumers */
export interface TeamMemberResponse {
  team_id: string;
  user_id: string;
  user_name: string;
  user_email: string;
  role: TeamMemberRole;
}
