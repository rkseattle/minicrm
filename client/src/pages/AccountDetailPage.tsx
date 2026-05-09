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
import AttachmentsSection from '@/components/AttachmentsSection.js';
import NotesSection from '@/components/NotesSection.js';
import ChangeHistory from '@/components/ChangeHistory.js';
import { ConnectedTagInput } from '@/components/TagInput.js';
import ConfirmDeleteModal from '@/components/ConfirmDeleteModal.js';
import CustomFieldsSection from '@/components/CustomFieldsSection.js';
import { Button } from '@/components/ui/Button.js';
import { getAccount, updateAccount, deleteAccount, listChildAccounts } from '@/api/accounts.js';
import { listContacts } from '@/api/contacts.js';
import { listActiveUsers, ACTIVE_USERS_QUERY_KEY, resolveOwnerName } from '@/api/users.js';
import { putCustomFieldValues, customFieldValuesQueryKey } from '@/api/customFields.js';
import type { ActiveUser } from '@/api/users.js';
import type { CustomFieldValueInput } from '@shared/schemas/customFieldSchema.js';
import { ACCOUNTS_QUERY_KEY } from '@/pages/AccountsPage.js';
import type { AccountFormValues } from '@/components/AccountForm.js';
import { formatLocalDate } from '@/utils/formatLocalDate.js';

/**
 * Single account detail page with view/edit/delete.
 */
