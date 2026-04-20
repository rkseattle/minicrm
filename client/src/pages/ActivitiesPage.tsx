/**
 * ActivitiesPage component.
 * Displays a paginated list of activities, optionally pre-filtered by URL params.
 * URL params accepted:
 *   ?owner=<uuid|me>   — filter by owner (admin UUID or 'me')
 *   ?type=<Note|Call|Email|Meeting|Task> — filter by activity type
 *   ?start=YYYY-MM-DD  — show activities updated on or after this date
 *   ?end=YYYY-MM-DD    — show activities updated on or before this date
 *
 * Reps always see only their own activities regardless of the owner param.
 * Admins see the requested owner's activities, or all activities if no owner param.
 *
 * Implements MINCRM-181, MINCRM-185.
 */

import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import NavBar from '@/components/NavBar.js';
import { useAuth } from '@/hooks/useAuth.js';
import { listActivities, ACTIVITIES_QUERY_KEY } from '@/api/activities.js';
import type { ListActivitiesFilters } from '@/api/activities.js';
import type { ActivityResponse } from '@shared/schemas/activitySchema.js';
import { formatLocalDate } from '@/utils/formatLocalDate.js';

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
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [searchParams] = useSearchParams();

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
    { owner: ownerFilter, type: typeParam, start: startParam, end: endParam },
  ];

  const { data, isLoading, isError } = useQuery({
    queryKey,
    queryFn: () => listActivities({ owner: ownerFilter, limit: 100 }),
  });

  /**
   * Apply client-side type and date filters.
   * The server supports owner/contact/account/deal filters but not type or date range.
   * These two extra filters are applied in-memory on the response.
   */
  const filteredActivities = useMemo(() => {
    const rows = data?.data ?? [];
    return rows.filter((a) => {
      if (typeParam && a.type !== typeParam) return false;
      const updatedDate = String(a.updated_at).slice(0, 10);
      if (startParam && updatedDate < startParam) return false;
      if (endParam && updatedDate > endParam) return false;
      return true;
    });
  }, [data, typeParam, startParam, endParam]);

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
    <>
      <NavBar />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
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
          <p className="text-sm text-gray-400" data-testid="activities-page-loading">
            {t('activitiesPage.loading')}
          </p>
        )}

        {/* Error */}
        {isError && (
          <p role="alert" className="text-sm text-red-600" data-testid="activities-page-error">
            {t('activitiesPage.errorLoad')}
          </p>
        )}

        {/* Table */}
        {!isLoading && !isError && (
          <>
            {filteredActivities.length === 0 ? (
              <p className="text-sm text-gray-400" data-testid="activities-page-empty">
                {t('activitiesPage.empty')}
              </p>
            ) : (
              <div
                className="bg-white border border-gray-200 rounded-lg overflow-hidden"
                data-testid="activities-page-table-wrapper"
              >
                <table
                  className="min-w-full divide-y divide-gray-200"
                  data-testid="activities-page-table"
                >
                  <thead className="bg-gray-50">
                    <tr>
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
                    {filteredActivities.map((activity) => {
                      const badge = activityTypeBadge(activity.type);
                      const recordPath = linkedRecordPath(activity);

                      return (
                        <tr key={activity.id} data-testid={`activity-row-${activity.id}`}>
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
                                className="text-indigo-600 hover:text-indigo-800 hover:underline"
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
                                className="text-gray-400"
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
                            {formatLocalDate(
                              String(activity.updated_at).slice(0, 10),
                              i18n.language,
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </main>
    </>
  );
}
