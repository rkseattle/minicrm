/**
 * LeadDetailPage component.
 * Displays all fields and status history for a single lead.
 * Supports editing, deletion, inline status update, and lead conversion. (MINCRM-173, 174, 175)
 */

import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import NavBar from '@/components/NavBar.js';
import LeadForm from '@/components/LeadForm.js';
import ConvertLeadModal from '@/components/ConvertLeadModal.js';
import ConfirmDeleteModal from '@/components/ConfirmDeleteModal.js';
import NotesSection from '@/components/NotesSection.js';
import { Button } from '@/components/ui/Button.js';
import { getLead, updateLead, deleteLead, getLeadStatusHistory } from '@/api/leads.js';
import { listActiveUsers, ACTIVE_USERS_QUERY_KEY, resolveOwnerName } from '@/api/users.js';
import type { ActiveUser } from '@/api/users.js';
import type { LeadFormValues } from '@/components/LeadForm.js';
import { LEADS_QUERY_KEY } from '@/pages/LeadsPage.js';
import { useAuth } from '@/hooks/useAuth.js';

/** Tailwind badge classes by status */
const STATUS_BADGE: Record<string, string> = {
  New: 'bg-blue-100 text-blue-800',
  Contacted: 'bg-yellow-100 text-yellow-800',
  Qualified: 'bg-green-100 text-green-800',
  Disqualified: 'bg-gray-100 text-gray-600',
};

/**
 * Single lead detail page with view/edit/delete/convert.
 */