export default function AccountDetailPage() {
  const { t, i18n } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [customFieldValues, setCustomFieldValues] = useState<CustomFieldValueInput[]>([]);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isConfirmDeleteOpen, setIsConfirmDeleteOpen] = useState(false);

  const accountQueryKey = ['accounts', id] as const;
  const linkedContactsQueryKey = ['contacts', 'byAccount', id] as const;
  const childAccountsQueryKey = ['accounts', id, 'children'] as const;

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

  const { data: childAccountsData } = useQuery({
    queryKey: childAccountsQueryKey,
    queryFn: () => listChildAccounts(id!),
    enabled: Boolean(id),
  });

  // Fetch parent account name so the edit form can display it (MINCRM-184)
  const parentAccountQueryKey = ['accounts', data?.account?.parent_account_id] as const;
  const { data: parentAccountData } = useQuery({
    queryKey: parentAccountQueryKey,
    queryFn: () => getAccount(data!.account.parent_account_id!),
    enabled: Boolean(data?.account?.parent_account_id),
  });

  const { data: activeUsersData } = useQuery({
    queryKey: ACTIVE_USERS_QUERY_KEY,
    queryFn: listActiveUsers,
  });

  const activeUsers: ActiveUser[] = activeUsersData?.users ?? [];
  const childAccounts = childAccountsData?.accounts ?? [];

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
        account_type: values.account_type || null,
        parent_account_id: values.parent_account_id || null,
      }),
    onSuccess: async () => {
      if (customFieldValues.length > 0) {
        await putCustomFieldValues('account', id!, customFieldValues);
        queryClient.invalidateQueries({ queryKey: customFieldValuesQueryKey('account', id!) });
      }
      queryClient.invalidateQueries({ queryKey: accountQueryKey });
      queryClient.invalidateQueries({ queryKey: ACCOUNTS_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: linkedContactsQueryKey });
      queryClient.invalidateQueries({ queryKey: childAccountsQueryKey });
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
    setIsConfirmDeleteOpen(true);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <NavBar />
        <main className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
          <p aria-busy="true" className="text-sm text-gray-500">
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
        <main className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
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
      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
        {/* Back link — MINCRM-113, MINCRM-115 */}
        <Link
          to="/accounts"
          data-testid="back-to-accounts"
          aria-label={t('common.backToAccounts')}
          className="inline-flex items-center gap-1 text-sm text-indigo-600 hover:underline mb-6"
        >
          <svg
            aria-hidden="true"
            className="w-4 h-4 rtl:rotate-180"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          {t('common.backToAccounts')}
        </Link>

        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-6">
          <h1 className="text-2xl font-bold text-gray-900" data-testid="account-name">
            {account.name}
          </h1>

          {!isEditing && (
            <div className="flex flex-col items-start sm:items-end gap-2 sm:shrink-0">
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
          <>
            <div className="bg-white border border-gray-200 rounded-lg p-6">
              <h2 className="text-sm font-semibold text-gray-900 mb-4">
                {t('accounts.saveChanges')}
              </h2>
              <AccountForm
                initialValues={account}
                initialContactIds={linkedContactsData?.data.map((c) => c.id) ?? []}
                accountId={id}
                users={activeUsers}
                initialParentAccountName={parentAccountData?.account?.name}
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
            {id && (
              <CustomFieldsSection
                entityType="account"
                recordId={id}
                isEditing={true}
                onValuesChange={setCustomFieldValues}
              />
            )}
          </>
        ) : (
          <>
            <div className="bg-white border border-gray-200 rounded-lg divide-y divide-gray-100">
              {account.account_type && (
                <div className="px-6 py-4 flex flex-col md:flex-row md:items-start md:gap-4">
                  <span className="w-full md:w-36 md:shrink-0 text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1 md:mb-0 md:pt-0.5">
                    {t('accounts.accountTypeLabel')}
                  </span>
                  <span
                    className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-indigo-100 text-indigo-800 whitespace-nowrap shrink-0"
                    data-testid="detail-account-type"
                  >
                    {t(`accounts.accountType.${account.account_type}`)}
                  </span>
                </div>
              )}
              {account.parent_account_id && (
                <div className="px-6 py-4 flex flex-col md:flex-row md:items-start md:gap-4">
                  <span className="w-full md:w-36 md:shrink-0 text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1 md:mb-0 md:pt-0.5">
                    {t('accounts.parentAccountLabel')}
                  </span>
                  <Link
                    to={`/accounts/${account.parent_account_id}`}
                    data-testid="detail-parent-account"
                    className="text-sm text-indigo-600 hover:underline"
                  >
                    {t('accounts.parentAccountLink')}
                  </Link>
                </div>
              )}
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
                value={formatLocalDate(account.created_at, i18n.language)}
                testId="detail-created"
              />
              <DetailRow
                label={t('accounts.ownerLabel')}
                value={resolveOwnerName(account.owner_id, activeUsers, t('accounts.ownerUnknown'))}
                testId="detail-owner"
              />
            </div>

            {id && <CustomFieldsSection entityType="account" recordId={id} isEditing={false} />}

            {/* Tags (MINCRM-186) */}
            {id && (
              <section
                className="mt-8"
                aria-labelledby="account-tags-heading"
                data-testid="account-tags-section"
              >
                <h2
                  id="account-tags-heading"
                  className="text-sm font-semibold text-gray-900 mb-3"
                  data-testid="account-tags-heading"
                >
                  {t('tags.sectionTitle')}
                </h2>
                <ConnectedTagInput
                  entityId={id}
                  entityType="account"
                  entityQueryKey={ACCOUNTS_QUERY_KEY}
                />
              </section>
            )}

            {/* Activity timeline */}
            <ActivityTimeline accountId={id} />

            {/* Attachments (MINCRM-167) */}
            {id && <AttachmentsSection recordType="account" recordId={id} />}

            {/* Notes (MINCRM-352) */}
            {id && <NotesSection entityType="account" entityId={id} />}

            {/* Change history (MINCRM-171) */}
            {id && <ChangeHistory recordType="account" recordId={id} />}

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
                  <p aria-busy="true" className="px-6 py-4 text-sm text-gray-500">
                    {t('accounts.loading')}
                  </p>
                ) : !linkedContactsData || linkedContactsData.data.length === 0 ? (
                  <p
                    className="px-6 py-4 text-sm text-gray-500"
                    data-testid="linked-contacts-empty"
                  >
                    {t('accounts.linkedContactsEmpty')}
                  </p>
                ) : (
                  <ul className="divide-y divide-gray-100" data-testid="linked-contacts-list">
                    {linkedContactsData.data.map((contact) => (
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

            {/* Subsidiary accounts (MINCRM-184) */}
            {childAccounts.length > 0 && (
              <section className="mt-8" aria-labelledby="subsidiaries-heading">
                <h2
                  id="subsidiaries-heading"
                  className="text-sm font-semibold text-gray-900 mb-3"
                  data-testid="subsidiary-accounts-heading"
                >
                  {t('accounts.subsidiaryAccountsHeading')}
                </h2>
                <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                  <ul className="divide-y divide-gray-100" data-testid="subsidiary-accounts-list">
                    {childAccounts.map((child) => (
                      <li key={child.id} className="px-6 py-3 flex items-center gap-3">
                        <Link
                          to={`/accounts/${child.id}`}
                          data-testid={`subsidiary-account-${child.id}`}
                          className="text-sm font-medium text-indigo-600 hover:underline"
                        >
                          {child.name}
                        </Link>
                        {child.account_type && (
                          <span className="text-xs px-2 py-0.5 rounded bg-indigo-100 text-indigo-800 whitespace-nowrap shrink-0">
                            {t(`accounts.accountType.${child.account_type}`)}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              </section>
            )}
          </>
        )}
      </main>

      {/* Delete confirmation modal — MINCRM-107 */}
      <ConfirmDeleteModal
        isOpen={isConfirmDeleteOpen}
        message={t('accounts.confirmDelete')}
        isDeleting={deleteMutation.isPending}
        onConfirm={() => {
          setDeleteError(null);
          deleteMutation.mutate();
        }}
        onCancel={() => setIsConfirmDeleteOpen(false)}
      />
    </div>
  );
}

/** Renders a labelled read-only row in the detail card, stacked on mobile. */
function DetailRow({ label, value, testId }: { label: string; value: string; testId: string }) {
  return (
    <div className="px-6 py-4 flex flex-col md:flex-row md:items-start md:gap-4">
      <span className="w-full md:w-36 md:shrink-0 text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1 md:mb-0 md:pt-0.5">
        {label}
      </span>
      <span className="text-sm text-gray-900" data-testid={testId}>
        {value}
      </span>
    </div>
  );
}
