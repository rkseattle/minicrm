/**
 * DealDetailPage component.
 * Displays all fields and metadata for a single deal.
 * Shows linked contacts and the associated account.
 * Supports toggling to an edit form (including owner reassignment) and deleting the deal.
 * Supports linking and unlinking contacts from the deal.
 */

import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import NavBar from '@/components/NavBar.js';
import DealForm from '@/components/DealForm.js';
import ActivityTimeline from '@/components/ActivityTimeline.js';
import CloseDealModal from '@/components/CloseDealModal.js';
import { Button } from '@/components/ui/Button.js';
import { Select } from '@/components/ui/Select.js';
import {
  getDeal,
  updateDeal,
  deleteDeal,
  linkContactToDeal,
  unlinkContactFromDeal,
  DEALS_QUERY_KEY,
} from '@/api/deals.js';
import { WIN_LOSS_REPORT_QUERY_KEY } from '@/api/reports.js';
import { listAccounts } from '@/api/accounts.js';
import { listContacts } from '@/api/contacts.js';
import { listActiveUsers, ACTIVE_USERS_QUERY_KEY, resolveOwnerName } from '@/api/users.js';
import { PAGINATION_MAX_LIMIT } from '@shared/schemas/paginationSchema.js';
import type { ActiveUser } from '@/api/users.js';
import type { DealFormValues } from '@/components/DealForm.js';
import type { DealResponse, PipelineStage } from '@shared/schemas/dealSchema.js';
import type { AccountResponse } from '@shared/schemas/accountSchema.js';
import type { DealContact } from '@/api/deals.js';
import { PIPELINE_STAGE_I18N_KEY } from '@/utils/pipelineStageI18nKey.js';
import { formatLocalDate } from '@/utils/formatLocalDate.js';

/**
 * Formats a deal value as a USD currency string using the active locale.
 *
 * @param value - Numeric string from the API, or null
 * @param locale - BCP 47 locale tag from i18next (e.g. "en", "de", "zh-Hans")
 * @returns Locale-formatted USD currency string, or '—' when value is absent
 */
function formatDealValue(value: string | null, locale: string): string {
  if (!value) return '—';
  const num = parseFloat(value);
  return isNaN(num)
    ? '—'
    : new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD' }).format(num);
}

/**
 * Single deal detail page with view/edit/delete and contact link/unlink.
 */
