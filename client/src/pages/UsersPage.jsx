/**
 * UsersPage component — Admin only.
 * Lists all users and provides controls to invite new users,
 * change roles, and deactivate/reactivate accounts.
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import NavBar from '@/components/NavBar.jsx';
import {
  listUsers,
  inviteUser,
  updateUserRole,
  deactivateUser,
  reactivateUser,
} from '@/api/users.js';

/** React Query cache key for the users list */
const USERS_QUERY_KEY = ['users'];

/**
 * Formats a user status string for display using i18n keys.
 *
 * @param {'active'|'invited'|'inactive'} status
 * @param {Function} t
 * @returns {string}
 */
function formatStatus(status, t) {
  const statusMap = {
    active: t('users.statusActive'),
    invited: t('users.statusInvited'),
    inactive: t('users.statusInactive'),
  };
  return statusMap[status] ?? status;
}

/**
 * Invite user form component.
 *
 * @param {{ onSuccess: function }} props
 * @returns {JSX.Element}
 */
function InviteUserForm({ onSuccess }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [formData, setFormData] = useState({ email: '', name: '', role: 'rep' });
  const [lastInviteResult, setLastInviteResult] = useState(null);

  const inviteMutation = useMutation({
    mutationFn: () => inviteUser(formData),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: USERS_QUERY_KEY });
      setLastInviteResult(data);
      setFormData({ email: '', name: '', role: 'rep' });
      onSuccess?.();
    },
  });

  const handleSubmit = (event) => {
    event.preventDefault();
    inviteMutation.mutate();
  };

  const handleChange = (event) => {
    const { name, value } = event.target;
    setFormData((previous) => ({ ...previous, [name]: value }));
  };

  return (
    <div style={{ marginBottom: '2rem' }}>
      <h2 style={{ fontSize: '1rem', marginBottom: '1rem' }}>{t('users.inviteTitle')}</h2>
      <form onSubmit={handleSubmit} style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
        <div>
          <label htmlFor="invite-name" style={{ display: 'block', fontSize: '0.875rem' }}>
            {t('users.nameLabel')}
          </label>
          <input
            id="invite-name"
            name="name"
            type="text"
            required
            value={formData.name}
            onChange={handleChange}
            placeholder={t('users.namePlaceholder')}
          />
        </div>

        <div>
          <label htmlFor="invite-email" style={{ display: 'block', fontSize: '0.875rem' }}>
            {t('users.emailLabel')}
          </label>
          <input
            id="invite-email"
            name="email"
            type="email"
            required
            value={formData.email}
            onChange={handleChange}
          />
        </div>

        <div>
          <label htmlFor="invite-role" style={{ display: 'block', fontSize: '0.875rem' }}>
            {t('users.roleLabel')}
          </label>
          <select
            id="invite-role"
            name="role"
            value={formData.role}
            onChange={handleChange}
          >
            <option value="rep">{t('users.roleRep')}</option>
            <option value="admin">{t('users.roleAdmin')}</option>
          </select>
        </div>

        <div style={{ alignSelf: 'flex-end' }}>
          <button type="submit" disabled={inviteMutation.isPending}>
            {inviteMutation.isPending ? t('users.submitting') : t('users.submitInvite')}
          </button>
        </div>
      </form>

      {inviteMutation.isSuccess && lastInviteResult && (
        <div
          role="status"
          style={{
            marginTop: '1rem',
            padding: '0.75rem',
            backgroundColor: '#f0fdf4',
            border: '1px solid #bbf7d0',
            borderRadius: '4px',
          }}
        >
          <p style={{ marginBottom: '0.5rem' }}>{t('users.inviteSuccess')}</p>
          <p style={{ fontSize: '0.875rem', marginBottom: '0.25rem' }}>
            <strong>{t('users.inviteTokenLabel')}:</strong>
          </p>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <code
              style={{
                display: 'block',
                padding: '0.25rem 0.5rem',
                backgroundColor: '#f3f4f6',
                borderRadius: '4px',
                fontSize: '0.75rem',
                wordBreak: 'break-all',
              }}
            >
              {window.location.origin}{lastInviteResult.setPasswordPath}
            </code>
            <button
              type="button"
              onClick={() =>
                navigator.clipboard.writeText(
                  `${window.location.origin}${lastInviteResult.setPasswordPath}`,
                )
              }
              style={{ flexShrink: 0 }}
            >
              {t('users.copyLink')}
            </button>
          </div>
        </div>
      )}

      {inviteMutation.isError && (
        <p role="alert" style={{ color: '#dc2626', marginTop: '0.5rem', fontSize: '0.875rem' }}>
          {inviteMutation.error?.response?.data?.error?.message ?? t('errors.generic')}
        </p>
      )}
    </div>
  );
}

