/**
 * ActivitiesPage component.
 * Displays a paginated list of activities, optionally pre-filtered by URL params.
 * URL params accepted:
 *   ?owner=<uuid|me>   — filter by owner (admin UUID or 'me')
 *   ?type=<Note|Call|Email|Meeting|Task> — filter by activity type (server-side)
 *   ?start=YYYY-MM-DD  — show activities updated on or after this date (server-side)
 *   ?end=YYYY-MM-DD    — show activities updated on or before this date (server-side)
 *
 * Reps always see only their own activities regardless of the owner param.
 * Admins see the requested owner's activities, or all activities if no owner param.
 *
 */

import { useState, useEffect, useMemo } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import NavBar from '@/components/NavBar.js';
import EmptyState from '@/components/EmptyState.js';
import { Pagination } from '@/components/ui/Pagination.js';
import { PagedListLayout } from '@/components/PagedListLayout.js';
import BulkActionBar from '@/components/BulkActionBar.js';
import BulkFailedDetailsModal from '@/components/BulkFailedDetailsModal.js';
import BulkReassignModal from '@/components/BulkReassignModal.js';
import ConfirmDeleteModal from '@/components/ConfirmDeleteModal.js';
import { useAuth } from '@/hooks/useAuth.js';
import { listActivities, ACTIVITIES_QUERY_KEY } from '@/api/activities.js';
import type { ListActivitiesFilters } from '@/api/activities.js';
import { bulkPatchActivities, bulkDeleteActivities } from '@/api/bulk.js';
import type { BulkFailure } from '@/api/bulk.js';
import { listActiveUsers, ACTIVE_USERS_QUERY_KEY } from '@/api/users.js';
import type { ActiveUser } from '@/api/users.js';
import type { ActivityResponse } from '@shared/schemas/activitySchema.js';
import { formatLocalDate } from '@/utils/formatLocalDate.js';
import { PAGINATION_DEFAULT_LIMIT } from '@shared/schemas/paginationSchema.js';

/** Maps activity type to a badge color class. Reuses the same palette as DashboardPage. */
function activityTypeBadge(type: string): { className: string } {
  switch (type) {
    case 'Call':
      return { className: 'bg-blue-100 text-blue-700' };
    case 'Email':
      return { className: 'bg-purple-100 text-purple-700' };
    case 'Meeting':
      return { className: 'bg-green-100 text-green-700' };
    case 'Task':
      return { className: 'bg-yellow-100 text-yellow-700' };
    default:
      return { className: 'bg-gray-100 text-gray-600' };
  }
}

/**
 * Returns the route path for a linked record, or null if no association.
 *
 * @param activity - Activity row from the API
 */
function linkedRecordPath(activity: ActivityResponse): string | null {
  if (activity.contact_id) return `/contacts/${activity.contact_id}`;
  if (activity.account_id) return `/accounts/${activity.account_id}`;
  if (activity.deal_id) return `/deals/${activity.deal_id}`;
  return null;
}

/**
 * Activities list page — navigable from the dashboard "View all" link and
 * from activity volume report cell links.
 */
