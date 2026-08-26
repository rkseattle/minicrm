/**
 * MyTasksPage component.
 * Lists all Task-type activities owned by the current user, sorted by due date ascending.
 * Overdue tasks (past due date and still open) have their due date highlighted in red.
 * Each row links to the associated contact, account, or deal record.
 * Users can mark tasks complete inline and toggle visibility of completed tasks.
 *
 */

import { useEffect, useState } from 'react';
import { useBreakpoint } from '@/context/BreakpointContext.js';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { resolveApiError } from '@/utils/apiError.js';
import NavBar from '@/components/NavBar.js';
import EmptyState from '@/components/EmptyState.js';
import { PagedListLayout } from '@/components/PagedListLayout.js';
import { Button } from '@/components/ui/Button.js';
import { Badge } from '@/components/ui/Badge.js';
import { listMyTasks, updateActivity, MY_TASKS_QUERY_KEY } from '@/api/activities.js';
import type { MyTaskResponse } from '@/api/activities.js';
import { TYPE_KEY_MAP } from '@/components/ActivityForm.js';
import { formatLocalDate } from '@/utils/formatLocalDate.js';
import { Pagination } from '@/components/ui/Pagination.js';
import { usePagination } from '@/hooks/usePagination.js';
import type { ActivityType } from '@shared/schemas/activitySchema.js';
import type { BadgeProps } from '@/components/ui/Badge.js';
import { bulkDeleteActivities } from '@/api/bulk.js';
import type { BulkFailure } from '@/api/bulk.js';
import { useAuth } from '@/hooks/useAuth.js';
import BulkActionBar from '@/components/BulkActionBar.js';
import BulkFailedDetailsModal from '@/components/BulkFailedDetailsModal.js';
import ConfirmDeleteModal from '@/components/ConfirmDeleteModal.js';
import { recordPathOrNull } from '@shared/types/recordPath.js';

