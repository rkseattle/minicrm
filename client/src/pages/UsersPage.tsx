/**
 * UsersPage component — Admin only.
 * Lists all users and provides controls to invite new users,
 * change roles, and deactivate/reactivate accounts.
 */

import { useState, Fragment, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import NavBar from '@/components/NavBar.js';
import { Button } from '@/components/ui/Button.js';
import { Input } from '@/components/ui/Input.js';
import { Select } from '@/components/ui/Select.js';
import { Badge } from '@/components/ui/Badge.js';
import { UserActionsMenu } from '@/components/ui/UserActionsMenu.js';
import {
  listUsers,
  inviteUser,
  updateUserRole,
  deactivateUser,
  reactivateUser,
  adminSetPassword,
} from '@/api/users.js';
import type { UserResponse, UserStatus, UserRole } from '@shared/schemas/userSchema.js';
import { PASSWORD_MIN_LENGTH } from '@shared/schemas/userSchema.js';

/** React Query cache key for the users list */
const USERS_QUERY_KEY = ['users'] as const;

/** Maps a user status to a Badge variant */
const STATUS_BADGE_VARIANT: Record<UserStatus, 'success' | 'warning' | 'neutral'> = {
  active: 'success',
  invited: 'warning',
  inactive: 'neutral',
};

interface InviteUserFormProps {
  onSuccess?: () => void;
}

interface InviteFormState {
  email: string;
  name: string;
  role: UserRole;
}

/**
 * Invite user form component rendered inside a card.
 */
function InviteUserForm({ onSuccess }: InviteUserFormProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [formData, setFormData] = useState<InviteFormState>({
    email: '',
    name: '',
    role: 'rep',
  });
  const [lastInviteResult, setLastInviteResult] = useState<{
    setPasswordPath: string;
  } | null>(null);

  const inviteMutation = useMutation({
    mutationFn: () => inviteUser(formData),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: USERS_QUERY_KEY });
      setLastInviteResult(data);
      setFormData({ email: '', name: '', role: 'rep' });
      onSuccess?.();
    },
  });

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    inviteMutation.mutate();
  };

  const handleChange = (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>): void => {
    const { name, value } = event.target;
    setFormData((previous) => ({ ...previous, [name]: value }));
  };

  return (
    <section className="bg-white border border-gray-200 rounded-lg p-6 mb-8">
      <h2 className="text-sm font-semibold text-gray-900 mb-4">{t('users.inviteTitle')}</h2>

      <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-4">
        <div className="min-w-40">
          <Input
            id="invite-name"
            data-testid="invite-name"
            name="name"
            type="text"
            required
            label={t('users.nameLabel')}
            value={formData.name}
            onChange={handleChange}
            placeholder={t('users.namePlaceholder')}
          />
        </div>

        <div className="min-w-48">
          <Input
            id="invite-email"
            data-testid="invite-email"
            name="email"
            type="email"
            required
            label={t('users.emailLabel')}
            value={formData.email}
            onChange={handleChange}
          />
        </div>

        <div className="min-w-32">
          <Select
            id="invite-role"
            data-testid="invite-role"
            name="role"
            label={t('users.roleLabel')}
            value={formData.role}
            onChange={handleChange}
          >
            <option value="rep">{t('users.roleRep')}</option>
            <option value="admin">{t('users.roleAdmin')}</option>
          </Select>
        </div>

        <Button type="submit" data-testid="invite-submit" disabled={inviteMutation.isPending}>
          {inviteMutation.isPending ? t('users.submitting') : t('users.submitInvite')}
        </Button>
      </form>

      {inviteMutation.isSuccess && lastInviteResult && (
        <div role="status" className="mt-4 rounded-md bg-emerald-50 border border-emerald-200 p-4">
          <p className="text-sm font-medium text-emerald-800 mb-2">{t('users.inviteSuccess')}</p>
          <p className="text-xs text-emerald-700 mb-2">
            <strong>{t('users.inviteTokenLabel')}:</strong>
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 rounded bg-white border border-emerald-200 px-3 py-1.5 text-xs text-gray-700 break-all">
              {window.location.origin}
              {lastInviteResult.setPasswordPath}
            </code>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() =>
                navigator.clipboard.writeText(
                  `${window.location.origin}${lastInviteResult.setPasswordPath}`,
                )
              }
            >
              {t('users.copyLink')}
            </Button>
          </div>
        </div>
      )}

      {inviteMutation.isError && (
        <div
          role="alert"
          className="mt-4 rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700"
        >
          {(inviteMutation.error as { response?: { data?: { error?: { message?: string } } } })
            ?.response?.data?.error?.message ?? t('errors.generic')}
        </div>
      )}
    </section>
  );
}

