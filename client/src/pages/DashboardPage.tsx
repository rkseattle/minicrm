/**
 * DashboardPage component.
 * Displays a summary of the current user's pipeline and tasks:
 * - Overdue task count (clickable → My Tasks filtered to overdue)
 * - Tasks due today count
 * - Total open deal count
 * - Total open pipeline value
 * - Per-stage breakdown of open deals
 * - Recent activity feed
 *
 * Admins see team-wide data; reps see their own data only.
 */

import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import NavBar from '@/components/NavBar.js';
import EmptyState from '@/components/EmptyState.js';
import { useAuth } from '@/hooks/useAuth.js';
import { useFeatureFlag } from '@/hooks/useFeatureFlag.js';
import {
  getDashboardSummary,
  DASHBOARD_QUERY_KEY,
  type RecentActivityEntry,
} from '@/api/dashboard.js';
import { getMyCoachingInsights, MY_COACHING_INSIGHTS_QUERY_KEY } from '@/api/repCoaching.js';
import { getStageDisplayName } from '@/utils/pipelineStageI18nKey.js';

/**
 * Formats a numeric string as a currency amount using the active i18next locale.
 *
 * @param value - Numeric string from the API (e.g. "150000.00")
 * @param locale - BCP 47 language tag from i18next (e.g. "en", "de", "zh")
 * @param currency - ISO 4217 currency code (e.g. "USD", "EUR")
 */
function formatCurrency(value: string, locale: string, currency: string): string {
  const number = parseFloat(value);
  if (isNaN(number)) return '—';
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(number);
}

/** A single summary stat card. */
interface StatCardProps {
  label: string;
  value: React.ReactNode;
  /** When provided, wraps the value in a clickable link. */
  linkTo?: string;
  /** data-testid attribute */
  testId: string;
  /** Optional visual variant to call out urgency */
  variant?: 'default' | 'warning';
}

/**
 * Renders a labeled metric card.
 *
 * @param props - StatCardProps
 */
function StatCard({ label, value, linkTo, testId, variant = 'default' }: StatCardProps) {
  // clamp(): fluid font between 1rem (mobile) and 1.875rem (desktop) so currency
  // strings like "$1,234,567.89" never overflow card borders at intermediate widths.
  // break-words ensures no unbreakable string (e.g. ¥1234567890) escapes the card.
  const valueClass =
    variant === 'warning'
      ? 'text-[clamp(1rem,2.5vw,1.875rem)] font-bold text-red-600 break-words'
      : 'text-[clamp(1rem,2.5vw,1.875rem)] font-bold text-gray-900 break-words';

  return (
    <div
      className="bg-white rounded-lg border border-gray-200 p-6 flex flex-col gap-1"
      data-testid={testId}
    >
      <p className="text-sm font-medium text-gray-500 uppercase tracking-wide">{label}</p>
      {linkTo ? (
        <Link
          to={linkTo}
          className={`${valueClass} hover:underline`}
          data-testid={`${testId}-link`}
        >
          {value}
        </Link>
      ) : (
        <p className={valueClass} data-testid={`${testId}-value`}>
          {value}
        </p>
      )}
    </div>
  );
}

/**
 * Maps an activity type string to a translated badge label and color class.
 * Uses plain text badges rather than icons to avoid requiring an icon library.
 *
 * @param type - Activity type (Note, Call, Email, Meeting, Task)
 * @param t - i18next translate function from useTranslation()
 */
function activityTypeBadge(
  type: string,
  t: (key: string) => string,
): { label: string; className: string } {
  switch (type) {
    case 'Call':
      return { label: t('activities.typeCall'), className: 'bg-blue-100 text-blue-700' };
    case 'Email':
      return { label: t('activities.typeEmail'), className: 'bg-purple-100 text-purple-700' };
    case 'Meeting':
      return { label: t('activities.typeMeeting'), className: 'bg-green-100 text-green-700' };
    case 'Task':
      return { label: t('activities.typeTask'), className: 'bg-yellow-100 text-yellow-700' };
    default:
      return { label: t('activities.typeNote'), className: 'bg-gray-100 text-gray-600' };
  }
}

/**
 * Converts an ISO timestamp to a human-readable relative time string.
 * Examples: "just now", "3 minutes ago", "2 hours ago", "4 days ago".
 *
 * @param isoString - ISO 8601 timestamp string
 */