/**
 * Users management page — lists users and provides admin actions.
 *
 * @returns {JSX.Element}
 */
export default function UsersPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const { data, isLoading, isError } = useQuery({
    queryKey: USERS_QUERY_KEY,
    queryFn: listUsers,
  });

  const roleMutation = useMutation({
    mutationFn: ({ id, role }) => updateUserRole(id, role),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: USERS_QUERY_KEY }),
  });

  const deactivateMutation = useMutation({
    mutationFn: (id) => deactivateUser(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: USERS_QUERY_KEY }),
  });

  const reactivateMutation = useMutation({
    mutationFn: (id) => reactivateUser(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: USERS_QUERY_KEY }),
  });

  const users = data?.users ?? [];

  return (
    <div>
      <NavBar />
      <main style={{ padding: '2rem' }}>
        <h1 style={{ marginBottom: '1.5rem' }}>{t('users.pageTitle')}</h1>

        <InviteUserForm />

        {isLoading && <p aria-busy="true">Loading…</p>}
        {isError && <p role="alert" style={{ color: '#dc2626' }}>{t('errors.generic')}</p>}

        {!isLoading && !isError && (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #e5e7eb', textAlign: 'left' }}>
                <th style={{ padding: '0.5rem' }}>{t('users.columnName')}</th>
                <th style={{ padding: '0.5rem' }}>{t('users.columnEmail')}</th>
                <th style={{ padding: '0.5rem' }}>{t('users.columnRole')}</th>
                <th style={{ padding: '0.5rem' }}>{t('users.columnStatus')}</th>
                <th style={{ padding: '0.5rem' }}>{t('users.columnActions')}</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <td style={{ padding: '0.5rem' }}>{user.name}</td>
                  <td style={{ padding: '0.5rem' }}>{user.email}</td>
                  <td style={{ padding: '0.5rem' }}>
                    {user.role === 'admin' ? t('users.roleAdmin') : t('users.roleRep')}
                  </td>
                  <td style={{ padding: '0.5rem' }}>{formatStatus(user.status, t)}</td>
                  <td style={{ padding: '0.5rem', display: 'flex', gap: '0.5rem' }}>
                    {user.role === 'rep' ? (
                      <button
                        type="button"
                        onClick={() => roleMutation.mutate({ id: user.id, role: 'admin' })}
                        disabled={roleMutation.isPending}
                      >
                        {t('users.actionMakeAdmin')}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => roleMutation.mutate({ id: user.id, role: 'rep' })}
                        disabled={roleMutation.isPending}
                      >
                        {t('users.actionMakeRep')}
                      </button>
                    )}

                    {user.status === 'inactive' ? (
                      <button
                        type="button"
                        onClick={() => reactivateMutation.mutate(user.id)}
                        disabled={reactivateMutation.isPending}
                      >
                        {t('users.actionReactivate')}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => deactivateMutation.mutate(user.id)}
                        disabled={deactivateMutation.isPending}
                      >
                        {t('users.actionDeactivate')}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </main>
    </div>
  );
}
