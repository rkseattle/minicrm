/**
 * UserActionsMenu component.
 * Renders a meatball (⋯) trigger button that opens a dropdown context menu
 * with password, onboarding-reset, and activation actions for a single user row.
 * Role changes are handled by the InlineRoleSelect cell.
 * Service accounts show Issue/Revoke API token actions instead of password controls.
 */

import { useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button.js';
import { useOnClickOutside } from '@/hooks/useOnClickOutside.js';
import type { UserResponse } from '@shared/schemas/userSchema.js';

export interface UserActionsMenuProps {
  /** The user this menu controls. */
  user: UserResponse;
  /** Whether any mutation for this user is pending. Disables the trigger while true. */
  isPending: boolean;
  /** Called when the admin selects Set Password. Toggles the inline password form. */
  onSetPassword: (id: string) => void;
  /** Called when the admin selects Deactivate. */
  onDeactivate: (id: string) => void;
  /** Called when the admin selects Reactivate. */
  onReactivate: (id: string) => void;
  /** Called when the admin selects Reset onboarding. Hidden for the admin's own row. */
  onResetOnboarding: (id: string) => void;
  /** Called when the admin issues an API token for a service account. */
  onIssueToken?: (id: string) => void;
  /** Called when the admin revokes the API token for a service account. */
  onRevokeToken?: (id: string) => void;
  /** UUID of the currently logged-in admin — hides Reset Onboarding on the admin's own row. */
  currentUserId: string;
  /** Whether the menu should be forced open (e.g. another menu is opening this one). */
  isOpen: boolean;
  /** Called when the menu is toggled open or closed. */
  onToggle: (id: string) => void;
}

/**
 * Meatball menu for per-row user admin actions.
 * Renders conditionally based on user role and status.
 *
 * @param props - See UserActionsMenuProps.
 */
export function UserActionsMenu({
  user,
  isPending,
  onSetPassword,
  onDeactivate,
  onReactivate,
  onResetOnboarding,
  onIssueToken,
  onRevokeToken,
  currentUserId,
  isOpen,
  onToggle,
}: UserActionsMenuProps) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);

  const handleClickOutside = useCallback(() => {
    if (isOpen) {
      onToggle(user.id);
    }
  }, [isOpen, onToggle, user.id]);

  useOnClickOutside(containerRef, handleClickOutside);

  /**
   * Closes the menu then invokes an action callback.
   *
   * @param action - The action to run after closing.
   */
  function closeAndRun(action: () => void): void {
    onToggle(user.id);
    action();
  }

  const isServiceAccount = user.role === 'service_account';

  return (
    <div ref={containerRef} className="relative inline-block">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        data-testid={`user-actions-${user.id}`}
        disabled={isPending}
        onClick={() => onToggle(user.id)}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label={t('users.actionsMenuLabel', { name: user.name })}
      >
        ⋯
      </Button>

      {isOpen && (
        <div
          className="absolute right-0 z-50 mt-1 w-48 rounded-md bg-white shadow-md border border-gray-200 divide-y divide-gray-100"
          role="menu"
          tabIndex={-1}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              onToggle(user.id);
            }
          }}
        >
          {/* Service account token actions */}
          {isServiceAccount && (
            <div className="py-1">
              <button
                type="button"
                role="menuitem"
                data-testid={`issue-token-${user.id}`}
                className="block w-full px-4 py-2 text-start text-sm text-gray-700 hover:bg-gray-50"
                onClick={() => closeAndRun(() => onIssueToken?.(user.id))}
              >
                {t('users.actionIssueToken')}
              </button>
              {user.has_api_token && (
                <button
                  type="button"
                  role="menuitem"
                  data-testid={`revoke-token-${user.id}`}
                  className="block w-full px-4 py-2 text-start text-sm text-red-600 hover:bg-red-50"
                  onClick={() => closeAndRun(() => onRevokeToken?.(user.id))}
                >
                  {t('users.actionRevokeToken')}
                </button>
              )}
            </div>
          )}

          {/* Non-destructive actions — hidden for service accounts */}
          {!isServiceAccount && (
            <div className="py-1">
              {user.status !== 'inactive' && (
                <button
                  type="button"
                  role="menuitem"
                  data-testid={`set-password-toggle-${user.id}`}
                  className="block w-full px-4 py-2 text-start text-sm text-gray-700 hover:bg-gray-50"
                  onClick={() => closeAndRun(() => onSetPassword(user.id))}
                >
                  {t('users.actionSetPassword')}
                </button>
              )}

              {/* Reset onboarding — hidden for the admin's own row */}
              {user.id !== currentUserId && (
                <button
                  type="button"
                  role="menuitem"
                  data-testid={`reset-onboarding-${user.id}`}
                  className="block w-full px-4 py-2 text-start text-sm text-gray-700 hover:bg-gray-50"
                  onClick={() => closeAndRun(() => onResetOnboarding(user.id))}
                >
                  {t('users.actionResetOnboarding')}
                </button>
              )}
            </div>
          )}

          {/* Activation / destructive actions */}
          <div className="py-1">
            {user.status === 'inactive' ? (
              <button
                type="button"
                role="menuitem"
                data-testid={`reactivate-${user.id}`}
                className="block w-full px-4 py-2 text-start text-sm text-gray-700 hover:bg-gray-50"
                onClick={() => closeAndRun(() => onReactivate(user.id))}
              >
                {t('users.actionReactivate')}
              </button>
            ) : (
              <button
                type="button"
                role="menuitem"
                data-testid={`deactivate-${user.id}`}
                className="block w-full px-4 py-2 text-start text-sm text-red-600 hover:bg-red-50"
                onClick={() => closeAndRun(() => onDeactivate(user.id))}
              >
                {t('users.actionDeactivate')}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
