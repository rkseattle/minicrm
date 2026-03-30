/**
 * DashboardPage component.
 * Displays a summary of the current user's pipeline and tasks:
 * - Overdue task count (clickable → My Tasks filtered to overdue)
 * - Tasks due today count
 * - Total open deal count
 * - Total open pipeline value
 * - Per-stage breakdown of open deals
 *
 * Admins see team-wide data; reps see their own data only.
 * Implements MINCRM-25.
 */

import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import NavBar from '@/components/NavBar.js';
import { useAuth } from '@/hooks/useAuth.js';
import { getDashboardSummary, DASHBOARD_QUERY_KEY } from '@/api/dashboard.js';

/**
 * Formats a numeric string as a currency amount using the active i18next locale.
 * Currency is always USD for this alpha; the locale controls separators and symbol placement.
 *
 * @param value - Numeric string from the API (e.g. "150000.00")
 * @param locale - BCP 47 language tag from i18next (e.g. "en", "de", "zh")
 */
function formatCurrency(value: string, locale: string): string {
  const number = parseFloat(value);
  if (isNaN(number)) return '$0.00';
  return new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD' }).format(number);
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
  const valueClass =
    variant === 'warning' ? 'text-3xl font-bold text-red-600' : 'text-3xl font-bold text-gray-900';

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
 * Dashboard landing page.
 */
export default function DashboardPage() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const { data, isLoading, isError } = useQuery({
    queryKey: DASHBOARD_QUERY_KEY,
    queryFn: getDashboardSummary,
    // staleTime defaults to 0 — always fresh on page load, satisfying the "no stale cache" requirement
  });

  return (
    <div className="min-h-screen bg-gray-50">
      <NavBar />
      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900" data-testid="dashboard-heading">
            {t('dashboard.welcome', { name: user?.name ?? '' })}
          </h1>
          <p className="text-gray-500 mt-1 text-sm">{t('dashboard.subtitle')}</p>
        </div>

        {isLoading && (
          <p className="text-sm text-gray-400" data-testid="dashboard-loading">
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
              className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8"
              data-testid="dashboard-stat-cards"
            >
              <StatCard
                testId="stat-overdue-tasks"
                label={`${isAdmin ? t('dashboard.teamScope') : t('dashboard.myScope')} ${t('dashboard.overdueTasks')}`}
                value={data.overdueTasks}
                variant={data.overdueTasks > 0 ? 'warning' : 'default'}
                linkTo="/my-tasks?filter=overdue"
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
                value={formatCurrency(data.openPipelineValue, i18n.language)}
              />
            </div>

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
                <p
                  className="px-6 py-8 text-sm text-gray-400 text-center"
                  data-testid="stage-breakdown-empty"
                >
                  {t('dashboard.noDeals')}
                </p>
              ) : (
                <table
                  className="min-w-full divide-y divide-gray-100"
                  data-testid="stage-breakdown-table"
                >
                  <thead className="bg-gray-50">
                    <tr>
                      <th
                        scope="col"
                        className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                      >
                        {t('dashboard.columnStage')}
                      </th>
                      <th
                        scope="col"
                        className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider"
                      >
                        {t('dashboard.columnDealCount')}
                      </th>
                      <th
                        scope="col"
                        className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider"
                      >
                        {t('dashboard.columnValue')}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-100">
                    {data.stageBreakdown.map((row) => (
                      <tr key={row.stage} data-testid={`stage-row-${row.stage}`}>
                        <td className="px-6 py-4 text-sm font-medium text-gray-900">{row.stage}</td>
                        <td
                          className="px-6 py-4 text-sm text-gray-600 text-right"
                          data-testid={`stage-count-${row.stage}`}
                        >
                          {row.count}
                        </td>
                        <td
                          className="px-6 py-4 text-sm text-gray-600 text-right"
                          data-testid={`stage-value-${row.stage}`}
                        >
                          {formatCurrency(row.value, i18n.language)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
