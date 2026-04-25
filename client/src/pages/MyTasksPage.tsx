/**
 * MyTasksPage component.
 * Lists all Task-type activities owned by the current user, sorted by due date ascending.
 * Overdue tasks (past due date and still open) have their due date highlighted in red.
 * Each row links to the associated contact, account, or deal record.
 * Users can mark tasks complete inline and toggle visibility of completed tasks.
 *
 * Implements MINCRM-20.
 */

import { useState } from 'react';
import { useBreakpoint } from '@/context/BreakpointContext.js';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import NavBar from '@/components/NavBar.js';
import { Button } from '@/components/ui/Button.js';
import { Badge } from '@/components/ui/Badge.js';
import { listMyTasks, updateActivity, MY_TASKS_QUERY_KEY } from '@/api/activities.js';
import type { MyTaskResponse } from '@/api/activities.js';
import { TYPE_KEY_MAP } from '@/components/ActivityForm.js';
import { formatLocalDate } from '@/utils/formatLocalDate.js';
import type { ActivityType } from '@shared/schemas/activitySchema.js';
import type { BadgeProps } from '@/components/ui/Badge.js';

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
  if (task.linked_record_type === 'contact' && task.contact_id) {
    return `/contacts/${task.contact_id}`;
  }
  if (task.linked_record_type === 'account' && task.account_id) {
    return `/accounts/${task.account_id}`;
  }
  if (task.linked_record_type === 'deal' && task.deal_id) {
    return `/deals/${task.deal_id}`;
  }
  return null;
}

/**
 * My Tasks page — shows all tasks for the current user.
 */
export default function MyTasksPage() {
  const { t, i18n } = useTranslation();
  const { isDesktop } = useBreakpoint();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  /** When navigated from the dashboard overdue link, pre-filter to overdue tasks only */
  const overdueFilter = searchParams.get('filter') === 'overdue';
  const [showCompleted, setShowCompleted] = useState(false);
  const [completeError, setCompleteError] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: MY_TASKS_QUERY_KEY,
    queryFn: listMyTasks,
  });

  const completeMutation = useMutation({
    mutationFn: (id: string) => updateActivity(id, { status: 'complete' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: MY_TASKS_QUERY_KEY });
      setCompleteError(null);
    },
    onError: (error: { response?: { data?: { error?: { message?: string } } } }) => {
      setCompleteError(error.response?.data?.error?.message ?? t('myTasks.completeError'));
    },
  });

  const allTasks: MyTaskResponse[] = data?.tasks ?? [];
  const openTasks = allTasks.filter((task) => task.status === 'open');
  const completedTasks = allTasks.filter((task) => task.status === 'complete');

  // When the overdue filter is active (navigated from dashboard), show only overdue open tasks
  const overdueTasks = openTasks.filter(isOverdue);
  const visibleTasks = overdueFilter ? overdueTasks : showCompleted ? allTasks : openTasks;

  return (
    <>
      <NavBar />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
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

        {isLoading ? (
          <p className="text-sm text-gray-400" data-testid="my-tasks-loading">
            {t('myTasks.loading')}
          </p>
        ) : (
          <>
            {completeError && (
              <p role="alert" className="mb-4 text-sm text-red-600" data-testid="complete-error">
                {completeError}
              </p>
            )}

            {/* Open tasks table */}
            {visibleTasks.length === 0 && !showCompleted ? (
              <p className="text-sm text-gray-400" data-testid="my-tasks-empty">
                {t('myTasks.empty')}
              </p>
            ) : visibleTasks.length > 0 ? (
              <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                {isDesktop ? (
                  /* Desktop table */
                  <div className="overflow-x-auto">
                    <table
                      className="min-w-full divide-y divide-gray-200"
                      data-testid="my-tasks-table"
                    >
                      <thead className="bg-gray-50">
                        <tr>
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
                            <tr
                              key={task.id}
                              data-testid={`task-row-${task.id}`}
                              className={task.status === 'complete' ? 'opacity-60' : ''}
                            >
                              <td className="px-6 py-4 text-sm text-gray-900">
                                <span
                                  data-testid={`task-subject-${task.id}`}
                                  className={
                                    task.status === 'complete' ? 'line-through text-gray-400' : ''
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
                                    className="text-gray-400"
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
                                    className="text-indigo-600 hover:text-indigo-800 hover:underline"
                                    data-testid={`task-record-link-${task.id}`}
                                  >
                                    {task.linked_record_name}
                                  </Link>
                                ) : (
                                  <span
                                    className="text-gray-400"
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
                                    onClick={() => completeMutation.mutate(task.id)}
                                    disabled={
                                      completeMutation.isPending &&
                                      completeMutation.variables === task.id
                                    }
                                  >
                                    {completeMutation.isPending &&
                                    completeMutation.variables === task.id
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
                  </div>
                ) : (
                  /* Mobile card view */
                  <ul className="divide-y divide-gray-100" aria-label={t('myTasks.pageTitle')}>
                    {visibleTasks.map((task) => {
                      const overdue = isOverdue(task);
                      const recordPath = linkedRecordPath(task);

                      return (
                        <li
                          key={task.id}
                          className={`px-4 py-3${task.status === 'complete' ? ' opacity-60' : ''}`}
                          data-testid={`task-row-${task.id}`}
                        >
                          {/* min-w-0: prevents flex child overflow for long subject strings */}
                          <div className="min-w-0 flex-1">
                            <p
                              className={`text-sm font-medium mb-1${task.status === 'complete' ? ' line-through text-gray-400' : ' text-gray-900'}`}
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
                                  className="text-xs text-gray-400"
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
                                  className="text-indigo-600 hover:underline"
                                  data-testid={`task-record-link-${task.id}`}
                                >
                                  {task.linked_record_name}
                                </Link>
                              </p>
                            ) : (
                              <p
                                className="text-xs text-gray-400 mt-1"
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
                                  onClick={() => completeMutation.mutate(task.id)}
                                  disabled={
                                    completeMutation.isPending &&
                                    completeMutation.variables === task.id
                                  }
                                >
                                  {completeMutation.isPending &&
                                  completeMutation.variables === task.id
                                    ? t('myTasks.markingComplete')
                                    : t('myTasks.markComplete')}
                                </Button>
                              </div>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            ) : null}

            {/* Completed tasks empty state when toggle is on */}
            {showCompleted && completedTasks.length === 0 && (
              <p className="mt-4 text-sm text-gray-400" data-testid="completed-tasks-empty">
                {t('myTasks.emptyCompleted')}
              </p>
            )}
          </>
        )}
      </main>
    </>
  );
}
