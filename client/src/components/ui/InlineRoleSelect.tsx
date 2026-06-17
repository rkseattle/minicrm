/**
 * InlineRoleSelect — inline built-in role <select> for the user table.
 * Fires PATCH /users/:id/role on change with optimistic update and rollback toast.
 * Renders read-only custom role chips below the select (MINCRM-560).
 */

import { useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { updateUserRole } from '@/api/users.js';
import type { UserResponse, UserRole } from '@shared/schemas/userSchema.js';
import { USER_ROLES } from '@shared/schemas/userSchema.js';
import type { CustomRoleResponse } from '@/api/customRoles.js';

/** Built-in role i18n key map */
const ROLE_LABEL_KEYS: Record<UserRole, string> = {
  admin: 'users.roleAdmin',
  manager: 'users.roleManager',
  rep: 'users.roleRep',
  viewer: 'users.roleViewer',
  service_account: 'users.roleServiceAccount',
};

export interface InlineRoleSelectProps {
  /** The user whose role this cell controls. */
  user: UserResponse;
  /** Whether the viewing admin has users:edit capability (controls disabled state). */
  canEdit: boolean;
  /**
   * Custom roles assigned to this user — supplied by the parent page which
   * fetches them once and passes them down (no per-row requests).
   */
  assignedCustomRoles: CustomRoleResponse[];
  /** React Query key for the users list — invalidated on successful role change. */
  usersQueryKey: readonly unknown[];
  /** Called when the server confirms a role change — parent can update optimistic cache. */
  onRoleChanged?: (userId: string, newRole: UserRole) => void;
  /** Called when a role change fails — parent can display an error toast. */
  onRoleError?: (message: string) => void;
}

/**
 * Renders a built-in role <select> with optimistic update and rollback, plus
 * read-only custom role chips that link to /settings/roles/:id.
 * Service accounts show a disabled select with a tooltip (MINCRM-560).
 */
export function InlineRoleSelect({
  user,
  canEdit,
  assignedCustomRoles,
  usersQueryKey,
  onRoleError,
}: InlineRoleSelectProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  // Optimistic local state — tracks the displayed value before server confirmation
  const [optimisticRole, setOptimisticRole] = useState<UserRole>(user.role);

  const mutation = useMutation({
    mutationFn: ({ id, role }: { id: string; role: UserRole }) => updateUserRole(id, role),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: usersQueryKey });
    },
    onError: () => {
      // Roll back optimistic value and notify parent
      setOptimisticRole(user.role);
      onRoleError?.(t('users.inlineRoleError'));
    },
  });

  const handleChange = useCallback(
    (event: React.ChangeEvent<HTMLSelectElement>) => {
      const newRole = event.target.value as UserRole;
      setOptimisticRole(newRole);
      mutation.mutate({ id: user.id, role: newRole });
    },
    [mutation, user.id],
  );

  const isServiceAccount = user.role === 'service_account';
  const isDisabled = !canEdit || isServiceAccount || mutation.isPending;

  return (
    <div className="flex flex-col gap-1 min-w-0">
      {isServiceAccount ? (
        <span
          className="text-sm text-gray-500 cursor-default"
          title={t('users.serviceAccountRoleTooltip')}
          aria-label={t('users.serviceAccountRoleTooltip')}
          data-testid={`role-cell-${user.id}`}
        >
          {t(ROLE_LABEL_KEYS[user.role])}
        </span>
      ) : (
        <select
          value={optimisticRole}
          disabled={isDisabled}
          aria-label={t('users.roleSelectLabel', { name: user.name })}
          data-testid={`role-select-${user.id}`}
          className={[
            'rounded border text-sm bg-white px-2 py-1 leading-tight',
            'focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent',
            'disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-500',
            isDisabled ? 'border-transparent' : 'border-gray-300',
          ].join(' ')}
          onChange={handleChange}
        >
          {(USER_ROLES as readonly UserRole[])
            .filter((role) => role !== 'service_account')
            .map((role) => (
              <option key={role} value={role}>
                {t(ROLE_LABEL_KEYS[role])}
              </option>
            ))}
        </select>
      )}

      {/* Read-only custom role chips — informational only */}
      {assignedCustomRoles.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {assignedCustomRoles.map((cr) => (
            <Link
              key={cr.id}
              to={`/settings/roles/${cr.id}`}
              aria-label={t('users.customRoleLinkLabel', { name: cr.name })}
              data-testid={`custom-role-chip-${user.id}-${cr.id}`}
              className="inline-flex items-center rounded-full bg-indigo-50 border border-indigo-200 px-2 py-0.5 text-xs text-indigo-700 hover:bg-indigo-100 transition-colors"
            >
              {cr.name}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
