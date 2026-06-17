/**
 * UsersPage component — Admin only.
 * Lists all users and provides controls to invite new users,
 * change roles inline, change status inline, and perform bulk actions.
 * (MINCRM-560, MINCRM-561, MINCRM-562)
 */

import { useState, Fragment, useCallback, useMemo } from 'react';
import { useBreakpoint } from '@/context/BreakpointContext.js';
import { useQuery, useQueries, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import NavBar from '@/components/NavBar.js';
import { Button } from '@/components/ui/Button.js';
import { Input } from '@/components/ui/Input.js';
import { Select } from '@/components/ui/Select.js';
import { UserActionsMenu } from '@/components/ui/UserActionsMenu.js';
import { InlineRoleSelect } from '@/components/ui/InlineRoleSelect.js';
import { InlineStatusSelect } from '@/components/ui/InlineStatusSelect.js';
import { Pagination } from '@/components/ui/Pagination.js';
import { PagedListLayout } from '@/components/PagedListLayout.js';
import { useAuth } from '@/hooks/useAuth.js';
import {
  listUsers,
  inviteUser,
  deactivateUser,
  reactivateUser,
  adminSetPassword,
  resetUserOnboarding,
  issueApiToken,
  revokeApiToken,
} from '@/api/users.js';
import { listUserRoles } from '@/api/customRoles.js';
import type { CustomRoleResponse } from '@/api/customRoles.js';
import type { IssueApiTokenResponse } from '@shared/schemas/userSchema.js';
import type { UserResponse, UserRole } from '@shared/schemas/userSchema.js';
import { PASSWORD_MIN_LENGTH } from '@shared/schemas/userSchema.js';
import { PAGINATION_DEFAULT_LIMIT } from '@shared/schemas/paginationSchema.js';

/** React Query cache key for the users list */
const USERS_QUERY_KEY = ['users'] as const;

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
  const { isDesktop } = useBreakpoint();

  const [formData, setFormData] = useState<InviteFormState>({
    email: '',
    name: '',
    role: 'rep',
  });
  const [lastInviteResult, setLastInviteResult] = useState<{
    setPasswordPath: string;
  } | null>(null);
  // Collapsed by default on mobile so the form doesn't consume most of the screen
  const [isOpen, setIsOpen] = useState(isDesktop);

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
    <section className="bg-white border border-gray-200 rounded-lg mb-8">
      <button
        type="button"
        className="w-full flex items-center justify-between px-6 py-4 text-start"
        aria-expanded={isOpen}
        data-testid="invite-form-toggle"
        onClick={() => setIsOpen((o) => !o)}
      >
        <h2 className="text-sm font-semibold text-gray-900">{t('users.inviteTitle')}</h2>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className={`h-4 w-4 text-gray-400 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div className="px-6 pb-6">
          <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-4">
            <div className="w-full sm:min-w-40 sm:w-auto">
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

            <div className="w-full sm:min-w-48 sm:w-auto">
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

            <div className="w-full sm:min-w-32 sm:w-auto">
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
                <option value="viewer">{t('users.roleViewer')}</option>
                <option value="manager">{t('users.roleManager')}</option>
                <option value="service_account">{t('users.roleServiceAccount')}</option>
              </Select>
            </div>

            <Button
              type="submit"
              data-testid="invite-submit"
              disabled={inviteMutation.isPending}
              className="w-full sm:w-auto min-h-[44px] sm:min-h-0"
            >
              {inviteMutation.isPending ? t('users.submitting') : t('users.submitInvite')}
            </Button>
          </form>

          {inviteMutation.isSuccess && lastInviteResult && (
            <div
              role="status"
              className="mt-4 rounded-md bg-emerald-50 border border-emerald-200 p-4"
            >
              <p className="text-sm font-medium text-emerald-800 mb-2">
                {t('users.inviteSuccess')}
              </p>
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
      !/[0-9]/.test(password) ||
      !/[^a-zA-Z0-9]/.test(password)
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
        <div className="w-full sm:min-w-40 sm:w-auto">
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
        <div className="w-full sm:min-w-40 sm:w-auto">
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
          className="min-h-[44px] sm:min-h-0"
        >
          {mutation.isPending ? t('users.setPassword.submitting') : t('users.setPassword.submit')}
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          data-testid={`set-password-cancel-${userId}`}
          onClick={onClose}
          className="min-h-[44px] sm:min-h-0"
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
  const { isDesktop } = useBreakpoint();
  const queryClient = useQueryClient();
  const { user: currentUser } = useAuth();

  const [setPasswordUserId, setSetPasswordUserId] = useState<string | null>(null);
  const [setMobilePasswordUserId, setSetMobilePasswordUserId] = useState<string | null>(null);
  const [openMenuUserId, setOpenMenuUserId] = useState<string | null>(null);
  const [openMobileMenuUserId, setOpenMobileMenuUserId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  /** ID of the user whose onboarding reset confirmation dialog is open (MINCRM-410) */
  const [resetOnboardingUserId, setResetOnboardingUserId] = useState<string | null>(null);
  const [resetOnboardingSuccessUserId, setResetOnboardingSuccessUserId] = useState<string | null>(
    null,
  );
  /** Issued token data shown once after Issue API Token action (MINCRM-536) */
  const [issuedTokenResult, setIssuedTokenResult] = useState<IssueApiTokenResponse | null>(null);

  /**
   * Toggles the desktop action menu for the given user.
   * Closes the currently open menu if a different one is opened.
   *
   * @param id - The user ID whose menu to toggle.
   */
  const handleMenuToggle = useCallback((id: string): void => {
    setOpenMenuUserId((current) => (current === id ? null : id));
  }, []);

  /**
   * Toggles the mobile action menu for the given user.
   * Uses separate state to avoid cross-talk with the desktop menu's outside-click handlers.
   *
   * @param id - The user ID whose menu to toggle.
   */
  const handleMobileMenuToggle = useCallback((id: string): void => {
    setOpenMobileMenuUserId((current) => (current === id ? null : id));
  }, []);

  const usersQueryKey = [...USERS_QUERY_KEY, { page }] as const;

  const { data, isLoading, isError } = useQuery({
    queryKey: usersQueryKey,
    queryFn: () => listUsers({ page, limit: PAGINATION_DEFAULT_LIMIT }),
  });

  const users: UserResponse[] = useMemo(() => data?.data ?? [], [data]);

  // Fetch assigned custom roles for each user on the current page (MINCRM-560)
  const userRoleQueries = useQueries({
    queries: users.map((u) => ({
      queryKey: ['users', u.id, 'roles'] as const,
      queryFn: () => listUserRoles(u.id),
      staleTime: 5 * 60 * 1000,
    })),
  });

  // Build a map from userId → assigned custom roles for the current page
  const userCustomRolesMap = useMemo<Map<string, CustomRoleResponse[]>>(() => {
    const map = new Map<string, CustomRoleResponse[]>();
    users.forEach((u, idx) => {
      map.set(u.id, userRoleQueries[idx]?.data ?? []);
    });
    return map;
  }, [users, userRoleQueries]);

  // Error toast for inline role/status failures
  const [inlineErrorMessage, setInlineErrorMessage] = useState<string | null>(null);

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => deactivateUser(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: USERS_QUERY_KEY }),
  });

  const reactivateMutation = useMutation({
    mutationFn: (id: string) => reactivateUser(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: USERS_QUERY_KEY }),
  });

  const resetOnboardingMutation = useMutation({
    mutationFn: (id: string) => resetUserOnboarding(id),
    onSuccess: (_data, id) => {
      setResetOnboardingUserId(null);
      setResetOnboardingSuccessUserId(id);
    },
  });

  const issueTokenMutation = useMutation({
    mutationFn: (id: string) => issueApiToken(id),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: USERS_QUERY_KEY });
      setIssuedTokenResult(data);
    },
  });

  const revokeTokenMutation = useMutation({
    mutationFn: (id: string) => revokeApiToken(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: USERS_QUERY_KEY });
    },
  });

  // canEditUsers: admins have users:edit capability by definition (MINCRM-560, MINCRM-561)
  const canEditUsers = currentUser?.role === 'admin';

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      <NavBar />
      <main className="flex-1 flex flex-col min-h-0 overflow-hidden max-w-7xl w-full mx-auto px-4 sm:px-6 pt-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-6">{t('users.pageTitle')}</h1>

        <InviteUserForm />

        {/* Loading state */}
        {isLoading && (
          <div className="bg-white border border-gray-200 rounded-lg p-12 text-center">
            <p aria-busy="true" className="text-sm text-gray-500">
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
          <PagedListLayout
            toolbar={null}
            isEmpty={users.length === 0}
            emptyState={
              <div className="p-12 text-center">
                <p className="text-sm text-gray-500">{t('users.empty')}</p>
              </div>
            }
            pagination={
              data ? (
                <Pagination
                  page={data.page}
                  limit={data.limit}
                  total={data.total}
                  onPageChange={setPage}
                />
              ) : null
            }
          >
            <>
              {isDesktop ? (
                /* Desktop table */
                <table className="w-full text-sm">
                  <thead className="sticky top-0 z-10 bg-gray-50">
                    <tr className="border-b border-gray-200">
                      <th className="px-4 py-3 text-start text-xs font-semibold text-gray-500 uppercase tracking-wide rounded-ss-lg">
                        {t('users.columnName')}
                      </th>
                      <th className="px-4 py-3 text-start text-xs font-semibold text-gray-500 uppercase tracking-wide">
                        {t('users.columnEmail')}
                      </th>
                      <th className="px-4 py-3 text-start text-xs font-semibold text-gray-500 uppercase tracking-wide">
                        {t('users.columnRole')}
                      </th>
                      <th className="px-4 py-3 text-start text-xs font-semibold text-gray-500 uppercase tracking-wide">
                        {t('users.columnStatus')}
                      </th>
                      <th className="px-4 py-3 text-start text-xs font-semibold text-gray-500 uppercase tracking-wide rounded-se-lg">
                        {t('users.columnActions')}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {users.map((user) => (
                      <Fragment key={user.id}>
                        <tr
                          className="hover:bg-gray-50 transition-colors"
                          data-testid={`user-card-${user.id}`}
                        >
                          <td className="px-4 py-3 font-medium text-gray-900">{user.name}</td>
                          <td className="px-4 py-3 text-gray-500">{user.email}</td>
                          <td className="px-4 py-3">
                            <InlineRoleSelect
                              user={user}
                              canEdit={canEditUsers}
                              assignedCustomRoles={userCustomRolesMap.get(user.id) ?? []}
                              usersQueryKey={USERS_QUERY_KEY}
                              onRoleError={setInlineErrorMessage}
                            />
                          </td>
                          <td className="px-4 py-3">
                            <InlineStatusSelect
                              user={user}
                              canEdit={canEditUsers}
                              currentUserId={currentUser?.id ?? ''}
                              usersQueryKey={USERS_QUERY_KEY}
                              onStatusError={setInlineErrorMessage}
                            />
                          </td>
                          <td className="px-4 py-3">
                            <UserActionsMenu
                              user={user}
                              isPending={
                                deactivateMutation.isPending || reactivateMutation.isPending
                              }
                              isOpen={openMenuUserId === user.id}
                              onToggle={handleMenuToggle}
                              onSetPassword={(id) =>
                                setSetPasswordUserId(setPasswordUserId === id ? null : id)
                              }
                              onDeactivate={(id) => deactivateMutation.mutate(id)}
                              onReactivate={(id) => reactivateMutation.mutate(id)}
                              onResetOnboarding={(id) => setResetOnboardingUserId(id)}
                              onIssueToken={(id) => issueTokenMutation.mutate(id)}
                              onRevokeToken={(id) => revokeTokenMutation.mutate(id)}
                              currentUserId={currentUser?.id ?? ''}
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
              ) : (
                /* Mobile card view */
                <ul className="divide-y divide-gray-100">
                  {users.map((user) => (
                    <Fragment key={user.id}>
                      <li className="px-4 py-3" data-testid={`user-card-${user.id}`}>
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-gray-900 truncate">
                              {user.name}
                            </p>
                            <p className="text-xs text-gray-500 truncate">{user.email}</p>
                            <div className="flex flex-col gap-1 mt-1">
                              <InlineRoleSelect
                                user={user}
                                canEdit={canEditUsers}
                                assignedCustomRoles={userCustomRolesMap.get(user.id) ?? []}
                                usersQueryKey={USERS_QUERY_KEY}
                                onRoleError={setInlineErrorMessage}
                              />
                              <InlineStatusSelect
                                user={user}
                                canEdit={canEditUsers}
                                currentUserId={currentUser?.id ?? ''}
                                usersQueryKey={USERS_QUERY_KEY}
                                onStatusError={setInlineErrorMessage}
                              />
                            </div>
                          </div>
                          <div className="shrink-0">
                            <UserActionsMenu
                              user={user}
                              isPending={
                                deactivateMutation.isPending || reactivateMutation.isPending
                              }
                              isOpen={openMobileMenuUserId === user.id}
                              onToggle={handleMobileMenuToggle}
                              onSetPassword={(id) =>
                                setSetMobilePasswordUserId(
                                  setMobilePasswordUserId === id ? null : id,
                                )
                              }
                              onDeactivate={(id) => deactivateMutation.mutate(id)}
                              onReactivate={(id) => reactivateMutation.mutate(id)}
                              onResetOnboarding={(id) => setResetOnboardingUserId(id)}
                              onIssueToken={(id) => issueTokenMutation.mutate(id)}
                              onRevokeToken={(id) => revokeTokenMutation.mutate(id)}
                              currentUserId={currentUser?.id ?? ''}
                              testIdPrefix="mobile-"
                            />
                          </div>
                        </div>
                        {setMobilePasswordUserId === user.id && (
                          <SetPasswordForm
                            userId={user.id}
                            onClose={() => setSetMobilePasswordUserId(null)}
                          />
                        )}
                      </li>
                    </Fragment>
                  ))}
                </ul>
              )}
            </>
          </PagedListLayout>
        )}

        {/* Reset onboarding confirmation (MINCRM-410) */}
        {resetOnboardingUserId && (
          <div
            role="presentation"
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
            data-testid="reset-onboarding-overlay"
            onClick={() => setResetOnboardingUserId(null)}
          >
            <dialog
              open
              aria-modal="true"
              aria-labelledby="reset-onboarding-dialog-title"
              data-testid="reset-onboarding-dialog"
              className="relative w-full max-w-sm mx-4 p-0"
            >
              <div
                role="presentation"
                className="rounded-lg bg-white p-6 shadow-xl"
                onClick={(e) => e.stopPropagation()}
              >
                <h2
                  id="reset-onboarding-dialog-title"
                  className="text-base font-semibold text-gray-900 mb-2"
                >
                  {t('users.resetOnboardingConfirmTitle')}
                </h2>
                <p className="text-sm text-gray-600 mb-6">
                  {t('users.resetOnboardingConfirmMessage', {
                    name: users.find((u) => u.id === resetOnboardingUserId)?.name ?? '',
                  })}
                </p>
                <div className="flex items-center gap-3">
                  <Button
                    type="button"
                    variant="secondary"
                    data-testid="reset-onboarding-confirm"
                    disabled={resetOnboardingMutation.isPending}
                    onClick={() => resetOnboardingMutation.mutate(resetOnboardingUserId)}
                  >
                    {t('users.resetOnboardingConfirmButton')}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    data-testid="reset-onboarding-cancel"
                    disabled={resetOnboardingMutation.isPending}
                    onClick={() => setResetOnboardingUserId(null)}
                  >
                    {t('users.cancel')}
                  </Button>
                </div>
              </div>
            </dialog>
          </div>
        )}

        {/* Reset onboarding success toast (MINCRM-410) */}
        {resetOnboardingSuccessUserId && (
          <div
            role="status"
            data-testid="reset-onboarding-success"
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 rounded-md bg-emerald-50 border border-emerald-200 px-4 py-2 text-sm text-emerald-800 shadow-md"
          >
            {t('users.resetOnboardingSuccess', {
              name: users.find((u) => u.id === resetOnboardingSuccessUserId)?.name ?? '',
            })}
            <button
              type="button"
              className="ms-3 text-emerald-600 hover:text-emerald-800 font-medium"
              data-testid="reset-onboarding-success-dismiss"
              onClick={() => setResetOnboardingSuccessUserId(null)}
              aria-label={t('users.resetOnboardingSuccessDismiss')}
            >
              {t('users.resetOnboardingSuccessDismiss')}
            </button>
          </div>
        )}
        {/* Inline role/status error toast (MINCRM-560, MINCRM-561) */}
        {inlineErrorMessage && (
          <div
            role="alert"
            data-testid="inline-error-toast"
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 rounded-md bg-red-50 border border-red-200 px-4 py-2 text-sm text-red-700 shadow-md"
          >
            {inlineErrorMessage}
            <button
              type="button"
              data-testid="inline-error-dismiss"
              className="ms-3 text-red-500 hover:text-red-700 font-medium"
              onClick={() => setInlineErrorMessage(null)}
              aria-label={t('users.cancel')}
            >
              {t('common.dismiss')}
            </button>
          </div>
        )}

        {/* Issued API token modal — shown exactly once after Issue API Token action (MINCRM-536) */}
        {issuedTokenResult && (
          <div
            role="presentation"
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
            data-testid="api-token-modal-overlay"
            onClick={() => setIssuedTokenResult(null)}
          >
            <dialog
              open
              aria-modal="true"
              aria-labelledby="api-token-dialog-title"
              data-testid="api-token-modal"
              className="relative w-full max-w-lg mx-4 p-0"
            >
              <div
                role="presentation"
                className="rounded-lg bg-white p-6 shadow-xl"
                onClick={(e) => e.stopPropagation()}
              >
                <h2
                  id="api-token-dialog-title"
                  className="text-base font-semibold text-gray-900 mb-2"
                >
                  {t('users.apiTokenIssuedTitle')}
                </h2>
                <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2 mb-4">
                  {t('users.apiTokenCopyLabel')}
                </p>
                <div className="flex items-center gap-2 mb-4">
                  <code
                    data-testid="api-token-value"
                    className="flex-1 rounded bg-gray-50 border border-gray-200 px-3 py-1.5 text-xs text-gray-700 break-all font-mono"
                  >
                    {issuedTokenResult.token}
                  </code>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    data-testid="api-token-copy-button"
                    onClick={() => navigator.clipboard.writeText(issuedTokenResult.token)}
                  >
                    {t('users.copyToken')}
                  </Button>
                </div>
                <Button
                  type="button"
                  data-testid="api-token-modal-close"
                  onClick={() => setIssuedTokenResult(null)}
                >
                  {t('users.done')}
                </Button>
              </div>
            </dialog>
          </div>
        )}
      </main>
    </div>
  );
}
