/**
 * WinLossReportPage component.
 * Displays a win/loss report for a selected date range:
 * - Closed Won count and total value
 * - Closed Lost count and total value
 * - Win rate (Won / Total Closed)
 * - Loss reason breakdown (when loss reasons were captured)
 *
 * Date range defaults to the current month; presets for "this quarter" and
 * a custom range are also available.
 * Admins can filter by owner (rep); reps always see their own data.
 * Implements MINCRM-26.
 */

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import NavBar from '@/components/NavBar.js';
import { useAuth } from '@/hooks/useAuth.js';
import { listActiveUsers, ACTIVE_USERS_QUERY_KEY } from '@/api/users.js';
import {
  getWinLossReport,
  WIN_LOSS_REPORT_QUERY_KEY,
  type WinLossReportParams,
} from '@/api/reports.js';

/** Returns the first day of the current month as YYYY-MM-DD */
function startOfCurrentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
}

/** Returns the last day of the current month as YYYY-MM-DD */
function endOfCurrentMonth(): string {
  const now = new Date();
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return lastDay.toISOString().slice(0, 10);
}

/** Returns the first day of the current quarter as YYYY-MM-DD */
function startOfCurrentQuarter(): string {
  const now = new Date();
  const quarterStartMonth = Math.floor(now.getMonth() / 3) * 3;
  return `${now.getFullYear()}-${String(quarterStartMonth + 1).padStart(2, '0')}-01`;
}

/** Returns the last day of the current quarter as YYYY-MM-DD */
function endOfCurrentQuarter(): string {
  const now = new Date();
  const quarterEndMonth = Math.floor(now.getMonth() / 3) * 3 + 2;
  const lastDay = new Date(now.getFullYear(), quarterEndMonth + 1, 0);
  return lastDay.toISOString().slice(0, 10);
}

/**
 * Formats a numeric string as a USD currency amount using the active i18next locale.
 *
 * @param value - Numeric string from the API (e.g. "87000.00")
 * @param locale - BCP 47 language tag from i18next (e.g. "en", "de", "zh")
 */
function formatCurrency(value: string, locale: string): string {
  const number = parseFloat(value);
  if (isNaN(number)) return '$0.00';
  return new Intl.NumberFormat(locale, { style: 'currency', currency: 'USD' }).format(number);
}

/**
 * Formats a win rate (0–1 decimal) as a percentage string.
 *
 * @param rate - Win rate decimal, or null when no closed deals exist
 */
function formatWinRate(rate: number | null): string {
  if (rate === null) return '—';
  return `${Math.round(rate * 100)}%`;
}

/** Date range preset identifier */
type DatePreset = 'currentMonth' | 'currentQuarter' | 'custom';

/**
 * Win/loss report page.
 */
