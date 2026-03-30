/**
 * DealDetailPage component.
 * Displays all fields and metadata for a single deal.
 * Shows linked contacts and the associated account.
 * Supports toggling to an edit form (including owner reassignment) and deleting the deal.
 */

import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import NavBar from '@/components/NavBar.js';
import DealForm from '@/components/DealForm.js';
import { Button } from '@/components/ui/Button.js';
import { getDeal, updateDeal, deleteDeal, DEALS_QUERY_KEY } from '@/api/deals.js';
import { listAccounts } from '@/api/accounts.js';
import { listActiveUsers, ACTIVE_USERS_QUERY_KEY, resolveOwnerName } from '@/api/users.js';
import type { ActiveUser } from '@/api/users.js';
import type { DealFormValues } from '@/components/DealForm.js';
import type { DealResponse } from '@shared/schemas/dealSchema.js';
import type { AccountResponse } from '@shared/schemas/accountSchema.js';

/**
 * Formats a deal value string for display.
 *
 * @param value - Numeric string from the API, or null
 */
function formatDealValue(value: string | null): string {
  if (!value) return '—';
  const num = parseFloat(value);
  return isNaN(num) ? '—' : num.toLocaleString();
}

/**
 * Single deal detail page with view/edit/delete.
 */
export default function DealDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const dealQueryKey = ['deals', id] as const;

  const { data, isLoading, isError } = useQuery({
    queryKey: dealQueryKey,
    queryFn: () => getDeal(id!),
    enabled: Boolean(id),
  });

  const { data: accountsData } = useQuery({
    queryKey: ['accounts'],
    queryFn: () => listAccounts(),
  });

  const { data: activeUsersData } = useQuery({
    queryKey: ACTIVE_USERS_QUERY_KEY,
    queryFn: listActiveUsers,
  });

  const accounts: AccountResponse[] = accountsData?.accounts ?? [];
  const activeUsers: ActiveUser[] = activeUsersData?.users ?? [];

  const updateMutation = useMutation({
    mutationFn: (values: DealFormValues) =>
      updateDeal(id!, {
        name: values.name,
        stage: values.stage as DealResponse['stage'],
        value: values.value !== '' ? parseFloat(values.value) : null,
        close_date: values.close_date || null,
        account_id: values.account_id || null,
        owner_id: values.owner_id || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: dealQueryKey });
      queryClient.invalidateQueries({ queryKey: DEALS_QUERY_KEY });
      setIsEditing(false);
      setUpdateError(null);
    },
    onError: (error: { response?: { data?: { error?: { message?: string } } } }) => {
      setUpdateError(error.response?.data?.error?.message ?? t('errors.generic'));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteDeal(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: DEALS_QUERY_KEY });
      navigate('/deals', { replace: true });
    },
    onError: (error: { response?: { data?: { error?: { message?: string } } } }) => {
      setDeleteError(error.response?.data?.error?.message ?? t('errors.generic'));
    },
  });

  const handleDelete = (): void => {
    if (window.confirm(t('deals.confirmDelete'))) {
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
            {t('deals.loading')}
          </p>
        </main>
      </div>
    );
  }

  if (isError || !data?.deal) {
    return (
      <div className="min-h-screen bg-gray-50">
        <NavBar />
        <main className="max-w-3xl mx-auto px-6 py-8">
          <p role="alert" className="text-sm text-red-600">
            {t('deals.notFound')}
          </p>
          <Link to="/deals" className="mt-4 inline-block text-sm text-indigo-600 hover:underline">
            {t('deals.backToDeals')}
          </Link>
        </main>
      </div>
    );
  }

  const deal = data.deal;
  const linkedContacts = data.contacts ?? [];

  /** Resolves an account_id to its display name */
  function resolveAccountName(accountId: string | null): string {
    if (!accountId) return '—';
    return accounts.find((a) => a.id === accountId)?.name ?? '—';
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <NavBar />
      <main className="max-w-3xl mx-auto px-6 py-8">
        {/* Back link */}
        <Link
          to="/deals"
          data-testid="back-to-deals"
          className="inline-flex items-center text-sm text-indigo-600 hover:underline mb-6"
        >
          ← {t('deals.backToDeals')}
        </Link>

        <div className="flex items-start justify-between mb-6">
          <h1 className="text-2xl font-bold text-gray-900" data-testid="deal-name">
            {deal.name}
          </h1>

          {!isEditing && (
            <div className="flex flex-col items-end gap-2">
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  data-testid="edit-deal-button"
                  onClick={() => setIsEditing(true)}
                >
                  {t('deals.edit')}
                </Button>
                <Button
                  type="button"
                  variant="danger"
                  size="sm"
                  data-testid="delete-deal-button"
                  onClick={handleDelete}
                  disabled={deleteMutation.isPending}
                >
                  {deleteMutation.isPending ? t('deals.deleting') : t('deals.delete')}
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
            <h2 className="text-sm font-semibold text-gray-900 mb-4">{t('deals.saveChanges')}</h2>
            <DealForm
              initialValues={deal}
              accounts={accounts}
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
              submitLabel={t('deals.saveChanges')}
              error={updateError ?? undefined}
            />
          </div>
        ) : (
          <>
            <div className="bg-white border border-gray-200 rounded-lg divide-y divide-gray-100">
              <DetailRow label={t('deals.stageLabel')} value={deal.stage} testId="detail-stage" />
              <DetailRow
                label={t('deals.valueLabel')}
                value={formatDealValue(deal.value)}
                testId="detail-value"
              />
              <DetailRow
                label={t('deals.closeDateLabel')}
                value={deal.close_date ?? '—'}
                testId="detail-close-date"
              />
              <DetailRow
                label={t('deals.accountLabel')}
                value={resolveAccountName(deal.account_id)}
                testId="detail-account"
              />
              {deal.loss_reason && (
                <DetailRow
                  label={t('deals.lossReasonLabel')}
                  value={deal.loss_reason}
                  testId="detail-loss-reason"
                />
              )}
              <DetailRow
                label={t('deals.createdLabel')}
                value={new Date(deal.created_at).toLocaleDateString()}
                testId="detail-created"
              />
              <DetailRow
                label={t('deals.ownerLabel')}
                value={resolveOwnerName(deal.owner_id, activeUsers, t('deals.ownerUnknown'))}
                testId="detail-owner"
              />
            </div>

            {/* Linked contacts */}
            <section className="mt-8" aria-labelledby="linked-contacts-heading">
              <h2
                id="linked-contacts-heading"
                className="text-sm font-semibold text-gray-900 mb-3"
                data-testid="linked-contacts-heading"
              >
                {t('deals.linkedContactsHeading')}
              </h2>
              <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                {linkedContacts.length === 0 ? (
                  <p
                    className="px-6 py-4 text-sm text-gray-400"
                    data-testid="linked-contacts-empty"
                  >
                    {t('deals.linkedContactsEmpty')}
                  </p>
                ) : (
                  <ul className="divide-y divide-gray-100" data-testid="linked-contacts-list">
                    {linkedContacts.map((contact) => (
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
