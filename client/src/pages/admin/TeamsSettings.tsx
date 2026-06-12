/**
 * TeamsSettings — Team management panel for MINCRM-539.
 * Requires teams:manage capability (admin or any custom role with that capability).
 *
 * Features:
 * - List all teams in hierarchical tree order with member count and manager
 * - Create a new team via an inline form
 * - Edit an existing team's name, manager, and parent
 * - Delete a team (blocked when it has child teams — shows inline error)
 * - Expand a team row to view its members and add/remove members
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  listTeams,
  createTeam,
  updateTeam,
  deleteTeam,
  listTeamMembers,
  addTeamMember,
  removeTeamMember,
  TEAMS_QUERY_KEY,
  teamMembersQueryKey,
  type TeamResponse,
  type TeamMemberResponse,
} from '@/api/teams.js';
import { listActiveUsers, ACTIVE_USERS_QUERY_KEY, type ActiveUser } from '@/api/users.js';
import { TEAM_MEMBER_ROLES } from '@shared/schemas/teamSchema.js';
import type { TeamMemberRole } from '@shared/schemas/teamSchema.js';
import { Button } from '@/components/ui/Button.js';

// ── Tree utilities ──────────────────────────────────────────────────────────────

interface TreeNode {
  team: TeamResponse;
  depth: number;
}

/**
 * Converts a flat list of teams into a depth-first ordered list with depth
 * annotations so the UI can render indentation without a recursive component tree.
 */
function buildTreeNodes(teams: TeamResponse[]): TreeNode[] {
  const byParent = new Map<string | null, TeamResponse[]>();
  for (const team of teams) {
    const key = team.parent_team_id ?? null;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push(team);
  }

  const result: TreeNode[] = [];

  function walk(parentId: string | null, depth: number) {
    const children = byParent.get(parentId) ?? [];
    for (const team of children) {
      result.push({ team, depth });
      walk(team.id, depth + 1);
    }
  }

  walk(null, 0);
  return result;
}

// ── Sub-components ──────────────────────────────────────────────────────────────

interface TeamFormProps {
  initial?: TeamResponse;
  teams: TeamResponse[];
  users: ActiveUser[];
  onSave: (data: {
    name: string;
    manager_id: string | null;
    parent_team_id: string | null;
  }) => void;
  onCancel: () => void;
  isPending: boolean;
  formError?: string | null;
}