export default function ActivitiesPage() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isAdmin = user?.role === 'admin';
  // bulk:operations capability is seeded for admin and manager roles
  const canBulkOp = user?.role === 'admin' || user?.role === 'manager';
  const [searchParams] = useSearchParams();
  const [page, setPage] = useState(1);

  /** Parse URL params */
  const ownerParam = searchParams.get('owner') ?? undefined;
  const typeParam = searchParams.get('type') ?? undefined;
  const startParam = searchParams.get('start') ?? undefined;
  const endParam = searchParams.get('end') ?? undefined;

  /**
   * Build the owner filter: reps are always scoped to themselves.
   * Admins use the URL-provided owner (UUID or 'me'), or undefined = all.
   */
  const ownerFilter: ListActivitiesFilters['owner'] = useMemo(() => {
    if (!isAdmin) return 'me';
    return ownerParam as ListActivitiesFilters['owner'];
  }, [isAdmin, ownerParam]);

  const queryKey = [
    ...ACTIVITIES_QUERY_KEY,
    { owner: ownerFilter, type: typeParam, start: startParam, end: endParam, page },
  ];

  const { data, isLoading, isError } = useQuery({
    queryKey,
    queryFn: () =>
      listActivities({
        owner: ownerFilter,
        type: typeParam,
        start: startParam,
        end: endParam,
        page,
        limit: PAGINATION_DEFAULT_LIMIT,
      }),
  });

  const { data: activeUsersData } = useQuery({
    queryKey: ACTIVE_USERS_QUERY_KEY,
    queryFn: listActiveUsers,
    enabled: canBulkOp,
  });

  const activeUsers: ActiveUser[] = activeUsersData?.users ?? [];

  const activities = data?.data ?? [];

  // ── Bulk selection state ─────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showBulkReassign, setShowBulkReassign] = useState(false);
  const [showBulkDelete, setShowBulkDelete] = useState(false);
  const [bulkPartialFailures, setBulkPartialFailures] = useState<BulkFailure[]>([]);
  const [showBulkFailedDetails, setShowBulkFailedDetails] = useState(false);
  const [bulkSuccessMessage, setBulkSuccessMessage] = useState<string | null>(null);
  const [bulkError, setBulkError] = useState<string | null>(null);

  // Clear selection when page or filters change; call through updater fn to satisfy react-hooks/set-state-in-effect
  useEffect(() => {
    function reset() {
      setSelectedIds(new Set());
    }
    reset();
  }, [page, ownerFilter, typeParam, startParam, endParam]);

  const allVisibleIds = activities.map((a) => a.id);
  const allVisibleSelected =
    allVisibleIds.length > 0 && allVisibleIds.every((id) => selectedIds.has(id));

  function toggleSelectAll(): void {
    if (allVisibleSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(allVisibleIds));
    }
  }

  function toggleRow(id: string): void {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  const bulkMutation = useMutation({
    mutationFn: (args: { type: 'patch'; owner_id: string } | { type: 'delete' }) => {
      const ids = Array.from(selectedIds);
      if (args.type === 'delete') {
        return bulkDeleteActivities({ ids });
      }
      return bulkPatchActivities({ ids, patch: { owner_id: args.owner_id } });
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ACTIVITIES_QUERY_KEY });
      setShowBulkReassign(false);
      setShowBulkDelete(false);
      setBulkError(null);
      if (result.failed.length > 0 && result.succeeded.length > 0) {
        // Partial success — keep selection on failed IDs so admin can retry
        setBulkPartialFailures(result.failed);
        setBulkSuccessMessage(
          t('bulk.partialSuccess', {
            succeeded: result.succeeded.length,
            failed: result.failed.length,
          }),
        );
        setSelectedIds(new Set(result.failed.map((f) => f.id)));
      } else if (result.failed.length === 0) {
        setBulkPartialFailures([]);
        setBulkSuccessMessage(t('bulk.successCount', { count: result.succeeded.length }));
        setSelectedIds(new Set());
      }
      // Total failure: do not clear selection so user can retry
    },
    onError: () => {
      setBulkError(t('bulk.errorGeneric'));
    },
  });

  const hasActiveFilters = !!(
    typeParam ??
    startParam ??
    endParam ??
    (isAdmin ? ownerParam : undefined)
  );

  /** Build a human-readable description of active filters to show as a sub-heading. */
  const filterSummary = useMemo(() => {
    const parts: string[] = [];
    if (typeParam) parts.push(typeParam);
    if (startParam && endParam) parts.push(`${startParam} – ${endParam}`);
    else if (startParam) parts.push(`${t('activitiesPage.from')} ${startParam}`);
    else if (endParam) parts.push(`${t('activitiesPage.to')} ${endParam}`);
    return parts.join(' · ');
  }, [typeParam, startParam, endParam, t]);

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      <NavBar />
      <main className="flex-1 flex flex-col min-h-0 overflow-hidden max-w-7xl w-full mx-auto px-4 sm:px-6 pt-8">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-xl font-semibold text-gray-900" data-testid="activities-page-heading">
            {t('activitiesPage.pageTitle')}
          </h1>
          {filterSummary && (
            <p className="text-sm text-gray-500 mt-1" data-testid="activities-page-filter-summary">
              {filterSummary}
            </p>
          )}
        </div>

        {/* Loading */}
        {isLoading && (
          <p className="text-sm text-gray-500" data-testid="activities-page-loading">
            {t('activitiesPage.loading')}
          </p>
        )}

        {/* Error */}
        {isError && (
          <p role="alert" className="text-sm text-red-600" data-testid="activities-page-error">
            {t('activitiesPage.errorLoad')}
          </p>
        )}

        {/* Bulk success message */}
        {bulkSuccessMessage && (
          <p
            role="status"
            className="mb-2 text-sm text-green-700"
            data-testid="bulk-success-message"
          >
            {bulkSuccessMessage}
          </p>
        )}

        {/* Bulk error message */}
        {bulkError && (
          <p role="alert" className="mb-2 text-sm text-red-600" data-testid="bulk-error-message">
            {bulkError}
          </p>
        )}

        {/* Bulk action bar — admins only */}
        {canBulkOp && selectedIds.size > 0 && (
          <BulkActionBar
            selectedCount={selectedIds.size}
            isPending={bulkMutation.isPending}
            onSeeDetails={
              bulkPartialFailures.length > 0 ? () => setShowBulkFailedDetails(true) : undefined
            }
            actions={[
              {
                key: 'reassign',
                labelKey: 'bulk.reassignButton',
                testId: 'bulk-reassign-button',
                variant: 'secondary',
              },
              {
                key: 'delete',
                labelKey: 'bulk.deleteButton',
                testId: 'bulk-delete-button',
                variant: 'danger',
              },
            ]}
            onAction={(key) => {
              if (key === 'reassign') setShowBulkReassign(true);
              if (key === 'delete') setShowBulkDelete(true);
            }}
            onClearSelection={() => setSelectedIds(new Set())}
          />
        )}

        {/* Bulk reassign modal */}
        <BulkReassignModal
          isOpen={showBulkReassign}
          selectedCount={selectedIds.size}
          users={activeUsers}
          isPending={bulkMutation.isPending}
          onConfirm={(ownerId) => {
            bulkMutation.mutate({ type: 'patch', owner_id: ownerId });
          }}
          onCancel={() => setShowBulkReassign(false)}
        />

        {/* Bulk delete confirmation modal */}
        <ConfirmDeleteModal
          isOpen={showBulkDelete}
          message={t('bulk.deleteMessage', { count: selectedIds.size })}
          isDeleting={bulkMutation.isPending}
          onConfirm={() => {
            bulkMutation.mutate({ type: 'delete' });
          }}
          onCancel={() => setShowBulkDelete(false)}
        />

        {/* Bulk failed details modal */}
        <BulkFailedDetailsModal
          isOpen={showBulkFailedDetails}
          failures={bulkPartialFailures}
          onClose={() => setShowBulkFailedDetails(false)}
        />

        {!isLoading && !isError && (
          <PagedListLayout
            toolbar={null}
            isEmpty={activities.length === 0}
            emptyState={
              <EmptyState
                data-testid="activities-page-empty-state"
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
                      d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
                    />
                  </svg>
                }
                title={
                  hasActiveFilters
                    ? t('activitiesPage.filteredEmptyTitle')
                    : t('activitiesPage.emptyTitle')
                }
                description={
                  hasActiveFilters
                    ? t('common.filteredEmptyDescription')
                    : t('activitiesPage.emptyDescription')
                }
                action={
                  hasActiveFilters
                    ? {
                        label: t('common.clearFilters'),
                        onClick: () => navigate('/activities', { replace: true }),
                      }
                    : undefined
                }
              />
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
            <table
              className="min-w-full divide-y divide-gray-200"
              data-testid="activities-page-table"
            >
              <thead className="sticky top-0 z-10 bg-gray-50">
                <tr>
                  {canBulkOp && (
                    <th scope="col" className="w-10 ps-4 py-3">
                      <input
                        type="checkbox"
                        data-testid="bulk-select-all"
                        checked={allVisibleSelected}
                        onChange={toggleSelectAll}
                        aria-label={t('bulk.selectAll')}
                        className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                      />
                    </th>
                  )}
                  <th
                    scope="col"
                    className="px-6 py-3 text-start text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap"
                  >
                    {t('activitiesPage.columnType')}
                  </th>
                  <th
                    scope="col"
                    className="px-6 py-3 text-start text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap"
                  >
                    {t('activitiesPage.columnSubject')}
                  </th>
                  <th
                    scope="col"
                    className="px-6 py-3 text-start text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap"
                  >
                    {t('activitiesPage.columnRecord')}
                  </th>
                  <th
                    scope="col"
                    className="px-6 py-3 text-start text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap"
                  >
                    {t('activitiesPage.columnDate')}
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-100">
                {activities.map((activity) => {
                  const badge = activityTypeBadge(activity.type);
                  const recordPath = linkedRecordPath(activity);

                  return (
                    <tr
                      key={activity.id}
                      data-testid={`activity-row-${activity.id}`}
                      className={selectedIds.has(activity.id) ? 'bg-primary-50' : undefined}
                    >
                      {canBulkOp && (
                        <td className="w-10 ps-4 py-4">
                          <input
                            type="checkbox"
                            data-testid={`bulk-select-${activity.id}`}
                            checked={selectedIds.has(activity.id)}
                            onChange={() => toggleRow(activity.id)}
                            aria-label={activity.subject}
                            className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                          />
                        </td>
                      )}
                      {/* Type badge */}
                      <td className="px-6 py-4">
                        <span
                          className={`inline-flex items-center justify-center rounded px-2 py-0.5 text-xs font-medium whitespace-nowrap shrink-0 ${badge.className}`}
                          data-testid={`activity-type-${activity.id}`}
                        >
                          {activity.type}
                        </span>
                      </td>

                      {/* Subject */}
                      <td
                        className="px-6 py-4 text-sm text-gray-900"
                        data-testid={`activity-subject-${activity.id}`}
                      >
                        {activity.subject}
                      </td>

                      {/* Linked record — show record type as the link label */}
                      <td className="px-6 py-4 text-sm">
                        {recordPath ? (
                          <Link
                            to={recordPath}
                            className="text-primary-600 hover:text-primary-800 hover:underline"
                            data-testid={`activity-record-${activity.id}`}
                          >
                            {activity.contact_id
                              ? t('activitiesPage.recordTypeContact')
                              : activity.account_id
                                ? t('activitiesPage.recordTypeAccount')
                                : t('activitiesPage.recordTypeDeal')}
                          </Link>
                        ) : (
                          <span
                            className="text-gray-500"
                            data-testid={`activity-record-${activity.id}`}
                          >
                            —
                          </span>
                        )}
                      </td>

                      {/* Date */}
                      <td
                        className="px-6 py-4 text-sm text-gray-600"
                        data-testid={`activity-date-${activity.id}`}
                      >
                        {formatLocalDate(String(activity.updated_at).slice(0, 10), i18n.language)}
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