/** Returns today's date string in YYYY-MM-DD format, recomputed on each call so overnight sessions stay accurate */
function getToday(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Badge variant for each activity type */
const TYPE_BADGE_VARIANT: Record<ActivityType, BadgeProps['variant']> = {
  Note: 'neutral',
  Call: 'success',
  Email: 'warning',
  Meeting: 'warning',
  Task: 'error',
};

/**
 * Returns true if the task is overdue: has a due date in the past and is still open.
 *
 * @param task - Task row from the API
 */
function isOverdue(task: MyTaskResponse): boolean {
  return task.status === 'open' && task.due_date !== null && task.due_date < getToday();
}

/**
 * Returns the URL path for the linked record so the user can navigate to it.
 *
 * @param task - Task row from the API
 */
function linkedRecordPath(task: MyTaskResponse): string | null {
  if (task.linked_record_type === 'contact') return recordPathOrNull('contact', task.contact_id);
  if (task.linked_record_type === 'account') return recordPathOrNull('account', task.account_id);
  if (task.linked_record_type === 'deal') return recordPathOrNull('deal', task.deal_id);
  return null;
}

/**
 * My Tasks page — shows all tasks for the current user.
 */
export default function MyTasksPage() {
  const { t, i18n } = useTranslation();
  const { isDesktop } = useBreakpoint();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  /** When navigated from the dashboard overdue link, pre-filter to overdue tasks only */
  const overdueFilter = searchParams.get('filter') === 'overdue';
  const [showCompleted, setShowCompleted] = useState(false);
  const [completeError, setCompleteError] = useState<string | null>(null);
  const { page, limit, setPage, handleLimitChange } = usePagination();

  // bulk:operations capability is seeded for admin and manager roles
  const canBulkOp = user?.role === 'admin' || user?.role === 'manager';

  // Bulk selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showBulkDelete, setShowBulkDelete] = useState(false);
  const [showBulkFailedDetails, setShowBulkFailedDetails] = useState(false);
  const [bulkPartialFailures, setBulkPartialFailures] = useState<BulkFailure[]>([]);
  const [bulkError, setBulkError] = useState<string | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: [...MY_TASKS_QUERY_KEY, page, limit],
    queryFn: () => listMyTasks(page, limit),
  });

  const completeMutation = useMutation({
    mutationFn: ({ id, version }: { id: string; version: number }) =>
      updateActivity(id, { status: 'complete', version }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: MY_TASKS_QUERY_KEY });
      setCompleteError(null);
    },
    onError: (error: { response?: { data?: { error?: { message?: string } } } }) => {
      setCompleteError(resolveApiError(error, t, 'myTasks.completeError'));
    },
  });

  const allTasks: MyTaskResponse[] = data?.tasks ?? [];
  const openTasks = allTasks.filter((task) => task.status === 'open');
  const completedTasks = allTasks.filter((task) => task.status === 'complete');

  // When the overdue filter is active (navigated from dashboard), show only overdue open tasks
  const overdueTasks = openTasks.filter(isOverdue);
  const visibleTasks = overdueFilter ? overdueTasks : showCompleted ? allTasks : openTasks;

  // Clear selection when page or filters change
  useEffect(() => {
    setSelectedIds(new Set()); // eslint-disable-line react-hooks/set-state-in-effect -- mirrors ContactsPage/DealsPage/ActivitiesPage pattern
  }, [page, limit, overdueFilter, showCompleted]);

  const allVisibleIds = visibleTasks.map((t) => t.id);
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
    mutationFn: () => bulkDeleteActivities({ ids: Array.from(selectedIds) }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: MY_TASKS_QUERY_KEY });
      setShowBulkDelete(false);
      setBulkError(null);
      if (result.failed.length > 0 && result.succeeded.length > 0) {
        setBulkPartialFailures(result.failed);
        setSelectedIds(new Set(result.failed.map((f) => f.id)));
      } else if (result.failed.length === 0) {
        setSelectedIds(new Set());
        setBulkPartialFailures([]);
      }
    },
    onError: () => {
      setBulkError(t('bulk.errorGeneric'));
    },
  });

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      <NavBar />
      <main className="flex-1 flex flex-col min-h-0 overflow-hidden max-w-7xl w-full mx-auto px-4 sm:px-6 pt-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-xl font-semibold text-gray-900" data-testid="my-tasks-heading">
            {t('myTasks.pageTitle')}
          </h1>
          {/* When the overdue filter is active, show a chip so the user knows why they
              see a subset of tasks. Hide the completed toggle — it has no effect in
              this mode and would confuse users navigating from the dashboard. */}
          {overdueFilter ? (
            <span
              className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-red-100 text-red-700 whitespace-nowrap shrink-0"
              data-testid="filter-chip-overdue"
            >
              {t('myTasks.filterChipOverdue')}
            </span>
          ) : (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              data-testid="toggle-completed-button"
              onClick={() => setShowCompleted((prev) => !prev)}
            >
              {showCompleted ? t('myTasks.hideCompleted') : t('myTasks.showCompleted')}
            </Button>
          )}
        </div>

        {bulkError && (
          <p role="alert" className="mb-2 text-sm text-red-600" data-testid="bulk-error-message">
            {bulkError}
          </p>
        )}

        {/* Bulk action bar */}
        {canBulkOp && selectedIds.size > 0 && (
          <BulkActionBar
            selectedCount={selectedIds.size}
            isPending={bulkMutation.isPending}
            onSeeDetails={
              bulkPartialFailures.length > 0 ? () => setShowBulkFailedDetails(true) : undefined
            }
            actions={[
              {
                key: 'delete',
                labelKey: 'bulk.deleteButton',
                testId: 'tasks-bulk-delete-button',
                variant: 'danger',
              },
            ]}
            onAction={() => setShowBulkDelete(true)}
            onClearSelection={() => setSelectedIds(new Set())}
          />
        )}
        <ConfirmDeleteModal
          isOpen={showBulkDelete}
          message={t('bulk.deleteMessage', { count: selectedIds.size })}
          isDeleting={bulkMutation.isPending}
          onConfirm={() => bulkMutation.mutate()}
          onCancel={() => setShowBulkDelete(false)}
        />
        <BulkFailedDetailsModal
          isOpen={showBulkFailedDetails}
          failures={bulkPartialFailures}
          onClose={() => setShowBulkFailedDetails(false)}
        />

        {isLoading ? (
          <p className="text-sm text-gray-500" data-testid="my-tasks-loading">
            {t('myTasks.loading')}
          </p>
        ) : isError ? (
          <div
            role="alert"
            className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700"
            data-testid="my-tasks-error"
          >
            {t('errors.generic')}
          </div>
        ) : (
          <>
            {completeError && (
              <p role="alert" className="mb-4 text-sm text-red-600" data-testid="complete-error">
                {completeError}
              </p>
            )}

            {/* Open tasks table */}
            <PagedListLayout
              toolbar={null}
              isEmpty={visibleTasks.length === 0 && !showCompleted}
              emptyState={
                <EmptyState
                  data-testid="my-tasks-empty-state"
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
                        d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"
                      />
                    </svg>
                  }
                  title={overdueFilter ? t('myTasks.filteredEmptyTitle') : t('myTasks.emptyTitle')}
                  description={
                    overdueFilter
                      ? t('myTasks.filteredEmptyDescription')
                      : t('myTasks.emptyDescription')
                  }
                  action={
                    overdueFilter
                      ? {
                          label: t('myTasks.clearFilters'),
                          onClick: () =>
                            setSearchParams(
                              (prev) => {
                                const next = new URLSearchParams(prev);
                                next.delete('filter');
                                return next;
                              },
                              { replace: true },
                            ),
                        }
                      : undefined
                  }
                />
              }
              pagination={
                data && (
                  <Pagination
                    page={data.page}
                    limit={data.limit}
                    total={data.total}
                    onPageChange={setPage}
                    onLimitChange={handleLimitChange}
                  />
                )
              }
            >
              {visibleTasks.length > 0 ? (
                isDesktop ? (
                  /* Desktop table */
                  <table
                    className="min-w-full divide-y divide-gray-200"
                    data-testid="my-tasks-table"
                  >
                    <thead className="sticky top-0 z-10 bg-gray-50">
                      <tr>
                        {canBulkOp && (
                          <th className="w-10 ps-4 py-3">
                            <input
                              type="checkbox"
                              checked={allVisibleSelected}
                              onChange={toggleSelectAll}
                              aria-label={t('bulk.selectAll')}
                              data-testid="tasks-select-all"
                              className="rounded border-gray-300"
                            />
                          </th>
                        )}
                        <th
                          scope="col"
                          className="px-6 py-3 text-start text-xs font-medium text-gray-500 uppercase tracking-wider"
                        >
                          {t('myTasks.columnSubject')}
                        </th>
                        <th
                          scope="col"
                          className="px-6 py-3 text-start text-xs font-medium text-gray-500 uppercase tracking-wider"
                        >
                          {t('myTasks.columnType')}
                        </th>
                        <th
                          scope="col"
                          className="px-6 py-3 text-start text-xs font-medium text-gray-500 uppercase tracking-wider"
                        >
                          {t('myTasks.columnDueDate')}
                        </th>
                        <th
                          scope="col"
                          className="px-6 py-3 text-start text-xs font-medium text-gray-500 uppercase tracking-wider"
                        >
                          {t('myTasks.columnRecord')}
                        </th>
                        <th
                          scope="col"
                          className="px-6 py-3 text-start text-xs font-medium text-gray-500 uppercase tracking-wider"
                        >
                          {t('myTasks.columnActions')}
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-100">
                      {visibleTasks.map((task) => {
                        const overdue = isOverdue(task);
                        const recordPath = linkedRecordPath(task);

                        return (
                          <tr key={task.id} data-testid={`task-row-${task.id}`}>
                            {canBulkOp && (
                              <td className="w-10 ps-4 py-4">
                                <input
                                  type="checkbox"
                                  checked={selectedIds.has(task.id)}
                                  onChange={() => toggleRow(task.id)}
                                  aria-label={t('bulk.selectRow')}
                                  data-testid={`bulk-select-${task.id}`}
                                  className="rounded border-gray-300"
                                />
                              </td>
                            )}
                            <td className="px-6 py-4 text-sm text-gray-900">
                              <span
                                data-testid={`task-subject-${task.id}`}
                                className={
                                  task.status === 'complete' ? 'line-through text-gray-500' : ''
                                }
                              >
                                {task.subject}
                              </span>
                            </td>
                            <td className="px-6 py-4">
                              <Badge
                                variant={TYPE_BADGE_VARIANT[task.type as ActivityType]}
                                data-testid={`task-type-${task.id}`}
                              >
                                {t(`activities.${TYPE_KEY_MAP[task.type as ActivityType]}`)}
                              </Badge>
                            </td>
                            <td className="px-6 py-4 text-sm">
                              {task.due_date ? (
                                <span
                                  data-testid={`task-due-date-${task.id}`}
                                  className={`whitespace-nowrap ${overdue ? 'text-red-600 font-medium' : 'text-gray-600'}`}
                                >
                                  {formatLocalDate(task.due_date, i18n.language)}
                                  {overdue && (
                                    <span
                                      className="ms-2 inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700 whitespace-nowrap shrink-0"
                                      data-testid={`task-overdue-badge-${task.id}`}
                                    >
                                      {t('myTasks.overdue')}
                                    </span>
                                  )}
                                </span>
                              ) : (
                                <span
                                  className="text-gray-500"
                                  data-testid={`task-due-date-${task.id}`}
                                >
                                  {t('myTasks.noDueDate')}
                                </span>
                              )}
                            </td>
                            <td className="px-6 py-4 text-sm">
                              {recordPath && task.linked_record_name ? (
                                <Link
                                  to={recordPath}
                                  className="text-primary-600 hover:text-primary-800 hover:underline"
                                  data-testid={`task-record-link-${task.id}`}
                                >
                                  {task.linked_record_name}
                                </Link>
                              ) : (
                                <span
                                  className="text-gray-500"
                                  data-testid={`task-record-link-${task.id}`}
                                >
                                  {t('myTasks.noRecord')}
                                </span>
                              )}
                            </td>
                            <td className="px-6 py-4 text-sm">
                              {task.status === 'open' && (
                                <Button
                                  type="button"
                                  variant="secondary"
                                  size="sm"
                                  data-testid={`mark-complete-${task.id}`}
                                  onClick={() =>
                                    completeMutation.mutate({
                                      id: task.id,
                                      version: task.version,
                                    })
                                  }
                                  disabled={
                                    completeMutation.isPending &&
                                    completeMutation.variables?.id === task.id
                                  }
                                >
                                  {completeMutation.isPending &&
                                  completeMutation.variables?.id === task.id
                                    ? t('myTasks.markingComplete')
                                    : t('myTasks.markComplete')}
                                </Button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                ) : (
                  /* Mobile card view */
                  <ul className="divide-y divide-gray-100" aria-label={t('myTasks.pageTitle')}>
                    {visibleTasks.map((task) => {
                      const overdue = isOverdue(task);
                      const recordPath = linkedRecordPath(task);

                      return (
                        <li key={task.id} className="px-4 py-3" data-testid={`task-row-${task.id}`}>
                          <div className="flex items-start gap-3">
                            {canBulkOp && (
                              <input
                                type="checkbox"
                                checked={selectedIds.has(task.id)}
                                onChange={() => toggleRow(task.id)}
                                data-testid={`bulk-select-${task.id}`}
                                className="mt-1 rounded border-gray-300 shrink-0"
                              />
                            )}
                            {/* min-w-0: prevents flex child overflow for long subject strings */}
                            <div className="min-w-0 flex-1">
                              <p
                                className={`text-sm font-medium mb-1${task.status === 'complete' ? ' line-through text-gray-500' : ' text-gray-900'}`}
                                data-testid={`task-subject-${task.id}`}
                              >
                                {task.subject}
                              </p>
                              <div className="flex items-center gap-2 flex-wrap mt-1">
                                <Badge
                                  variant={TYPE_BADGE_VARIANT[task.type as ActivityType]}
                                  data-testid={`task-type-${task.id}`}
                                >
                                  {t(`activities.${TYPE_KEY_MAP[task.type as ActivityType]}`)}
                                </Badge>
                                {task.due_date ? (
                                  <span
                                    data-testid={`task-due-date-${task.id}`}
                                    className={`text-xs whitespace-nowrap${overdue ? ' text-red-600 font-medium' : ' text-gray-500'}`}
                                  >
                                    {formatLocalDate(task.due_date, i18n.language)}
                                    {overdue && (
                                      <span
                                        className="ms-2 inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700 whitespace-nowrap shrink-0"
                                        data-testid={`task-overdue-badge-${task.id}`}
                                      >
                                        {t('myTasks.overdue')}
                                      </span>
                                    )}
                                  </span>
                                ) : (
                                  <span
                                    className="text-xs text-gray-500"
                                    data-testid={`task-due-date-${task.id}`}
                                  >
                                    {t('myTasks.noDueDate')}
                                  </span>
                                )}
                              </div>
                              {recordPath && task.linked_record_name ? (
                                <p className="text-xs text-gray-500 mt-1">
                                  <Link
                                    to={recordPath}
                                    className="text-primary-600 hover:underline"
                                    data-testid={`task-record-link-${task.id}`}
                                  >
                                    {task.linked_record_name}
                                  </Link>
                                </p>
                              ) : (
                                <p
                                  className="text-xs text-gray-500 mt-1"
                                  data-testid={`task-record-link-${task.id}`}
                                >
                                  {t('myTasks.noRecord')}
                                </p>
                              )}
                              {task.status === 'open' && (
                                <div className="mt-2">
                                  <Button
                                    type="button"
                                    variant="secondary"
                                    size="sm"
                                    data-testid={`mark-complete-${task.id}`}
                                    onClick={() =>
                                      completeMutation.mutate({
                                        id: task.id,
                                        version: task.version,
                                      })
                                    }
                                    disabled={
                                      completeMutation.isPending &&
                                      completeMutation.variables?.id === task.id
                                    }
                                  >
                                    {completeMutation.isPending &&
                                    completeMutation.variables?.id === task.id
                                      ? t('myTasks.markingComplete')
                                      : t('myTasks.markComplete')}
                                  </Button>
                                </div>
                              )}
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )
              ) : null}
            </PagedListLayout>

            {/* Completed tasks empty state when toggle is on */}
            {showCompleted && completedTasks.length === 0 && (
              <p className="mt-4 text-sm text-gray-500" data-testid="completed-tasks-empty">
                {t('myTasks.emptyCompleted')}
              </p>
            )}
          </>
        )}
      </main>
    </div>
  );
}