interface SetPasswordFormProps {
  userId: string;
  onClose: () => void;
}

/**
 * Inline form that lets an admin set a user's password directly.
 * Renders inside the user row expansion area.
 */
function SetPasswordForm({ userId, onClose }: SetPasswordFormProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  const [succeeded, setSucceeded] = useState(false);

  const mutation = useMutation({
    mutationFn: () => adminSetPassword(userId, password),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: USERS_QUERY_KEY });
      setPassword('');
      setConfirmPassword('');
      setSucceeded(true);
      // Delay closing so the success banner is visible before the form unmounts
      setTimeout(onClose, 1500);
    },
  });

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setLocalError(null);

    if (password !== confirmPassword) {
      setLocalError(t('users.setPassword.mismatch'));
      return;
    }

    if (
      password.length < PASSWORD_MIN_LENGTH ||
      !/[a-zA-Z]/.test(password) ||
      !/[0-9]/.test(password)
    ) {
      setLocalError(t('users.setPassword.complexity', { min: PASSWORD_MIN_LENGTH }));
      return;
    }

    mutation.mutate();
  };

  const serverError =
    (
      mutation.error as {
        response?: { data?: { error?: { message?: string } } };
      } | null
    )?.response?.data?.error?.message ?? (mutation.isError ? t('errors.generic') : null);

  const displayError = localError ?? serverError;

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-3 p-4 bg-gray-50 border border-gray-200 rounded-lg"
      data-testid={`set-password-form-${userId}`}
    >
      <p className="text-xs text-gray-500 mb-3">
        {t('users.setPassword.hint', { min: PASSWORD_MIN_LENGTH })}
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-40">
          <Input
            id={`set-password-${userId}`}
            data-testid={`set-password-input-${userId}`}
            type="password"
            autoComplete="new-password"
            required
            label={t('users.setPassword.passwordLabel')}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t('users.setPassword.passwordPlaceholder')}
          />
        </div>
        <div className="min-w-40">
          <Input
            id={`set-password-confirm-${userId}`}
            data-testid={`set-password-confirm-${userId}`}
            type="password"
            autoComplete="new-password"
            required
            label={t('users.setPassword.confirmLabel')}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder={t('users.setPassword.confirmPlaceholder')}
          />
        </div>
        <Button
          type="submit"
          size="sm"
          data-testid={`set-password-submit-${userId}`}
          disabled={mutation.isPending}
        >
          {mutation.isPending ? t('users.setPassword.submitting') : t('users.setPassword.submit')}
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          data-testid={`set-password-cancel-${userId}`}
          onClick={onClose}
        >
          {t('users.cancel')}
        </Button>
      </div>
      {displayError && (
        <div
          role="alert"
          className="mt-3 rounded-md bg-red-50 border border-red-200 px-3 py-2 text-sm text-red-700"
        >
          {displayError}
        </div>
      )}
      {succeeded && (
        <div
          role="status"
          className="mt-3 rounded-md bg-emerald-50 border border-emerald-200 px-3 py-2 text-sm text-emerald-800"
        >
          {t('users.setPassword.success')}
        </div>
      )}
    </form>
  );
}

