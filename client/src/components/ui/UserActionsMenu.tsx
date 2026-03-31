/**
 * UserActionsMenu component.
 * Renders a meatball (⋯) trigger button that opens a dropdown context menu
 * with role, password, and activation actions for a single user row.
 */

import { useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button.js';
import { useOnClickOutside } from '@/hooks/useOnClickOutside.js';
import type { UserResponse, UserRole } from '@shared/schemas/userSchema.js';

export interface UserActionsMenuProps {
  /** The user this menu controls. */
  user: UserResponse;
  /** Whether any mutation for this user is pending. Disables the trigger while true. */
  isPending: boolean;
  /** Called when the admin selects Make Admin or Make Rep. */
  onRoleChange: (id: string, role: UserRole) => void;
  /** Called when the admin selects Set Password. Toggles the inline password form. */
  onSetPassword: (id: string) => void;
  /** Called when the admin selects Deactivate. */
  onDeactivate: (id: string) => void;
  /** Called when the admin selects Reactivate. */
  onReactivate: (id: string) => void;
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
  onRoleChange,
  onSetPassword,
  onDeactivate,
  onReactivate,
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
          className="absolute right-0 z-50 mt-1 w-44 rounded-md bg-white shadow-md border border-gray-200 divide-y divide-gray-100"
          role="menu"
          tabIndex={-1}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              onToggle(user.id);
            }
          }}
        >
          {/* Non-destructive actions */}
          <div className="py-1">
            {user.role === 'rep' ? (
              <button
                type="button"
                role="menuitem"
                data-testid={`make-admin-${user.id}`}
                className="block w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
                onClick={() => closeAndRun(() => onRoleChange(user.id, 'admin'))}
              >
                {t('users.actionMakeAdmin')}
              </button>
            ) : (
              <button
                type="button"
                role="menuitem"
                data-testid={`make-rep-${user.id}`}
                className="block w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
                onClick={() => closeAndRun(() => onRoleChange(user.id, 'rep'))}
              >
                {t('users.actionMakeRep')}
              </button>
            )}

            {user.status !== 'inactive' && (
              <button
                type="button"
                role="menuitem"
                data-testid={`set-password-toggle-${user.id}`}
                className="block w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
                onClick={() => closeAndRun(() => onSetPassword(user.id))}
              >
                {t('users.actionSetPassword')}
              </button>
            )}
          </div>

          {/* Activation / destructive actions */}
          <div className="py-1">
            {user.status === 'inactive' ? (
              <button
                type="button"
                role="menuitem"
                data-testid={`reactivate-${user.id}`}
                className="block w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
                onClick={() => closeAndRun(() => onReactivate(user.id))}
              >
                {t('users.actionReactivate')}
              </button>
            ) : (
              <button
                type="button"
                role="menuitem"
                data-testid={`deactivate-${user.id}`}
                className="block w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50"
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
