/**
 * InlineStatusSelect — inline status <select> for the user table.
 * Fires PATCH /users/:id/status on change with optimistic update and rollback toast.
 * Invited users show a read-only badge with tooltip (MINCRM-561).
 */

import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { updateUserStatus } from '@/api/users.js';
import type { UserResponse } from '@shared/schemas/userSchema.js';

export interface InlineStatusSelectProps {
  /** The user whose status this cell controls. */
  user: UserResponse;
  /** Whether the viewing admin has users:edit capability. */
  canEdit: boolean;
  /** UUID of the current authenticated user — for self-deactivation guard. */
  currentUserId: string;
  /** React Query key for the users list — invalidated on success. */
  usersQueryKey: readonly unknown[];
  /** Called when the server rejects the update — parent shows the error toast. */
  onStatusError?: (message: string) => void;
}

/**
 * Renders an inline status <select> (Active / Inactive) for active or inactive users.
 * Shows a read-only "Invited" badge with tooltip for invited users.
 * Blocks self-deactivation with a confirmation dialog (MINCRM-561).
 */
export function InlineStatusSelect({
  user,
  canEdit,
  currentUserId,
  usersQueryKey,
  onStatusError,
}: InlineStatusSelectProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [optimisticActive, setOptimisticActive] = useState<boolean>(user.status === 'active');
  const [showSelfDeactivateConfirm, setShowSelfDeactivateConfirm] = useState(false);
  const [pendingActive, setPendingActive] = useState<boolean | null>(null);

  const mutation = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) => updateUserStatus(id, active),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: usersQueryKey });
    },
    onError: () => {
      // Roll back the optimistic value
      setOptimisticActive(user.status === 'active');
      onStatusError?.(t('users.inlineStatusError'));
    },
  });

  const commitStatusChange = useCallback(
    (active: boolean) => {
      setOptimisticActive(active);
      mutation.mutate({ id: user.id, active });
    },
    [mutation, user.id],
  );

  const handleChange = useCallback(
    (event: React.ChangeEvent<HTMLSelectElement>) => {
      const newActive = event.target.value === 'active';

      // Block self-deactivation client-side — show confirmation instead
      if (!newActive && user.id === currentUserId) {
        setPendingActive(false);
        setShowSelfDeactivateConfirm(true);
        return;
      }

      commitStatusChange(newActive);
    },
    [commitStatusChange, currentUserId, user.id],
  );

  const handleSelfDeactivateConfirm = useCallback(() => {
    setShowSelfDeactivateConfirm(false);
    if (pendingActive !== null) {
      commitStatusChange(pendingActive);
    }
    setPendingActive(null);
  }, [commitStatusChange, pendingActive]);

  const handleSelfDeactivateCancel = useCallback(() => {
    setShowSelfDeactivateConfirm(false);
    setPendingActive(null);
  }, []);

  // Invited users: read-only badge with tooltip
  if (user.status === 'invited') {
    return (
      <span
        title={t('users.invitedBadgeTooltip')}
        aria-label={t('users.invitedBadgeTooltip')}
        data-testid={`status-invited-${user.id}`}
        className="inline-flex items-center rounded-full bg-amber-50 border border-amber-300 px-2 py-0.5 text-xs text-amber-700 cursor-default"
      >
        {t('users.statusInvited')}
      </span>
    );
  }

  const isDisabled = !canEdit || mutation.isPending;

  return (
    <>
      <select
        value={optimisticActive ? 'active' : 'inactive'}
        disabled={isDisabled}
        aria-label={t('users.statusSelectLabel', { name: user.name })}
        data-testid={`status-select-${user.id}`}
        className={[
          'rounded border text-sm bg-white px-2 py-1 leading-tight',
          'focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent',
          'disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-500',
          isDisabled ? 'border-transparent' : 'border-gray-300',
        ].join(' ')}
        onChange={handleChange}
      >
        <option value="active">{t('users.statusActive')}</option>
        <option value="inactive">{t('users.statusInactive')}</option>
      </select>

      {/* Self-deactivation confirmation dialog */}
      {showSelfDeactivateConfirm && (
        <div
          role="presentation"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          data-testid="deactivate-self-overlay"
          onClick={handleSelfDeactivateCancel}
        >
          <dialog
            open
            aria-modal="true"
            aria-labelledby="deactivate-self-title"
            data-testid="deactivate-self-dialog"
            className="relative w-full max-w-sm mx-4 p-0"
          >
            <div
              role="presentation"
              className="rounded-lg bg-white p-6 shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <h2 id="deactivate-self-title" className="text-base font-semibold text-gray-900 mb-2">
                {t('users.deactivateSelfTitle')}
              </h2>
              <p className="text-sm text-gray-600 mb-6">{t('users.deactivateSelfConfirm')}</p>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  data-testid="deactivate-self-confirm"
                  className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500"
                  onClick={handleSelfDeactivateConfirm}
                >
                  {t('users.deactivateSelfButton')}
                </button>
                <button
                  type="button"
                  data-testid="deactivate-self-cancel"
                  className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-400"
                  onClick={handleSelfDeactivateCancel}
                >
                  {t('users.cancel')}
                </button>
              </div>
            </div>
          </dialog>
        </div>
      )}
    </>
  );
}