/**
 * Users management page — lists users and provides admin actions.
 */
export default function UsersPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [setPasswordUserId, setSetPasswordUserId] = useState<string | null>(null);
  const [openMenuUserId, setOpenMenuUserId] = useState<string | null>(null);

  /**
   * Toggles the action menu for the given user.
   * Closes the currently open menu if a different one is opened.
   *
   * @param id - The user ID whose menu to toggle.
   */
  const handleMenuToggle = useCallback((id: string): void => {
    setOpenMenuUserId((current) => (current === id ? null : id));
  }, []);

  const { data, isLoading, isError } = useQuery({
    queryKey: USERS_QUERY_KEY,
    queryFn: listUsers,
  });

  const roleMutation = useMutation({
    mutationFn: ({ id, role }: { id: string; role: UserRole }) => updateUserRole(id, role),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: USERS_QUERY_KEY }),
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => deactivateUser(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: USERS_QUERY_KEY }),
  });

  const reactivateMutation = useMutation({
    mutationFn: (id: string) => reactivateUser(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: USERS_QUERY_KEY }),
  });

  const users: UserResponse[] = data?.users ?? [];

  return (
    <div className="min-h-screen bg-gray-50">
      <NavBar />
      <main className="max-w-7xl mx-auto px-6 py-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-6">{t('users.pageTitle')}</h1>

        <InviteUserForm />

        {/* Loading state */}
        {isLoading && (
          <div className="bg-white border border-gray-200 rounded-lg p-12 text-center">
            <p aria-busy="true" className="text-sm text-gray-400">
              {t('users.loading')}
            </p>
          </div>
        )}

        {/* Error state */}
        {isError && (
          <div
            role="alert"
            className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700"
          >
            {t('errors.generic')}
          </div>
        )}

        {/* Users table */}
        {!isLoading && !isError && (
          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            {users.length === 0 ? (
              <div className="p-12 text-center">
                <p className="text-sm text-gray-400">{t('users.empty')}</p>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                      {t('users.columnName')}
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                      {t('users.columnEmail')}
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                      {t('users.columnRole')}
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                      {t('users.columnStatus')}
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">
                      {t('users.columnActions')}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {users.map((user) => (
                    <Fragment key={user.id}>
                      <tr className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-3 font-medium text-gray-900">{user.name}</td>
                        <td className="px-4 py-3 text-gray-500">{user.email}</td>
                        <td className="px-4 py-3 text-gray-700">
                          {user.role === 'admin' ? t('users.roleAdmin') : t('users.roleRep')}
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant={STATUS_BADGE_VARIANT[user.status]}>
                            {user.status === 'active'
                              ? t('users.statusActive')
                              : user.status === 'invited'
                                ? t('users.statusInvited')
                                : t('users.statusInactive')}
                          </Badge>
                        </td>
                        <td className="px-4 py-3">
                          <UserActionsMenu
                            user={user}
                            isPending={
                              roleMutation.isPending ||
                              deactivateMutation.isPending ||
                              reactivateMutation.isPending
                            }
                            isOpen={openMenuUserId === user.id}
                            onToggle={handleMenuToggle}
                            onRoleChange={(id, role) => roleMutation.mutate({ id, role })}
                            onSetPassword={(id) =>
                              setSetPasswordUserId(setPasswordUserId === id ? null : id)
                            }
                            onDeactivate={(id) => deactivateMutation.mutate(id)}
                            onReactivate={(id) => reactivateMutation.mutate(id)}
                          />
                        </td>
                      </tr>
                      {setPasswordUserId === user.id && (
                        <tr>
                          <td colSpan={5} className="px-4 pb-4">
                            <SetPasswordForm
                              userId={user.id}
                              onClose={() => setSetPasswordUserId(null)}
                            />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
