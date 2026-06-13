/**
 * LeadsPage component.
 * Lists all lead records with status badges, filter toggles, and an inline create form.
 * Supports inline status updates from the list view.
 * (MINCRM-173, MINCRM-174)
 */

import { useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { resolveApiError } from '@/utils/apiError.js';
import NavBar from '@/components/NavBar.js';
import EmptyState from '@/components/EmptyState.js';
import { PagedListLayout } from '@/components/PagedListLayout.js';
import LeadForm from '@/components/LeadForm.js';
import { Button } from '@/components/ui/Button.js';
import { OwnerToggle } from '@/components/ui/OwnerToggle.js';
import type { OwnerFilter } from '@/components/ui/OwnerToggle.js';
import { Pagination } from '@/components/ui/Pagination.js';
import { listLeads, createLead, updateLead, deleteLead } from '@/api/leads.js';
import type { DuplicateLeadInfo } from '@/api/leads.js';
import { listActiveUsers, ACTIVE_USERS_QUERY_KEY, resolveOwnerName } from '@/api/users.js';
import type { ActiveUser } from '@/api/users.js';
import type { LeadResponse } from '@shared/schemas/leadSchema.js';
import { LEAD_STATUSES, LEAD_SOURCES } from '@shared/schemas/leadSchema.js';
import { useAuth } from '@/hooks/useAuth.js';
import { usePermissions } from '@/hooks/usePermissions.js';
import { usePagination } from '@/hooks/usePagination.js';
import type { LeadFormValues } from '@/components/LeadForm.js';

/** React Query cache key for the leads list */
export const LEADS_QUERY_KEY = ['leads'] as const;

/** Tailwind badge classes by status (MINCRM-174) */
const STATUS_BADGE: Record<string, string> = {
  New: 'bg-blue-100 text-blue-800',
  Contacted: 'bg-yellow-100 text-yellow-800',
  Qualified: 'bg-green-100 text-green-800',
  Disqualified: 'bg-gray-100 text-gray-600',
};

/**
 * Leads list page with status filters, inline status update, and inline create form.
 */
export default function LeadsPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const { canWrite } = usePermissions();

  const [showForm, setShowForm] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const newLeadButtonRef = useRef<HTMLButtonElement>(null);
  const shouldRestoreFocusRef = useRef(false);
  const [duplicateLead, setDuplicateLead] = useState<DuplicateLeadInfo | null>(null);
  const forceNextSubmit = useRef(false);
  const formRef = useRef<HTMLFormElement>(null);

  const { page, limit, setPage, handleLimitChange } = usePagination();

  const [searchParams, setSearchParams] = useSearchParams();
  const ownerParam = searchParams.get('owner');
  const ownerFilter: OwnerFilter =
    ownerParam === 'me' ? 'me' : ownerParam === 'my_team' ? 'my_team' : 'all';

  /**
   * Updates the ?owner query param and resets to page 1. (MINCRM-545)
   *
   * @param value - New owner filter value
   */
  function setOwnerFilter(value: OwnerFilter): void {
    setPage(1);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (value === 'me' || value === 'my_team') {
          next.set('owner', value);
        } else {
          next.delete('owner');
        }
        return next;
      },
      { replace: true },
    );
  }

  const ownerApiParam = ownerFilter === 'all' ? undefined : ownerFilter;

  const [statusFilter, setStatusFilter] = useState<string>('');
  const [sourceFilter, setSourceFilter] = useState<string>('');
  const [includeDisqualified, setIncludeDisqualified] = useState(false);
  const [includeConverted, setIncludeConverted] = useState(false);

  // Inline status editing
  const [editingStatusId, setEditingStatusId] = useState<string | null>(null);

  const queryParams = {
    owner: ownerApiParam,
    status: statusFilter || undefined,
    lead_source: sourceFilter || undefined,
    includeDisqualified,
    includeConverted,
    page,
    limit,
  };

  const { data, isLoading, isError } = useQuery({
    queryKey: [...LEADS_QUERY_KEY, queryParams],
    queryFn: () => listLeads(queryParams),
  });

  const { data: activeUsersData } = useQuery({
    queryKey: ACTIVE_USERS_QUERY_KEY,
    queryFn: listActiveUsers,
  });
  const activeUsers: ActiveUser[] = activeUsersData?.users ?? [];

  const leads: LeadResponse[] = data?.data ?? [];
  const total = data?.total ?? 0;

  const hasActiveFilters =
    ownerFilter !== 'all' ||
    !!statusFilter ||
    !!sourceFilter ||
    includeDisqualified ||
    includeConverted;

  function clearFilters(): void {
    setOwnerFilter('all');
    setStatusFilter('');
    setSourceFilter('');
    setIncludeDisqualified(false);
    setIncludeConverted(false);
    setPage(1);
  }

  const createMutation = useMutation({
    mutationFn: ({ values, force }: { values: LeadFormValues; force: boolean }) =>
      createLead(
        {
          first_name: values.first_name,
          last_name: values.last_name || undefined,
          email: values.email,
          phone: values.phone || undefined,
          company_name: values.company_name || undefined,
          lead_source: (values.lead_source as LeadFormValues['lead_source']) || undefined,
          notes: values.notes || undefined,
          owner_id: values.owner_id || undefined,
        },
        force,
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: LEADS_QUERY_KEY });
      setShowForm(false);
      setCreateError(null);
      setDuplicateLead(null);
      forceNextSubmit.current = false;
      shouldRestoreFocusRef.current = true;
    },
    onError: (err: unknown) => {
      const axiosErr = err as {
        response?: {
          status?: number;
          data?: { duplicate?: DuplicateLeadInfo; error?: { message?: string } };
        };
      };
      if (axiosErr?.response?.status === 409 && axiosErr.response.data?.duplicate) {
        setDuplicateLead(axiosErr.response.data.duplicate);
        setCreateError(null);
      } else {
        setCreateError(resolveApiError(err, t, 'leads.createError'));
        setDuplicateLead(null);
      }
    },
  });

  const updateStatusMutation = useMutation({
    mutationFn: ({ id, status, version }: { id: string; status: string; version: number }) =>
      updateLead(id, { status: status as LeadResponse['status'], version }),
    onSuccess: (_data, variables) => {
      // Update the cached lead list optimistically so the badge reflects the
      // new status immediately without waiting for a full refetch (MINCRM-388).
      queryClient.setQueriesData<{ data: LeadResponse[]; total: number }>(
        { queryKey: LEADS_QUERY_KEY },
        (old) => {
          if (!old) return old;
          return {
            ...old,
            data: old.data.map((l) =>
              l.id === variables.id
                ? { ...l, status: variables.status as LeadResponse['status'] }
                : l,
            ),
          };
        },
      );
      void queryClient.invalidateQueries({ queryKey: LEADS_QUERY_KEY });
      setEditingStatusId(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteLead(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: LEADS_QUERY_KEY });
    },
  });

  function handleFormSubmit(values: LeadFormValues) {
    const force = forceNextSubmit.current;
    forceNextSubmit.current = false;
    createMutation.mutate({ values, force });
  }

  function handleCreateAnyway() {
    setDuplicateLead(null);
    forceNextSubmit.current = true;
    formRef.current?.requestSubmit();
  }

  function handleFormOpen() {
    setShowForm(true);
    setCreateError(null);
    setDuplicateLead(null);
    forceNextSubmit.current = false;
    shouldRestoreFocusRef.current = false;
  }

  function handleFormClose() {
    setShowForm(false);
    setCreateError(null);
    setDuplicateLead(null);
    if (shouldRestoreFocusRef.current) {
      newLeadButtonRef.current?.focus();
    }
  }

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      <NavBar />
      <main className="flex-1 flex flex-col min-h-0 overflow-hidden mx-auto max-w-7xl w-full px-4 sm:px-6 pt-8">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-900">{t('leads.pageTitle')}</h1>
          {canWrite && !showForm && (
            <Button ref={newLeadButtonRef} onClick={handleFormOpen} data-testid="new-lead-button">
              {t('leads.newLead')}
            </Button>
          )}
        </div>

        {/* Inline create form */}
        {showForm && (
          <div className="mb-6 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
            <h2 className="mb-4 text-lg font-semibold text-gray-900">{t('leads.newLead')}</h2>

            {duplicateLead && (
              <div
                className="mb-4 rounded border border-yellow-300 bg-yellow-50 p-4"
                role="alert"
                data-testid="duplicate-lead-warning"
              >
                <p className="text-sm font-medium text-yellow-800">
                  {t('leads.duplicateWarningTitle')}
                </p>
                <p className="mt-1 text-sm text-yellow-700">
                  {t('leads.duplicateWarningMessage', {
                    name: `${duplicateLead.first_name}${duplicateLead.last_name ? ' ' + duplicateLead.last_name : ''}`,
                  })}
                </p>
                <div className="mt-3 flex gap-3">
                  <Link
                    to={`/leads/${duplicateLead.id}`}
                    className="text-sm font-medium text-yellow-800 underline"
                    data-testid="duplicate-go-to-existing"
                  >
                    {t('leads.duplicateGoToExisting')}
                  </Link>
                  <button
                    type="button"
                    onClick={handleCreateAnyway}
                    className="text-sm font-medium text-yellow-800 underline"
                    data-testid="duplicate-create-anyway"
                  >
                    {t('leads.duplicateCreateAnyway')}
                  </button>
                </div>
              </div>
            )}

            {createError && (
              <p className="mb-4 text-sm text-red-600" role="alert" data-testid="create-lead-error">
                {createError}
              </p>
            )}

            <LeadForm
              ref={formRef}
              activeUsers={activeUsers}
              isAdmin={isAdmin}
              onSubmit={handleFormSubmit}
              isSubmitting={createMutation.isPending}
              onCancel={handleFormClose}
            />
          </div>
        )}

        {/* Table */}
        {isLoading && (
          <p className="text-gray-500" data-testid="leads-loading">
            {t('leads.loading')}
          </p>
        )}
        {isError && (
          <p className="text-red-600" data-testid="leads-error">
            {t('leads.loadError')}
          </p>
        )}
        {!isLoading && !isError && (
          <PagedListLayout
            toolbar={
              <div className="flex flex-wrap items-center gap-3">
                {/* Owner toggle (MINCRM-545) */}
                <OwnerToggle
                  value={ownerFilter}
                  onChange={setOwnerFilter}
                  testIdPrefix="filter-owner"
                />

                {/* Status filter */}
                <select
                  value={statusFilter}
                  onChange={(e) => {
                    setStatusFilter(e.target.value);
                    setPage(1);
                  }}
                  className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700"
                  data-testid="filter-status"
                >
                  <option value="">{t('leads.filterStatusAll')}</option>
                  {LEAD_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {t(`leads.status${s}`)}
                    </option>
                  ))}
                </select>

                {/* Source filter */}
                <select
                  value={sourceFilter}
                  onChange={(e) => {
                    setSourceFilter(e.target.value);
                    setPage(1);
                  }}
                  className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700"
                  data-testid="filter-source"
                >
                  <option value="">{t('leads.filterSourceAll')}</option>
                  {LEAD_SOURCES.map((s) => (
                    <option key={s} value={s}>
                      {t(`leads.source${s.replace(/\s+/g, '')}`)}
                    </option>
                  ))}
                </select>

                {/* Show disqualified toggle */}
                <label className="flex cursor-pointer items-center gap-1.5 text-sm text-gray-600">
                  <input
                    type="checkbox"
                    checked={includeDisqualified}
                    onChange={(e) => {
                      setIncludeDisqualified(e.target.checked);
                      setPage(1);
                    }}
                    className="rounded border-gray-300"
                    data-testid="toggle-disqualified"
                  />
                  {t('leads.showDisqualified')}
                </label>

                {/* Show converted toggle */}
                <label className="flex cursor-pointer items-center gap-1.5 text-sm text-gray-600">
                  <input
                    type="checkbox"
                    checked={includeConverted}
                    onChange={(e) => {
                      setIncludeConverted(e.target.checked);
                      setPage(1);
                    }}
                    className="rounded border-gray-300"
                    data-testid="toggle-converted"
                  />
                  {t('leads.showConverted')}
                </label>
              </div>
            }
            isEmpty={leads.length === 0}
            emptyState={
              <EmptyState
                data-testid="leads-empty-state"
                icon={
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-12 w-12"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={1}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                    />
                  </svg>
                }
                title={hasActiveFilters ? t('leads.filteredEmptyTitle') : t('leads.emptyTitle')}
                description={
                  hasActiveFilters
                    ? t('common.filteredEmptyDescription')
                    : t('leads.emptyDescription')
                }
                action={
                  hasActiveFilters
                    ? { label: t('common.clearFilters'), onClick: clearFilters }
                    : { label: t('leads.emptyAction'), onClick: () => setShowForm(true) }
                }
              />
            }
            pagination={
              <Pagination
                page={page}
                limit={limit}
                total={total}
                onPageChange={setPage}
                onLimitChange={handleLimitChange}
              />
            }
          >
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="sticky top-0 z-10 bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-start text-xs font-medium uppercase tracking-wide text-gray-500 whitespace-nowrap">
                    {t('leads.columnName')}
                  </th>
                  <th className="px-4 py-3 text-start text-xs font-medium uppercase tracking-wide text-gray-500 whitespace-nowrap">
                    {t('leads.columnCompany')}
                  </th>
                  <th className="px-4 py-3 text-start text-xs font-medium uppercase tracking-wide text-gray-500 whitespace-nowrap">
                    {t('leads.columnSource')}
                  </th>
                  <th className="px-4 py-3 text-start text-xs font-medium uppercase tracking-wide text-gray-500 whitespace-nowrap">
                    {t('leads.columnStatus')}
                  </th>
                  <th className="px-4 py-3 text-start text-xs font-medium uppercase tracking-wide text-gray-500 whitespace-nowrap">
                    {t('leads.columnOwner')}
                  </th>
                  <th className="px-4 py-3 text-start text-xs font-medium uppercase tracking-wide text-gray-500 whitespace-nowrap">
                    {t('leads.columnCreated')}
                  </th>
                  <th className="px-4 py-3 text-start text-xs font-medium uppercase tracking-wide text-gray-500 whitespace-nowrap">
                    {t('leads.columnActions')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {leads.map((lead) => {
                  const isConverted = Boolean(lead.converted_at);
                  return (
                    <tr
                      key={lead.id}
                      className={`hover:bg-gray-50 ${lead.status === 'Qualified' && !isConverted ? 'bg-green-50' : ''}`}
                      data-testid={`lead-row-${lead.id}`}
                    >
                      <td className="px-4 py-3 text-sm font-medium text-primary-600">
                        <Link to={`/leads/${lead.id}`} data-testid={`view-lead-${lead.id}`}>
                          {lead.first_name}
                          {lead.last_name ? ` ${lead.last_name}` : ''}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-700">
                        {lead.company_name ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-700">
                        {lead.lead_source
                          ? t(`leads.source${lead.lead_source.replace(/\s+/g, '')}`)
                          : '—'}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        {isConverted ? (
                          <span
                            className="inline-flex items-center rounded-full bg-purple-100 px-2.5 py-0.5 text-xs font-medium text-purple-800 whitespace-nowrap shrink-0"
                            data-testid={`badge-converted-${lead.id}`}
                          >
                            {t('leads.statusConverted')}
                          </span>
                        ) : editingStatusId === lead.id ? (
                          <select
                            ref={(el) => {
                              el?.focus();
                            }}
                            defaultValue={lead.status}
                            onChange={(e) => {
                              updateStatusMutation.mutate({
                                id: lead.id,
                                status: e.target.value,
                                version: lead.version,
                              });
                            }}
                            className="rounded border border-gray-300 py-0.5 text-xs"
                            data-testid={`status-select-${lead.id}`}
                          >
                            {LEAD_STATUSES.map((s) => (
                              <option key={s} value={s}>
                                {t(`leads.status${s}`)}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setEditingStatusId(lead.id)}
                            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap shrink-0 ${STATUS_BADGE[lead.status] ?? 'bg-gray-100 text-gray-600'}`}
                            data-testid={`status-badge-${lead.id}`}
                            title={t('leads.clickToUpdateStatus')}
                          >
                            {t(`leads.status${lead.status}`)}
                          </button>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-700">
                        {resolveOwnerName(lead.owner_id, activeUsers, t('leads.ownerUnknown'))}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500">
                        {new Date(lead.created_at).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        <button
                          type="button"
                          onClick={() => {
                            if (window.confirm(t('leads.confirmDelete'))) {
                              deleteMutation.mutate(lead.id);
                            }
                          }}
                          className="text-red-600 hover:text-red-800 disabled:opacity-50"
                          disabled={deleteMutation.isPending}
                          data-testid={`delete-lead-${lead.id}`}
                          aria-label={t('leads.delete')}
                        >
                          {t('leads.delete')}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </PagedListLayout>
        )}
      </main>
    </div>
  );
}