function TeamForm({
  initial,
  teams,
  users,
  onSave,
  onCancel,
  isPending,
  formError,
}: TeamFormProps) {
  const { t } = useTranslation();
  const [name, setName] = useState(initial?.name ?? '');
  const [managerId, setManagerId] = useState<string>(initial?.manager_id ?? '');
  const [parentTeamId, setParentTeamId] = useState<string>(initial?.parent_team_id ?? '');
  const [nameError, setNameError] = useState('');

  const eligibleParents = teams.filter((t) => t.id !== initial?.id);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setNameError(t('teamsSettings.form.nameRequired'));
      return;
    }
    setNameError('');
    onSave({
      name: name.trim(),
      manager_id: managerId || null,
      parent_team_id: parentTeamId || null,
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" data-testid="team-form">
      <div>
        <label htmlFor="team-name" className="block text-sm font-medium text-gray-700 mb-1">
          {t('teamsSettings.form.nameLabel')}
        </label>
        <input
          id="team-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={200}
          disabled={isPending}
          data-testid="team-form-name"
          className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-indigo-500 disabled:bg-gray-50"
        />
        {nameError && (
          <p className="mt-1 text-xs text-red-600" role="alert" data-testid="team-form-name-error">
            {nameError}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="team-manager" className="block text-sm font-medium text-gray-700 mb-1">
          {t('teamsSettings.form.managerLabel')}
        </label>
        <select
          id="team-manager"
          value={managerId}
          onChange={(e) => setManagerId(e.target.value)}
          disabled={isPending}
          data-testid="team-form-manager"
          className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-indigo-500 disabled:bg-gray-50"
        >
          <option value="">{t('teamsSettings.form.managerPlaceholder')}</option>
          {users.map((user) => (
            <option key={user.id} value={user.id}>
              {user.name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="team-parent" className="block text-sm font-medium text-gray-700 mb-1">
          {t('teamsSettings.form.parentLabel')}
        </label>
        <select
          id="team-parent"
          value={parentTeamId}
          onChange={(e) => setParentTeamId(e.target.value)}
          disabled={isPending}
          data-testid="team-form-parent"
          className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:ring-indigo-500 disabled:bg-gray-50"
        >
          <option value="">{t('teamsSettings.form.parentPlaceholder')}</option>
          {eligibleParents.map((team) => (
            <option key={team.id} value={team.id}>
              {team.name}
            </option>
          ))}
        </select>
      </div>

      {formError && (
        <p className="text-sm text-red-600" role="alert" data-testid="team-form-error">
          {formError}
        </p>
      )}

      <div className="flex gap-3 pt-2">
        <Button type="submit" disabled={isPending} data-testid="team-form-submit">
          {isPending ? t('teamsSettings.form.saving') : t('teamsSettings.form.saveButton')}
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={onCancel}
          disabled={isPending}
          data-testid="team-form-cancel"
        >
          {t('teamsSettings.form.cancelButton')}
        </Button>
      </div>
    </form>
  );
}

// ── MemberList ──────────────────────────────────────────────────────────────────

interface MemberListProps {
  teamId: string;
  users: ActiveUser[];
}

function MemberList({ teamId, users }: MemberListProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [addingMember, setAddingMember] = useState(false);
  const [newUserId, setNewUserId] = useState('');
  const [newRole, setNewRole] = useState<TeamMemberRole>('member');
  const [addError, setAddError] = useState<string | null>(null);

  const {
    data: members,
    isLoading,
    isError,
  } = useQuery({
    queryKey: teamMembersQueryKey(teamId),
    queryFn: () => listTeamMembers(teamId),
  });

  const addMutation = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: TeamMemberRole }) =>
      addTeamMember(teamId, { user_id: userId, role }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: teamMembersQueryKey(teamId) });
      void queryClient.invalidateQueries({ queryKey: TEAMS_QUERY_KEY });
      setAddingMember(false);
      setNewUserId('');
      setNewRole('member');
      setAddError(null);
    },
    onError: (err: unknown) => {
      const code = (err as { response?: { data?: { error?: { code?: string } } } })?.response?.data
        ?.error?.code;
      if (code === 'TEAM_MEMBER_ALREADY_EXISTS') {
        setAddError(t('teamsSettings.members.alreadyMember'));
      } else {
        setAddError(t('teamsSettings.members.addError'));
      }
    },
  });

  const removeMutation = useMutation({
    mutationFn: (userId: string) => removeTeamMember(teamId, userId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: teamMembersQueryKey(teamId) });
      void queryClient.invalidateQueries({ queryKey: TEAMS_QUERY_KEY });
    },
  });

  const memberUserIds = new Set(members?.map((m) => m.user_id) ?? []);
  const availableUsers = users.filter((u) => !memberUserIds.has(u.id));

  if (isLoading) {
    return (
      <p className="text-xs text-gray-400 py-2" data-testid={`team-members-loading-${teamId}`}>
        {t('teamsSettings.loading')}
      </p>
    );
  }

  if (isError) {
    return (
      <p
        className="text-xs text-red-600 py-2"
        role="alert"
        data-testid={`team-members-error-${teamId}`}
      >
        {t('teamsSettings.loadError')}
      </p>
    );
  }

  function handleAddSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!newUserId) return;
    addMutation.mutate({ userId: newUserId, role: newRole });
  }

  return (
    <div
      className="mt-3 border-t border-gray-100 pt-3"
      data-testid={`team-members-section-${teamId}`}
    >
      <p className="text-xs font-medium text-gray-600 mb-2">
        {t('teamsSettings.members.sectionTitle')}
      </p>

      {members && members.length === 0 && !addingMember && (
        <p className="text-xs text-gray-400 mb-2" data-testid={`team-members-empty-${teamId}`}>
          {t('teamsSettings.members.noMembers')}
        </p>
      )}

      {members && members.length > 0 && (
        <ul className="space-y-1 mb-2" data-testid={`team-members-list-${teamId}`}>
          {members.map((member: TeamMemberResponse) => (
            <li
              key={member.user_id}
              className="flex items-center justify-between text-xs"
              data-testid={`team-member-row-${member.user_id}`}
            >
              <span className="text-gray-700">
                {member.user_name}
                <span className="ms-1.5 text-gray-400">
                  {member.role === 'lead'
                    ? t('teamsSettings.members.roleLead')
                    : t('teamsSettings.members.roleMember')}
                </span>
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => removeMutation.mutate(member.user_id)}
                disabled={removeMutation.isPending}
                data-testid={`team-member-remove-${member.user_id}`}
              >
                {t('teamsSettings.members.removeButton')}
              </Button>
            </li>
          ))}
        </ul>
      )}

      {removeMutation.isError && (
        <p className="text-xs text-red-600 mb-2" role="alert">
          {t('teamsSettings.members.removeError')}
        </p>
      )}

      {addingMember ? (
        <form
          onSubmit={handleAddSubmit}
          className="flex items-end gap-2 flex-wrap"
          data-testid={`team-add-member-form-${teamId}`}
        >
          <div className="flex-1 min-w-0">
            <label
              htmlFor={`add-member-user-${teamId}`}
              className="block text-xs font-medium text-gray-600 mb-1"
            >
              {t('teamsSettings.members.userLabel')}
            </label>
            <select
              id={`add-member-user-${teamId}`}
              value={newUserId}
              onChange={(e) => setNewUserId(e.target.value)}
              disabled={addMutation.isPending}
              data-testid={`team-add-member-user-${teamId}`}
              className="block w-full rounded border border-gray-300 px-2 py-1.5 text-xs shadow-sm focus:border-indigo-500 focus:ring-indigo-500 disabled:bg-gray-50"
            >
              <option value="">{t('teamsSettings.members.userPlaceholder')}</option>
              {availableUsers.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label
              htmlFor={`add-member-role-${teamId}`}
              className="block text-xs font-medium text-gray-600 mb-1"
            >
              {t('teamsSettings.members.roleLabel')}
            </label>
            <select
              id={`add-member-role-${teamId}`}
              value={newRole}
              onChange={(e) => setNewRole(e.target.value as TeamMemberRole)}
              disabled={addMutation.isPending}
              data-testid={`team-add-member-role-${teamId}`}
              className="rounded border border-gray-300 px-2 py-1.5 text-xs shadow-sm focus:border-indigo-500 focus:ring-indigo-500 disabled:bg-gray-50"
            >
              {TEAM_MEMBER_ROLES.map((role) => (
                <option key={role} value={role}>
                  {role === 'lead'
                    ? t('teamsSettings.members.roleLead')
                    : t('teamsSettings.members.roleMember')}
                </option>
              ))}
            </select>
          </div>
          <Button
            type="submit"
            size="sm"
            disabled={!newUserId || addMutation.isPending}
            data-testid={`team-add-member-submit-${teamId}`}
          >
            {t('teamsSettings.members.addButton')}
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => {
              setAddingMember(false);
              setAddError(null);
            }}
            disabled={addMutation.isPending}
            data-testid={`team-add-member-cancel-${teamId}`}
          >
            {t('teamsSettings.form.cancelButton')}
          </Button>
        </form>
      ) : (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setAddingMember(true)}
          data-testid={`team-add-member-button-${teamId}`}
        >
          {t('teamsSettings.members.addButton')}
        </Button>
      )}

      {addError && (
        <p
          className="mt-1 text-xs text-red-600"
          role="alert"
          data-testid={`team-add-member-error-${teamId}`}
        >
          {addError}
        </p>
      )}
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────────────────────