export default function DealDetailPage() {
  const { t, i18n } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [unlinkError, setUnlinkError] = useState<string | null>(null);
  const [selectedContactId, setSelectedContactId] = useState('');

  /** Close deal modal state — null when closed */
  const [pendingClose, setPendingClose] = useState<{
    stage: 'Closed Won' | 'Closed Lost';
    /** Form values captured at the moment the terminal stage was selected */
    formValues: DealFormValues;
  } | null>(null);
  const [closeError, setCloseError] = useState<string | null>(null);

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

  const { data: allContactsData } = useQuery({
    queryKey: ['contacts'],
    queryFn: () => listContacts({ limit: PAGINATION_MAX_LIMIT }),
  });

  const accounts: AccountResponse[] = accountsData?.data ?? [];
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
      queryClient.invalidateQueries({ queryKey: WIN_LOSS_REPORT_QUERY_KEY });
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
      queryClient.invalidateQueries({ queryKey: WIN_LOSS_REPORT_QUERY_KEY });
      navigate('/deals', { replace: true });
    },
    onError: (error: { response?: { data?: { error?: { message?: string } } } }) => {
      setDeleteError(error.response?.data?.error?.message ?? t('errors.generic'));
    },
  });

  const linkMutation = useMutation({
    mutationFn: (contactId: string) => linkContactToDeal(id!, contactId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: dealQueryKey });
      setSelectedContactId('');
      setLinkError(null);
    },
    onError: (error: { response?: { data?: { error?: { message?: string } } } }) => {
      setLinkError(error.response?.data?.error?.message ?? t('errors.generic'));
    },
  });

  const unlinkMutation = useMutation({
    mutationFn: (contactId: string) => unlinkContactFromDeal(id!, contactId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: dealQueryKey });
      setUnlinkError(null);
    },
    onError: (error: { response?: { data?: { error?: { message?: string } } } }) => {
      setUnlinkError(error.response?.data?.error?.message ?? t('errors.generic'));
    },
  });

  const closeMutation = useMutation({
    mutationFn: ({
      stage,
      close_date,
      loss_reason,
      formValues,
    }: {
      stage: 'Closed Won' | 'Closed Lost';
      close_date: string | null;
      loss_reason: string | null;
      formValues: DealFormValues;
    }) =>
      updateDeal(id!, {
        name: formValues.name,
        stage,
        value: formValues.value !== '' ? parseFloat(formValues.value) : null,
        close_date,
        loss_reason,
        account_id: formValues.account_id || null,
        owner_id: formValues.owner_id || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: dealQueryKey });
      queryClient.invalidateQueries({ queryKey: DEALS_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: WIN_LOSS_REPORT_QUERY_KEY });
      setPendingClose(null);
      setCloseError(null);
      setIsEditing(false);
    },
    onError: (error: { response?: { data?: { error?: { message?: string } } } }) => {
      setCloseError(error.response?.data?.error?.message ?? t('errors.generic'));
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
        <main className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
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
        <main className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
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
  const linkedContacts: DealContact[] = data.contacts ?? [];

  /** Set of contact IDs already linked to this deal */
  const linkedContactIds = new Set(linkedContacts.map((c) => c.id));

  /** Contacts available to link (exclude already-linked ones) */
  const linkableContacts = (allContactsData?.data ?? []).filter((c) => !linkedContactIds.has(c.id));

  /** Resolves an account_id to its display name */
  function resolveAccountName(accountId: string | null): string {
    if (!accountId) return '—';
    return accounts.find((a) => a.id === accountId)?.name ?? '—';
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <NavBar />
      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
        {/* Back link */}
        <Link
          to="/deals"
          data-testid="back-to-deals"
          className="inline-flex items-center text-sm text-indigo-600 hover:underline mb-6"
        >
          ← {t('deals.backToDeals')}
        </Link>

        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-6">
          <h1 className="text-2xl font-bold text-gray-900" data-testid="deal-name">
            {deal.name}
          </h1>

          {!isEditing && (
            <div className="flex flex-col items-start sm:items-end gap-2 sm:shrink-0">
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
              onCloseRequested={(stage, formValues) => {
                setCloseError(null);
                setPendingClose({ stage, formValues });
              }}
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
              <DetailRow
                label={t('deals.stageLabel')}
                value={t(`pipeline.stages.${PIPELINE_STAGE_I18N_KEY[deal.stage as PipelineStage]}`)}
                testId="detail-stage"
              />
              <DetailRow
                label={t('deals.valueLabel')}
                value={formatDealValue(deal.value, i18n.language)}
                testId="detail-value"
              />
              <DetailRow
                label={t('deals.closeDateLabel')}
                value={formatLocalDate(deal.close_date, i18n.language)}
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
                value={formatLocalDate(deal.created_at, i18n.language)}
                testId="detail-created"
              />
              <DetailRow
                label={t('deals.ownerLabel')}
                value={resolveOwnerName(deal.owner_id, activeUsers, t('deals.ownerUnknown'))}
                testId="detail-owner"
              />
            </div>

            {/* Activity timeline */}
            <ActivityTimeline dealId={id} />

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
                      <li
                        key={contact.id}
                        className="px-6 py-3 flex items-center justify-between gap-3"
                      >
                        <div className="flex items-center gap-3">
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
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          data-testid={`unlink-contact-${contact.id}`}
                          onClick={() => unlinkMutation.mutate(contact.id)}
                          disabled={unlinkMutation.isPending}
                        >
                          {unlinkMutation.isPending ? t('deals.unlinking') : t('deals.unlink')}
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {unlinkError && (
                <p
                  role="alert"
                  className="mt-2 text-xs text-red-600"
                  data-testid="unlink-contact-error"
                >
                  {unlinkError}
                </p>
              )}

              {/* Link contact form */}
              {linkableContacts.length > 0 && (
                <div className="mt-3 flex items-center gap-2" data-testid="link-contact-form">
                  <Select
                    id="link-contact-select"
                    data-testid="link-contact-select"
                    value={selectedContactId}
                    onChange={(e) => setSelectedContactId(e.target.value)}
                    className="flex-1"
                  >
                    <option value="">{t('deals.selectContactToLink')}</option>
                    {linkableContacts.map((contact) => (
                      <option key={contact.id} value={contact.id}>
                        {contact.first_name} {contact.last_name}
                      </option>
                    ))}
                  </Select>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    data-testid="link-contact-button"
                    disabled={!selectedContactId || linkMutation.isPending}
                    onClick={() => {
                      if (selectedContactId) linkMutation.mutate(selectedContactId);
                    }}
                  >
                    {linkMutation.isPending ? t('deals.linking') : t('deals.linkContact')}
                  </Button>
                </div>
              )}

              {linkError && (
                <p
                  role="alert"
                  className="mt-2 text-xs text-red-600"
                  data-testid="link-contact-error"
                >
                  {linkError}
                </p>
              )}
            </section>
          </>
        )}
      </main>

      {pendingClose && (
        <CloseDealModal
          isOpen={true}
          targetStage={pendingClose.stage}
          initialCloseDate={new Date().toISOString().split('T')[0]}
          isSubmitting={closeMutation.isPending}
          error={closeError ?? undefined}
          onConfirm={(closeDate, lossReason) => {
            closeMutation.mutate({
              stage: pendingClose.stage,
              close_date: closeDate || null,
              loss_reason: lossReason || null,
              formValues: pendingClose.formValues,
            });
          }}
          onCancel={() => {
            setPendingClose(null);
            setCloseError(null);
          }}
        />
      )}
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
