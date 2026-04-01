/**
 * AccountDetailPage component.
 * Displays all fields and metadata for a single account.
 * Supports toggling to an edit form (including owner reassignment) and deleting the account.
 */

import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import NavBar from '@/components/NavBar.js';
import AccountForm from '@/components/AccountForm.js';
import ActivityTimeline from '@/components/ActivityTimeline.js';
import { Button } from '@/components/ui/Button.js';
import { getAccount, updateAccount, deleteAccount } from '@/api/accounts.js';
import { listContacts } from '@/api/contacts.js';
import { listActiveUsers, ACTIVE_USERS_QUERY_KEY, resolveOwnerName } from '@/api/users.js';
import type { ActiveUser } from '@/api/users.js';
import { ACCOUNTS_QUERY_KEY } from '@/pages/AccountsPage.js';
import type { AccountFormValues } from '@/components/AccountForm.js';

/**
 * Single account detail page with view/edit/delete.
 */
export default function AccountDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const accountQueryKey = ['accounts', id] as const;
  const linkedContactsQueryKey = ['contacts', 'byAccount', id] as const;

  const { data, isLoading, isError } = useQuery({
    queryKey: accountQueryKey,
    queryFn: () => getAccount(id!),
    enabled: Boolean(id),
  });

  const { data: linkedContactsData, isLoading: linkedContactsLoading } = useQuery({
    queryKey: linkedContactsQueryKey,
    queryFn: () => listContacts({ accountId: id! }),
    enabled: Boolean(id),
  });

  const { data: activeUsersData } = useQuery({
    queryKey: ACTIVE_USERS_QUERY_KEY,
    queryFn: listActiveUsers,
  });

  const activeUsers: ActiveUser[] = activeUsersData?.users ?? [];

  const updateMutation = useMutation({
    mutationFn: (values: AccountFormValues) =>
      updateAccount(id!, {
        name: values.name,
        industry: values.industry || undefined,
        website: values.website || undefined,
        employee_range: values.employee_range || undefined,
        revenue_range: values.revenue_range || undefined,
        owner_id: values.owner_id || undefined,
        contact_ids: values.contact_ids,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: accountQueryKey });
      queryClient.invalidateQueries({ queryKey: ACCOUNTS_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: linkedContactsQueryKey });
      setIsEditing(false);
      setUpdateError(null);
    },
    onError: (error: { response?: { data?: { error?: { message?: string } } } }) => {
      setUpdateError(error.response?.data?.error?.message ?? t('errors.generic'));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteAccount(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ACCOUNTS_QUERY_KEY });
      navigate('/accounts', { replace: true });
    },
    onError: (error: { response?: { data?: { error?: { message?: string } } } }) => {
      setDeleteError(error.response?.data?.error?.message ?? t('errors.generic'));
    },
  });

  const handleDelete = (): void => {
    if (window.confirm(t('accounts.confirmDelete'))) {
      setDeleteError(null);
      deleteMutation.mutate();
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <NavBar />
        <main className="max-w-3xl mx-auto px-6 py-8">
          <p aria-busy="true" className="text-sm text-gray-400">
            {t('accounts.loading')}
          </p>
        </main>
      </div>
    );
  }

  if (isError || !data?.account) {
    return (
      <div className="min-h-screen bg-gray-50">
        <NavBar />
        <main className="max-w-3xl mx-auto px-6 py-8">
          <p role="alert" className="text-sm text-red-600">
            {t('accounts.notFound')}
          </p>
          <Link
            to="/accounts"
            className="mt-4 inline-block text-sm text-indigo-600 hover:underline"
          >
            {t('accounts.backToAccounts')}
          </Link>
        </main>
      </div>
    );
  }

  const account = data.account;

  return (
    <div className="min-h-screen bg-gray-50">
      <NavBar />
      <main className="max-w-3xl mx-auto px-6 py-8">
        {/* Back link */}
        <Link
          to="/accounts"
          data-testid="back-to-accounts"
          className="inline-flex items-center text-sm text-indigo-600 hover:underline mb-6"
        >
          ← {t('accounts.backToAccounts')}
        </Link>

        <div className="flex items-start justify-between mb-6">
          <h1 className="text-2xl font-bold text-gray-900" data-testid="account-name">
            {account.name}
          </h1>

          {!isEditing && (
            <div className="flex flex-col items-end gap-2">
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  data-testid="edit-account-button"
                  onClick={() => setIsEditing(true)}
                  disabled={linkedContactsLoading}
                >
                  {t('accounts.edit')}
                </Button>
                <Button
                  type="button"
                  variant="danger"
                  size="sm"
                  data-testid="delete-account-button"
                  onClick={handleDelete}
                  disabled={deleteMutation.isPending}
                >
                  {deleteMutation.isPending ? t('accounts.deleting') : t('accounts.delete')}
                </Button>
              </div>
              {deleteError && (
                <p role="alert" className="text-xs text-red-600" data-testid="delete-error">
                  {deleteError}
                </p>
              )}
            </div>
          )}
        </div>

        {isEditing ? (
          <div className="bg-white border border-gray-200 rounded-lg p-6">
            <h2 className="text-sm font-semibold text-gray-900 mb-4">
              {t('accounts.saveChanges')}
            </h2>
            <AccountForm
              initialValues={account}
              initialContactIds={linkedContactsData?.contacts.map((c) => c.id) ?? []}
              users={activeUsers}
              onSubmit={(values) => {
                setUpdateError(null);
                updateMutation.mutate(values);
              }}
              onCancel={() => {
                setIsEditing(false);
                setUpdateError(null);
              }}
              isSubmitting={updateMutation.isPending}
              submitLabel={t('accounts.saveChanges')}
              error={updateError ?? undefined}
            />
          </div>
        ) : (
          <>
            <div className="bg-white border border-gray-200 rounded-lg divide-y divide-gray-100">
              <DetailRow
                label={t('accounts.industryLabel')}
                value={account.industry ?? '—'}
                testId="detail-industry"
              />
              <DetailRow
                label={t('accounts.websiteLabel')}
                value={account.website ?? '—'}
                testId="detail-website"
              />
              <DetailRow
                label={t('accounts.employeeRangeLabel')}
                value={account.employee_range ?? '—'}
                testId="detail-employee-range"
              />
              <DetailRow
                label={t('accounts.revenueRangeLabel')}
                value={account.revenue_range ?? '—'}
                testId="detail-revenue-range"
              />
              <DetailRow
                label={t('accounts.createdLabel')}
                value={new Date(account.created_at).toLocaleDateString()}
                testId="detail-created"
              />
              <DetailRow
                label={t('accounts.ownerLabel')}
                value={resolveOwnerName(account.owner_id, activeUsers, t('accounts.ownerUnknown'))}
                testId="detail-owner"
              />
            </div>

            {/* Activity timeline */}
            <ActivityTimeline accountId={id} />

            {/* Linked contacts */}
            <section className="mt-8" aria-labelledby="linked-contacts-heading">
              <h2
                id="linked-contacts-heading"
                className="text-sm font-semibold text-gray-900 mb-3"
                data-testid="linked-contacts-heading"
              >
                {t('accounts.linkedContactsHeading')}
              </h2>
              <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                {linkedContactsLoading ? (
                  <p aria-busy="true" className="px-6 py-4 text-sm text-gray-400">
                    {t('accounts.loading')}
                  </p>
                ) : !linkedContactsData || linkedContactsData.contacts.length === 0 ? (
                  <p
                    className="px-6 py-4 text-sm text-gray-400"
                    data-testid="linked-contacts-empty"
                  >
                    {t('accounts.linkedContactsEmpty')}
                  </p>
                ) : (
                  <ul className="divide-y divide-gray-100" data-testid="linked-contacts-list">
                    {linkedContactsData.contacts.map((contact) => (
                      <li key={contact.id} className="px-6 py-3 flex items-center gap-3">
                        <Link
                          to={`/contacts/${contact.id}`}
                          data-testid={`linked-contact-${contact.id}`}
                          className="text-sm font-medium text-indigo-600 hover:underline"
                        >
                          {contact.first_name} {contact.last_name}
                        </Link>
                        {contact.title && (
                          <span className="text-sm text-gray-500">{contact.title}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}

/** Renders a labelled read-only row in the detail card. */
function DetailRow({ label, value, testId }: { label: string; value: string; testId: string }) {
  return (
    <div className="px-6 py-4 flex items-start gap-4">
      <span className="w-36 shrink-0 text-xs font-semibold text-gray-500 uppercase tracking-wide pt-0.5">
        {label}
      </span>
      <span className="text-sm text-gray-900" data-testid={testId}>
        {value}
      </span>
    </div>
  );
}