export default function TeamsSettings() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);

  const {
    data: teams,
    isLoading: teamsLoading,
    isError: teamsError,
  } = useQuery({
    queryKey: TEAMS_QUERY_KEY,
    queryFn: listTeams,
  });

  const { data: activeUsersData } = useQuery({
    queryKey: ACTIVE_USERS_QUERY_KEY,
    queryFn: listActiveUsers,
    staleTime: 5 * 60 * 1000,
  });
  const users = activeUsersData?.users ?? [];

  const createMutation = useMutation({
    mutationFn: createTeam,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: TEAMS_QUERY_KEY });
      setCreating(false);
      setCreateError(null);
    },
    onError: (err: unknown) => {
      const code = (err as { response?: { data?: { error?: { code?: string } } } })?.response?.data
        ?.error?.code;
      if (code === 'TEAM_NAME_DUPLICATE') {
        setCreateError(t('teamsSettings.createError'));
      } else {
        setCreateError(t('teamsSettings.createError'));
      }
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: string;
      input: { name: string; manager_id: string | null; parent_team_id: string | null };
    }) => updateTeam(id, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: TEAMS_QUERY_KEY });
      setEditingId(null);
      setUpdateError(null);
    },
    onError: (err: unknown) => {
      const code = (err as { response?: { data?: { error?: { code?: string } } } })?.response?.data
        ?.error?.code;
      if (code === 'TEAM_CIRCULAR_REFERENCE') {
        setUpdateError(t('teamsSettings.updateError'));
      } else {
        setUpdateError(t('teamsSettings.updateError'));
      }
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteTeam,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: TEAMS_QUERY_KEY });
      setDeleteError(null);
    },
    onError: (err: unknown) => {
      const code = (err as { response?: { data?: { error?: { code?: string } } } })?.response?.data
        ?.error?.code;
      if (code === 'TEAM_HAS_CHILDREN') {
        setDeleteError(t('teamsSettings.deleteError.hasChildren'));
      } else {
        setDeleteError(t('teamsSettings.deleteError.generic'));
      }
    },
  });

  if (teamsLoading) {
    return (
      <p className="text-sm text-gray-500" data-testid="teams-settings-loading">
        {t('teamsSettings.loading')}
      </p>
    );
  }

  if (teamsError) {
    return (
      <p className="text-sm text-red-600" role="alert" data-testid="teams-settings-error">
        {t('teamsSettings.loadError')}
      </p>
    );
  }

  const treeNodes = buildTreeNodes(teams ?? []);

  return (
    <div className="space-y-6" data-testid="teams-settings-panel">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900" data-testid="teams-settings-title">
            {t('teamsSettings.sectionTitle')}
          </h2>
          <p className="mt-1 text-sm text-gray-500">{t('teamsSettings.sectionHint')}</p>
        </div>
        {!creating && !editingId && (
          <Button onClick={() => setCreating(true)} data-testid="teams-settings-new-button">
            {t('teamsSettings.newTeamButton')}
          </Button>
        )}
      </div>

      {deleteError && (
        <p className="text-sm text-red-600" role="alert" data-testid="teams-settings-delete-error">
          {deleteError}
        </p>
      )}

      {creating && (
        <div
          className="border border-gray-200 rounded-lg p-4 bg-white"
          data-testid="teams-settings-create-form"
        >
          <h3 className="text-sm font-semibold text-gray-800 mb-4">
            {t('teamsSettings.form.createTitle')}
          </h3>
          <TeamForm
            teams={teams ?? []}
            users={users}
            onSave={(data) => createMutation.mutate(data)}
            onCancel={() => {
              setCreating(false);
              setCreateError(null);
            }}
            isPending={createMutation.isPending}
            formError={createError}
          />
        </div>
      )}

      {treeNodes.length === 0 && !creating && (
        <p className="text-sm text-gray-500" data-testid="teams-settings-empty">
          {t('teamsSettings.empty')}
        </p>
      )}

      <div className="space-y-2" data-testid="teams-settings-list">
        {treeNodes.map(({ team, depth }) => (
          <div
            key={team.id}
            style={{ marginInlineStart: `${depth * 1.5}rem` }}
            className="border border-gray-200 rounded-lg bg-white"
            data-testid={`team-row-${team.id}`}
          >
            {editingId === team.id ? (
              <div className="p-4">
                <h3 className="text-sm font-semibold text-gray-800 mb-4">
                  {t('teamsSettings.form.editTitle')}
                </h3>
                <TeamForm
                  initial={team}
                  teams={teams ?? []}
                  users={users}
                  onSave={(data) => updateMutation.mutate({ id: team.id, input: data })}
                  onCancel={() => {
                    setEditingId(null);
                    setUpdateError(null);
                  }}
                  isPending={updateMutation.isPending}
                  formError={updateError}
                />
              </div>
            ) : (
              <div className="p-4">
                <div className="flex items-start justify-between">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        className="text-sm font-medium text-gray-900"
                        data-testid={`team-name-${team.id}`}
                      >
                        {team.name}
                      </span>
                      <span
                        className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600"
                        data-testid={`team-member-count-${team.id}`}
                      >
                        {t('teamsSettings.memberCount', { count: team.member_count })}
                      </span>
                    </div>
                    <p
                      className="mt-0.5 text-xs text-gray-500"
                      data-testid={`team-manager-${team.id}`}
                    >
                      {t('teamsSettings.managerLabel')}:{' '}
                      {team.manager_name ?? t('teamsSettings.noManager')}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 ms-4 shrink-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setExpandedId(expandedId === team.id ? null : team.id)}
                      data-testid={`team-expand-button-${team.id}`}
                      aria-expanded={expandedId === team.id}
                    >
                      {expandedId === team.id
                        ? t('teamsSettings.members.sectionTitle')
                        : t('teamsSettings.members.sectionTitle')}
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        setEditingId(team.id);
                        setDeleteError(null);
                        setUpdateError(null);
                      }}
                      data-testid={`team-edit-button-${team.id}`}
                    >
                      {t('teamsSettings.editButton')}
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => {
                        setDeleteError(null);
                        deleteMutation.mutate(team.id);
                      }}
                      disabled={deleteMutation.isPending}
                      data-testid={`team-delete-button-${team.id}`}
                    >
                      {t('teamsSettings.deleteButton')}
                    </Button>
                  </div>
                </div>

                {expandedId === team.id && <MemberList teamId={team.id} users={users} />}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