export default function LeadDetailPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [isEditing, setIsEditing] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [isConfirmDeleteOpen, setIsConfirmDeleteOpen] = useState(false);
  const [isConvertModalOpen, setIsConvertModalOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const leadQueryKey = ['leads', id] as const;

  const { data, isLoading, isError } = useQuery({
    queryKey: leadQueryKey,
    queryFn: () => getLead(id!),
    enabled: Boolean(id),
  });

  const { data: historyData } = useQuery({
    queryKey: ['leads', id, 'status-history'],
    queryFn: () => getLeadStatusHistory(id!),
    enabled: Boolean(id),
  });

  const { data: activeUsersData } = useQuery({
    queryKey: ACTIVE_USERS_QUERY_KEY,
    queryFn: listActiveUsers,
  });
  const activeUsers: ActiveUser[] = activeUsersData?.users ?? [];

  const updateMutation = useMutation({
    mutationFn: (values: LeadFormValues) =>
      updateLead(id!, {
        first_name: values.first_name,
        last_name: values.last_name || undefined,
        email: values.email,
        phone: values.phone || undefined,
        company_name: values.company_name || undefined,
        lead_source: (values.lead_source as LeadFormValues['lead_source']) || undefined,
        notes: values.notes || undefined,
        owner_id: values.owner_id || undefined,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: leadQueryKey });
      void queryClient.invalidateQueries({ queryKey: LEADS_QUERY_KEY });
      setIsEditing(false);
      setUpdateError(null);
    },
    onError: (error: { response?: { data?: { error?: { message?: string } } } }) => {
      setUpdateError(error.response?.data?.error?.message ?? t('errors.generic'));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteLead(id!),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: LEADS_QUERY_KEY });
      navigate('/leads', { replace: true });
    },
    onError: (error: { response?: { data?: { error?: { message?: string } } } }) => {
      setDeleteError(error.response?.data?.error?.message ?? t('errors.generic'));
    },
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <NavBar />
        <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
          <p aria-busy="true" className="text-sm text-gray-500">
            {t('leads.loading')}
          </p>
        </main>
      </div>
    );
  }

  if (isError || !data?.lead) {
    return (
      <div className="min-h-screen bg-gray-50">
        <NavBar />
        <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
          <p role="alert" className="text-sm text-red-600">
            {t('leads.notFound')}
          </p>
          <Link to="/leads" className="mt-4 inline-block text-sm text-indigo-600 hover:underline">
            {t('leads.backToLeads')}
          </Link>
        </main>
      </div>
    );
  }

  const lead = data.lead;
  const history = historyData?.history ?? [];
  const isConverted = Boolean(lead.converted_at);
  const canConvert = !isConverted && lead.status !== 'Disqualified';

  return (
    <div className="min-h-screen bg-gray-50">
      <NavBar />
      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        {/* Back link */}
        <Link
          to="/leads"
          data-testid="back-to-leads"
          className="mb-6 inline-flex items-center gap-1 text-sm text-indigo-600 hover:underline"
        >
          <svg
            aria-hidden="true"
            className="h-4 w-4 rtl:rotate-180"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          {t('leads.backToLeads')}
        </Link>

        {/* Header */}
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900" data-testid="lead-name">
              {lead.first_name}
              {lead.last_name ? ` ${lead.last_name}` : ''}
            </h1>
            <div className="mt-1 flex items-center gap-2">
              {isConverted ? (
                <span
                  className="inline-flex items-center rounded-full bg-purple-100 px-2.5 py-0.5 text-xs font-medium text-purple-800 whitespace-nowrap shrink-0"
                  data-testid="lead-converted-badge"
                >
                  {t('leads.statusConverted')}
                </span>
              ) : (
                <span
                  className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap shrink-0 ${STATUS_BADGE[lead.status] ?? 'bg-gray-100 text-gray-600'}`}
                  data-testid="lead-status-badge"
                >
                  {t(`leads.status${lead.status}`)}
                </span>
              )}
            </div>
          </div>

          {!isEditing && (
            <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
              {canConvert && (
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  data-testid="convert-lead-button"
                  onClick={() => setIsConvertModalOpen(true)}
                >
                  {t('leads.convertLead')}
                </Button>
              )}
              <Button
                type="button"
                variant="secondary"
                size="sm"
                data-testid="edit-lead-button"
                onClick={() => setIsEditing(true)}
              >
                {t('leads.edit')}
              </Button>
              <Button
                type="button"
                variant="danger"
                size="sm"
                data-testid="delete-lead-button"
                onClick={() => setIsConfirmDeleteOpen(true)}
                disabled={deleteMutation.isPending}
              >
                {deleteMutation.isPending ? t('leads.deleting') : t('leads.delete')}
              </Button>
              {deleteError && (
                <p role="alert" className="text-xs text-red-600" data-testid="delete-error">
                  {deleteError}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Edit form */}
        {isEditing && (
          <div className="mb-6 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
            {updateError && (
              <p className="mb-4 text-sm text-red-600" role="alert">
                {updateError}
              </p>
            )}
            <LeadForm
              activeUsers={activeUsers}
              isAdmin={isAdmin}
              initialValues={{
                first_name: lead.first_name,
                last_name: lead.last_name ?? '',
                email: lead.email,
                phone: lead.phone ?? '',
                company_name: lead.company_name ?? '',
                lead_source: (lead.lead_source ?? '') as LeadFormValues['lead_source'],
                notes: lead.notes ?? '',
                owner_id: lead.owner_id,
              }}
              onSubmit={(values) => updateMutation.mutate(values)}
              isSubmitting={updateMutation.isPending}
              onCancel={() => {
                setIsEditing(false);
                setUpdateError(null);
              }}
            />
          </div>
        )}

        {/* Detail fields */}
        {!isEditing && (
          <div className="mb-6 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
            <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <dt className="text-xs font-medium uppercase text-gray-500">
                  {t('leads.emailLabel')}
                </dt>
                <dd
                  className="mt-1 text-sm text-gray-900 whitespace-nowrap"
                  data-testid="lead-email"
                >
                  {lead.email}
                </dd>
              </div>
              {lead.phone && (
                <div>
                  <dt className="text-xs font-medium uppercase text-gray-500">
                    {t('leads.phoneLabel')}
                  </dt>
                  <dd className="mt-1 text-sm text-gray-900 whitespace-nowrap">{lead.phone}</dd>
                </div>
              )}
              {lead.company_name && (
                <div>
                  <dt className="text-xs font-medium uppercase text-gray-500">
                    {t('leads.companyLabel')}
                  </dt>
                  <dd className="mt-1 text-sm text-gray-900">{lead.company_name}</dd>
                </div>
              )}
              {lead.lead_source && (
                <div>
                  <dt className="text-xs font-medium uppercase text-gray-500">
                    {t('leads.sourceLabel')}
                  </dt>
                  <dd className="mt-1 text-sm text-gray-900">
                    {t(`leads.source${lead.lead_source.replace(/\s+/g, '')}`)}
                  </dd>
                </div>
              )}
              {lead.disqualification_reason && (
                <div className="sm:col-span-2">
                  <dt className="text-xs font-medium uppercase text-gray-500">
                    {t('leads.disqualificationReasonLabel')}
                  </dt>
                  <dd className="mt-1 text-sm text-gray-900">{lead.disqualification_reason}</dd>
                </div>
              )}
              {lead.notes && (
                <div className="sm:col-span-2">
                  <dt className="text-xs font-medium uppercase text-gray-500">
                    {t('leads.notesLabel')}
                  </dt>
                  <dd className="mt-1 whitespace-pre-wrap text-sm text-gray-900">{lead.notes}</dd>
                </div>
              )}
              <div>
                <dt className="text-xs font-medium uppercase text-gray-500">
                  {t('leads.ownerLabel')}
                </dt>
                <dd className="mt-1 text-sm text-gray-900">
                  {resolveOwnerName(lead.owner_id, activeUsers, t('leads.ownerUnknown'))}
                </dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase text-gray-500">
                  {t('leads.createdLabel')}
                </dt>
                <dd className="mt-1 text-sm text-gray-900 whitespace-nowrap">
                  {new Date(lead.created_at).toLocaleDateString()}
                </dd>
              </div>
            </dl>

            {/* Converted links (MINCRM-175) */}
            {isConverted && (
              <div className="mt-6 border-t border-gray-100 pt-4">
                <p className="mb-2 text-xs font-medium uppercase text-gray-500">
                  {t('leads.conversionHeading')}
                </p>
                <div className="flex flex-wrap gap-4 text-sm">
                  {lead.converted_contact_id && (
                    <Link
                      to={`/contacts/${lead.converted_contact_id}`}
                      className="text-indigo-600 hover:underline"
                      data-testid="converted-contact-link"
                    >
                      {t('leads.viewContact')}
                    </Link>
                  )}
                  {lead.converted_account_id && (
                    <Link
                      to={`/accounts/${lead.converted_account_id}`}
                      className="text-indigo-600 hover:underline"
                      data-testid="converted-account-link"
                    >
                      {t('leads.viewAccount')}
                    </Link>
                  )}
                  {lead.converted_deal_id && (
                    <Link
                      to={`/deals/${lead.converted_deal_id}`}
                      className="text-indigo-600 hover:underline"
                      data-testid="converted-deal-link"
                    >
                      {t('leads.viewDeal')}
                    </Link>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Status history timeline (MINCRM-174) */}
        {history.length > 0 && (
          <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="mb-4 text-sm font-semibold uppercase text-gray-500">
              {t('leads.statusHistoryHeading')}
            </h2>
            <ol className="space-y-3">
              {history.map((entry) => (
                <li
                  key={entry.id}
                  className="flex items-start gap-3 text-sm"
                  data-testid={`status-history-${entry.id}`}
                >
                  <span
                    className={`mt-0.5 inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[entry.to_status] ?? 'bg-gray-100 text-gray-600'}`}
                  >
                    {t(`leads.status${entry.to_status}`)}
                  </span>
                  {/* min-w-0: prevents flex child overflow for long names/status strings */}
                  <span className="text-gray-600 min-w-0 break-words">
                    {entry.from_status
                      ? t('leads.statusChangedFrom', {
                          actor: entry.changed_by_name ?? t('leads.unknownActor'),
                          from: t(`leads.status${entry.from_status}`),
                          to: t(`leads.status${entry.to_status}`),
                        })
                      : t('leads.statusInitial', {
                          actor: entry.changed_by_name ?? t('leads.unknownActor'),
                        })}
                    {' · '}
                    {new Date(entry.created_at).toLocaleString()}
                  </span>
                </li>
              ))}
            </ol>
          </div>
        )}

        {/* Notes (MINCRM-352) */}
        {id && <NotesSection entityType="lead" entityId={id} />}
      </main>

      <ConfirmDeleteModal
        isOpen={isConfirmDeleteOpen}
        message={t('leads.confirmDelete')}
        isDeleting={deleteMutation.isPending}
        onConfirm={() => {
          setIsConfirmDeleteOpen(false);
          deleteMutation.mutate();
        }}
        onCancel={() => setIsConfirmDeleteOpen(false)}
      />

      {isConvertModalOpen && (
        <ConvertLeadModal
          lead={lead}
          onClose={() => setIsConvertModalOpen(false)}
          onConverted={(result) => {
            setIsConvertModalOpen(false);
            void queryClient.invalidateQueries({ queryKey: leadQueryKey });
            void queryClient.invalidateQueries({ queryKey: LEADS_QUERY_KEY });
            navigate(`/contacts/${result.contact_id}`);
          }}
        />
      )}
    </div>
  );
}