function relativeTime(isoString: string): string {
  const diffMs = Date.now() - new Date(isoString).getTime();
  // Guard against clock skew or future timestamps
  if (diffMs <= 0) return 'just now';
  const diffSeconds = Math.floor(diffMs / 1000);
  if (diffSeconds < 60) return 'just now';
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes} minute${diffMinutes !== 1 ? 's' : ''} ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays} day${diffDays !== 1 ? 's' : ''} ago`;
}

/**
 * Renders the authenticated user's own AI coaching insights on the dashboard,
 * under a "My Performance" heading.
 * Any rep, manager, or admin sees only their own data here — the org-wide
 * manager/admin view lives at /insights/coaching. Silently renders nothing
 * when the feature flag is off, insufficient data exists, or there are no
 * outlier insights yet, since this is a supplementary dashboard section, not
 * a page the user navigated to specifically for this data.
 */
function MyPerformanceSection() {
  const { t } = useTranslation();
  const { enabled: featureEnabled } = useFeatureFlag('ai_rep_coaching_insights');

  const { data } = useQuery({
    queryKey: MY_COACHING_INSIGHTS_QUERY_KEY,
    queryFn: getMyCoachingInsights,
    enabled: featureEnabled,
  });

  if (!featureEnabled || !data || !data.has_sufficient_data) return null;

  const outlierInsights = data.insights.filter((insight) => insight.is_outlier);
  if (outlierInsights.length === 0) return null;

  return (
    <div
      className="bg-white rounded-lg border border-gray-200 mt-6"
      data-testid="my-performance-section"
    >
      <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
        <h2 className="text-base font-semibold text-gray-900">
          {t('dashboard.myPerformanceHeading')}
        </h2>
        <Link
          to="/insights/coaching"
          className="text-sm text-primary-600 hover:underline"
          data-testid="my-performance-view-all"
        >
          {t('dashboard.myPerformanceViewAll')}
        </Link>
      </div>
      <ul className="divide-y divide-gray-100" data-testid="my-performance-list">
        {outlierInsights.map((insight) => (
          <li
            key={`${insight.metric_type}-${insight.segment ?? 'all'}`}
            className="px-6 py-3"
            data-testid={`my-performance-insight-${insight.metric_type}-${insight.segment ?? 'all'}`}
          >
            <p className="text-sm text-gray-900">{insight.observation}</p>
            <p className="text-sm text-gray-600 mt-1">{insight.recommended_action}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Renders the recent activity feed section on the dashboard.
 */
function RecentActivityFeed({ activities }: { activities: RecentActivityEntry[] }) {
  const { t } = useTranslation();

  return (
    <div
      className="bg-white rounded-lg border border-gray-200 mt-6"
      data-testid="recent-activity-feed"
    >
      <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
        <h2 className="text-base font-semibold text-gray-900">
          {t('dashboard.recentActivityHeading')}
        </h2>
        <Link
          to="/activities"
          className="text-sm text-primary-600 hover:underline"
          data-testid="recent-activity-view-all"
        >
          {t('dashboard.recentActivityViewAll')}
        </Link>
      </div>

      {activities.length === 0 ? (
        <p
          className="px-6 py-8 text-sm text-gray-500 text-center"
          data-testid="recent-activity-empty"
        >
          {t('dashboard.recentActivityEmpty')}
        </p>
      ) : (
        <ul className="divide-y divide-gray-100" data-testid="recent-activity-list">
          {activities.map((entry) => {
            const badge = activityTypeBadge(entry.type, t);
            return (
              <li
                key={entry.id}
                className="px-6 py-3 flex items-center gap-3"
                data-testid={`recent-activity-${entry.id}`}
              >
                {/* Type badge */}
                <span
                  className={`inline-flex items-center justify-center rounded px-2 py-0.5 text-xs font-medium shrink-0 whitespace-nowrap ${badge.className}`}
                  data-testid={`recent-activity-type-${entry.id}`}
                >
                  {badge.label}
                </span>

                {/* Subject */}
                <span
                  className="text-sm text-gray-900 line-clamp-2 flex-1 min-w-0"
                  data-testid={`recent-activity-subject-${entry.id}`}
                >
                  {entry.subject}
                </span>

                {/* Linked record */}
                {entry.linkedRecordPath ? (
                  <Link
                    to={entry.linkedRecordPath}
                    className="text-sm text-primary-600 hover:underline shrink-0 hidden sm:block"
                    data-testid={`recent-activity-record-${entry.id}`}
                  >
                    {entry.linkedRecordName}
                  </Link>
                ) : entry.linkedRecordName ? (
                  <span
                    className="text-sm text-gray-500 shrink-0 hidden sm:block"
                    data-testid={`recent-activity-record-${entry.id}`}
                  >
                    {entry.linkedRecordName}
                  </span>
                ) : null}

                {/* Relative timestamp */}
                <span
                  className="text-xs text-gray-500 shrink-0"
                  data-testid={`recent-activity-time-${entry.id}`}
                  title={entry.updatedAt}
                >
                  {relativeTime(entry.updatedAt)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/**
 * Dashboard landing page.
 */
export default function DashboardPage() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const { data, isLoading, isError } = useQuery({
    queryKey: DASHBOARD_QUERY_KEY,
    queryFn: getDashboardSummary,
  });

  return (
    <div className="min-h-screen bg-gray-50">
      <NavBar />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900" data-testid="dashboard-heading">
            {t('dashboard.welcome', { name: user?.name ?? '' })}
          </h1>
          <p className="text-gray-500 mt-1 text-sm">{t('dashboard.subtitle')}</p>
        </div>

        {isLoading && (
          <p className="text-sm text-gray-500" data-testid="dashboard-loading">
            {t('dashboard.loading')}
          </p>
        )}

        {isError && (
          <p role="alert" className="text-sm text-red-600" data-testid="dashboard-error">
            {t('dashboard.errorLoad')}
          </p>
        )}

        {data && (
          <>
            {/* Stat cards */}
            <div
              className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-8"
              data-testid="dashboard-stat-cards"
            >
              <StatCard
                testId="stat-overdue-tasks"
                label={`${isAdmin ? t('dashboard.teamScope') : t('dashboard.myScope')} ${t('dashboard.overdueTasks')}`}
                value={data.overdueTasks}
                variant={data.overdueTasks > 0 ? 'warning' : 'default'}
                linkTo={isAdmin ? undefined : '/tasks?filter=overdue'}
              />
              <StatCard
                testId="stat-tasks-due-today"
                label={`${isAdmin ? t('dashboard.teamScope') : t('dashboard.myScope')} ${t('dashboard.tasksDueToday')}`}
                value={data.tasksDueToday}
              />
              <StatCard
                testId="stat-open-deals"
                label={`${isAdmin ? t('dashboard.teamScope') : t('dashboard.myScope')} ${t('dashboard.openDeals')}`}
                value={data.openDealCount}
              />
              <StatCard
                testId="stat-pipeline-value"
                label={`${isAdmin ? t('dashboard.teamScope') : t('dashboard.myScope')} ${t('dashboard.pipelineValue')}`}
                value={
                  data.mixedCurrencies
                    ? t('pipeline.mixedCurrency')
                    : formatCurrency(data.openPipelineValue, i18n.language, data.currency ?? 'USD')
                }
              />
              <StatCard
                testId="stat-weighted-pipeline-value"
                label={`${isAdmin ? t('dashboard.teamScope') : t('dashboard.myScope')} ${t('dashboard.weightedPipelineValue')}`}
                value={
                  data.mixedCurrencies
                    ? t('pipeline.mixedCurrency')
                    : formatCurrency(
                        data.weightedPipelineValue,
                        i18n.language,
                        data.currency ?? 'USD',
                      )
                }
              />
            </div>

            {/* Currency conversion summary — only shown when rates exist */}
            {data.hasRates && (
              <div
                className="bg-white rounded-lg border border-gray-200 p-4 mb-8 flex flex-col gap-2"
                data-testid="converted-pipeline-summary"
              >
                <div className="flex flex-wrap gap-6">
                  <div>
                    <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
                      {t('dashboard.pipelineValue')}
                      {' ('}
                      {data.homeCurrency}
                      {')'}
                    </p>
                    <p
                      className="text-[clamp(1rem,2.5vw,1.5rem)] font-bold text-gray-900 break-words"
                      data-testid="stat-converted-pipeline-value"
                    >
                      {data.convertedPipelineValue !== null
                        ? formatCurrency(
                            data.convertedPipelineValue,
                            i18n.language,
                            data.homeCurrency ?? 'USD',
                          )
                        : '—'}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
                      {t('dashboard.weightedPipelineValue')}
                      {' ('}
                      {data.homeCurrency}
                      {')'}
                    </p>
                    <p
                      className="text-[clamp(1rem,2.5vw,1.5rem)] font-bold text-gray-900 break-words"
                      data-testid="stat-converted-weighted-pipeline-value"
                    >
                      {data.convertedWeightedPipelineValue !== null
                        ? formatCurrency(
                            data.convertedWeightedPipelineValue,
                            i18n.language,
                            data.homeCurrency ?? 'USD',
                          )
                        : '—'}
                    </p>
                  </div>
                </div>
                {/* Rates footnote */}
                <p className="text-xs text-gray-500" data-testid="converted-pipeline-footnote">
                  {t('dashboard.currencyConvertedFootnote', {
                    currency: data.homeCurrency ?? '',
                    date: data.ratesLastUpdated
                      ? new Date(data.ratesLastUpdated).toLocaleDateString(i18n.language)
                      : '—',
                  })}
                </p>
                {/* Unrated currencies note */}
                {data.unratedCount > 0 && (
                  <p
                    className="text-xs text-yellow-600"
                    data-testid="converted-pipeline-unrated-note"
                  >
                    {t('dashboard.unratedDealsNote', { count: data.unratedCount })}
                  </p>
                )}
              </div>
            )}

            {/* Stage breakdown */}
            <div
              className="bg-white rounded-lg border border-gray-200"
              data-testid="stage-breakdown"
            >
              <div className="px-6 py-4 border-b border-gray-200">
                <h2 className="text-base font-semibold text-gray-900">
                  {t('dashboard.stageBreakdownHeading')}
                </h2>
              </div>

              {data.stageBreakdown.length === 0 ? (
                <EmptyState
                  data-testid="stage-breakdown-empty"
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
                        d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
                      />
                    </svg>
                  }
                  title={t('dashboard.noDealsTitle')}
                  description={t('dashboard.noDealsDescription')}
                  action={{ label: t('dashboard.noDealsAction'), to: '/deals' }}
                />
              ) : (
                <div className="overflow-x-auto">
                  <table
                    className="min-w-full divide-y divide-gray-100"
                    data-testid="stage-breakdown-table"
                  >
                    <thead className="bg-gray-50">
                      <tr>
                        <th
                          scope="col"
                          className="px-6 py-3 text-start text-xs font-medium text-gray-500 uppercase tracking-wider"
                        >
                          {t('dashboard.columnStage')}
                        </th>
                        <th
                          scope="col"
                          className="px-6 py-3 text-end text-xs font-medium text-gray-500 uppercase tracking-wider"
                        >
                          {t('dashboard.columnDealCount')}
                        </th>
                        <th
                          scope="col"
                          className="px-6 py-3 text-end text-xs font-medium text-gray-500 uppercase tracking-wider"
                        >
                          {t('dashboard.columnValue')}
                        </th>
                        <th
                          scope="col"
                          className="px-6 py-3 text-end text-xs font-medium text-gray-500 uppercase tracking-wider"
                        >
                          {t('dashboard.columnWeightedValue')}
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-100">
                      {data.stageBreakdown.map((row) => (
                        <tr key={row.stage} data-testid={`stage-row-${row.stage}`}>
                          <td className="px-6 py-4 text-sm font-medium text-gray-900">
                            {getStageDisplayName(row.stage, t)}
                          </td>
                          <td
                            className="px-6 py-4 text-sm text-gray-600 text-end"
                            data-testid={`stage-count-${row.stage}`}
                          >
                            {row.count}
                          </td>
                          <td
                            className="px-6 py-4 text-sm text-gray-600 text-end break-words"
                            data-testid={`stage-value-${row.stage}`}
                          >
                            {row.mixedCurrencies
                              ? t('pipeline.mixedCurrency')
                              : formatCurrency(row.value, i18n.language, row.currency ?? 'USD')}
                          </td>
                          <td
                            className="px-6 py-4 text-sm text-gray-600 text-end break-words"
                            data-testid={`stage-weighted-value-${row.stage}`}
                          >
                            {row.mixedCurrencies
                              ? t('pipeline.mixedCurrency')
                              : formatCurrency(
                                  row.weightedValue,
                                  i18n.language,
                                  row.currency ?? 'USD',
                                )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* My Performance — own AI coaching insights */}
            <MyPerformanceSection />

            {/* Recent activity feed */}
            <RecentActivityFeed activities={data.recentActivities} />
          </>
        )}
      </main>
    </div>
  );
}