export default function WinLossReportPage() {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  // ── Date range state ────────────────────────────────────────────────────────
  const [preset, setPreset] = useState<DatePreset>('currentMonth');
  const [customStart, setCustomStart] = useState<string>(startOfCurrentMonth);
  const [customEnd, setCustomEnd] = useState<string>(endOfCurrentMonth);

  const { start, end } = useMemo<{ start: string; end: string }>(() => {
    if (preset === 'currentMonth') {
      return { start: startOfCurrentMonth(), end: endOfCurrentMonth() };
    }
    if (preset === 'currentQuarter') {
      return { start: startOfCurrentQuarter(), end: endOfCurrentQuarter() };
    }
    return { start: customStart, end: customEnd };
  }, [preset, customStart, customEnd]);

  // ── Owner filter state (admin only) ────────────────────────────────────────
  const [selectedOwnerId, setSelectedOwnerId] = useState<string>('');

  const { data: activeUsersData } = useQuery({
    queryKey: ACTIVE_USERS_QUERY_KEY,
    queryFn: listActiveUsers,
    enabled: isAdmin,
  });

  // ── Report query ───────────────────────────────────────────────────────────
  const reportParams: WinLossReportParams = {
    start,
    end,
    ownerId: isAdmin && selectedOwnerId ? selectedOwnerId : undefined,
  };

  const {
    data: report,
    isLoading,
    isError,
  } = useQuery({
    queryKey: [...WIN_LOSS_REPORT_QUERY_KEY, reportParams],
    queryFn: () => getWinLossReport(reportParams),
    enabled: start <= end,
  });

  return (
    <div className="min-h-screen bg-gray-50">
      <NavBar />
      <main className="max-w-5xl mx-auto px-6 py-8">
        {/* Page header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900" data-testid="win-loss-report-heading">
            {t('reports.winLoss.pageTitle')}
          </h1>
          <p className="text-sm text-gray-500 mt-1">{t('reports.winLoss.subtitle')}</p>
        </div>

        {/* Filters */}
        <div
          className="bg-white rounded-lg border border-gray-200 p-4 mb-6 flex flex-wrap gap-4 items-end"
          data-testid="report-filters"
        >
          {/* Date preset */}
          <div className="flex flex-col gap-1">
            <label
              htmlFor="date-preset"
              className="text-xs font-medium text-gray-500 uppercase tracking-wide"
            >
              {t('reports.winLoss.dateRangeLabel')}
            </label>
            <select
              id="date-preset"
              data-testid="date-preset-select"
              value={preset}
              onChange={(e) => setPreset(e.target.value as DatePreset)}
              className="border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="currentMonth">{t('reports.winLoss.presetCurrentMonth')}</option>
              <option value="currentQuarter">{t('reports.winLoss.presetCurrentQuarter')}</option>
              <option value="custom">{t('reports.winLoss.presetCustom')}</option>
            </select>
          </div>

          {/* Custom date range — only visible when "custom" is selected */}
          {preset === 'custom' && (
            <>
              <div className="flex flex-col gap-1">
                <label
                  htmlFor="custom-start"
                  className="text-xs font-medium text-gray-500 uppercase tracking-wide"
                >
                  {t('reports.winLoss.startDateLabel')}
                </label>
                <input
                  id="custom-start"
                  type="date"
                  data-testid="custom-start-input"
                  value={customStart}
                  onChange={(e) => setCustomStart(e.target.value)}
                  className="border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label
                  htmlFor="custom-end"
                  className="text-xs font-medium text-gray-500 uppercase tracking-wide"
                >
                  {t('reports.winLoss.endDateLabel')}
                </label>
                <input
                  id="custom-end"
                  type="date"
                  data-testid="custom-end-input"
                  value={customEnd}
                  onChange={(e) => setCustomEnd(e.target.value)}
                  className="border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
            </>
          )}

          {/* Owner filter — admin only */}
          {isAdmin && (
            <div className="flex flex-col gap-1">
              <label
                htmlFor="owner-filter"
                className="text-xs font-medium text-gray-500 uppercase tracking-wide"
              >
                {t('reports.winLoss.ownerFilterLabel')}
              </label>
              <select
                id="owner-filter"
                data-testid="owner-filter-select"
                value={selectedOwnerId}
                onChange={(e) => setSelectedOwnerId(e.target.value)}
                className="border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="">{t('reports.winLoss.ownerFilterAll')}</option>
                {activeUsersData?.users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Invalid date range warning */}
        {preset === 'custom' && start > end && (
          <p role="alert" className="mb-4 text-sm text-red-600" data-testid="date-range-error">
            {t('reports.winLoss.dateRangeInvalid')}
          </p>
        )}

        {/* Loading state */}
        {isLoading && (
          <p className="text-sm text-gray-400" data-testid="report-loading">
            {t('reports.winLoss.loading')}
          </p>
        )}

        {/* Error state */}
        {isError && (
          <p role="alert" className="text-sm text-red-600" data-testid="report-error">
            {t('reports.winLoss.errorLoad')}
          </p>
        )}

        {/* Report results */}
        {report && (
          <>
            {/* Summary stat cards */}
            <div
              className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6"
              data-testid="report-stat-cards"
            >
              {/* Closed Won count */}
              <div
                className="bg-white rounded-lg border border-gray-200 p-6 flex flex-col gap-1"
                data-testid="stat-won-count"
              >
                <p className="text-sm font-medium text-gray-500 uppercase tracking-wide">
                  {t('reports.winLoss.wonCountLabel')}
                </p>
                <p className="text-3xl font-bold text-green-600" data-testid="stat-won-count-value">
                  {report.wonCount}
                </p>
              </div>

              {/* Closed Won value */}
              <div
                className="bg-white rounded-lg border border-gray-200 p-6 flex flex-col gap-1"
                data-testid="stat-won-value"
              >
                <p className="text-sm font-medium text-gray-500 uppercase tracking-wide">
                  {t('reports.winLoss.wonValueLabel')}
                </p>
                <p
                  className="text-2xl font-bold text-green-600 break-all"
                  data-testid="stat-won-value-value"
                >
                  {formatCurrency(report.wonValue, i18n.language)}
                </p>
              </div>

              {/* Closed Lost count */}
              <div
                className="bg-white rounded-lg border border-gray-200 p-6 flex flex-col gap-1"
                data-testid="stat-lost-count"
              >
                <p className="text-sm font-medium text-gray-500 uppercase tracking-wide">
                  {t('reports.winLoss.lostCountLabel')}
                </p>
                <p className="text-3xl font-bold text-red-600" data-testid="stat-lost-count-value">
                  {report.lostCount}
                </p>
              </div>

              {/* Closed Lost value */}
              <div
                className="bg-white rounded-lg border border-gray-200 p-6 flex flex-col gap-1"
                data-testid="stat-lost-value"
              >
                <p className="text-sm font-medium text-gray-500 uppercase tracking-wide">
                  {t('reports.winLoss.lostValueLabel')}
                </p>
                <p
                  className="text-2xl font-bold text-red-600 break-all"
                  data-testid="stat-lost-value-value"
                >
                  {formatCurrency(report.lostValue, i18n.language)}
                </p>
              </div>

              {/* Win rate */}
              <div
                className="bg-white rounded-lg border border-gray-200 p-6 flex flex-col gap-1"
                data-testid="stat-win-rate"
              >
                <p className="text-sm font-medium text-gray-500 uppercase tracking-wide">
                  {t('reports.winLoss.winRateLabel')}
                </p>
                <p className="text-3xl font-bold text-gray-900" data-testid="stat-win-rate-value">
                  {formatWinRate(report.winRate)}
                </p>
              </div>
            </div>

            {/* Loss reason breakdown */}
            <div
              className="bg-white rounded-lg border border-gray-200"
              data-testid="loss-reason-breakdown"
            >
              <div className="px-6 py-4 border-b border-gray-200">
                <h2 className="text-base font-semibold text-gray-900">
                  {t('reports.winLoss.lossReasonHeading')}
                </h2>
              </div>

              {report.lossReasonBreakdown.length === 0 ? (
                <p
                  className="px-6 py-8 text-sm text-gray-400 text-center"
                  data-testid="loss-reason-empty"
                >
                  {t('reports.winLoss.lossReasonEmpty')}
                </p>
              ) : (
                <table
                  className="min-w-full divide-y divide-gray-100"
                  data-testid="loss-reason-table"
                >
                  <thead className="bg-gray-50">
                    <tr>
                      <th
                        scope="col"
                        className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                      >
                        {t('reports.winLoss.columnReason')}
                      </th>
                      <th
                        scope="col"
                        className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider"
                      >
                        {t('reports.winLoss.columnCount')}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-100">
                    {report.lossReasonBreakdown.map((row) => (
                      <tr key={row.reason} data-testid={`loss-reason-row-${row.reason}`}>
                        <td className="px-6 py-4 text-sm font-medium text-gray-900">
                          {row.reason}
                        </td>
                        <td
                          className="px-6 py-4 text-sm text-gray-600 text-right"
                          data-testid={`loss-reason-count-${row.reason}`}
                        >
                          {row.count}
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
