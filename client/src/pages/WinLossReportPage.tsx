/**
 * WinLossReportPage component.
 * Displays a win/loss report for a selected date range:
 * - Closed Won count and total value
 * - Closed Lost count and total value
 * - Win rate (Won / Total Closed)
 * - Loss reason breakdown (when loss reasons were captured)
 * - Per-rep breakdown table (admin Team View only) (MINCRM-264)
 *
 * Date range defaults to the current month; presets for "this quarter" and
 * a custom range are also available.
 * Admins see a My View / Team View toggle; reps always see only their own data.
 * Implements MINCRM-26, MINCRM-264, MINCRM-407.
 */

import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import NavBar from '@/components/NavBar.js';
import ReportFilterBar from '@/components/ReportFilterBar.js';
import { useReportFilters } from '@/hooks/useReportFilters.js';
import {
  getWinLossReport,
  WIN_LOSS_REPORT_QUERY_KEY,
  type WinLossReportParams,
} from '@/api/reports.js';

/**
 * Formats a numeric string as a currency amount using the active i18next locale.
 *
 * @param value - Numeric string from the API (e.g. "87000.00")
 * @param locale - BCP 47 language tag from i18next (e.g. "en", "de", "zh")
 * @param currency - ISO 4217 currency code (e.g. "USD", "EUR") (MINCRM-189)
 */
function formatCurrency(value: string, locale: string, currency: string): string {
  const number = parseFloat(value);
  if (isNaN(number)) return '—';
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(number);
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

/**
 * Standalone Win/Loss report page — includes NavBar.
 * When embedded in ReportsPage shell, use WinLossReportContent instead. (MINCRM-294)
 */
export default function WinLossReportPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <NavBar />
      <WinLossReportContent />
    </div>
  );
}

/**
 * Win/loss report content — no NavBar wrapper.
 * Consumed by ReportsPage shell. (MINCRM-294)
 * Implements MINCRM-26, MINCRM-264.
 */
export function WinLossReportContent() {
  const { t, i18n } = useTranslation();

  const filters = useReportFilters('currentMonth');
  const { resolvedStart, resolvedEnd, effectiveOwnerId, isAdmin, viewMode } = filters;

  const reportParams: WinLossReportParams = {
    start: resolvedStart,
    end: resolvedEnd,
    ownerId: effectiveOwnerId,
  };

  const {
    data: report,
    isLoading,
    isError,
  } = useQuery({
    queryKey: [...WIN_LOSS_REPORT_QUERY_KEY, reportParams],
    queryFn: () => getWinLossReport(reportParams),
    enabled: resolvedStart <= resolvedEnd,
  });

  const headingKey =
    !isAdmin || viewMode === 'my' ? 'reports.winLoss.pageTitleMy' : 'reports.winLoss.pageTitleTeam';

  return (
    <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
      {/* Page header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900" data-testid="win-loss-report-heading">
          {t(headingKey)}
        </h1>
        <p className="text-sm text-gray-500 mt-1">{t('reports.winLoss.subtitle')}</p>
      </div>

      <ReportFilterBar
        filters={filters}
        i18nPrefix="reports.winLoss"
        availablePresets={['currentMonth', 'currentQuarter', 'custom']}
      />

      {/* Loading state */}
      {isLoading && (
        <p className="text-sm text-gray-500" data-testid="report-loading">
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
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-6"
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
              <p
                className="text-[clamp(1rem,2.5vw,1.5rem)] font-bold text-green-600"
                data-testid="stat-won-count-value"
              >
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
                className="text-[clamp(1rem,2.5vw,1.5rem)] font-bold text-green-600 break-words"
                data-testid="stat-won-value-value"
              >
                {report.mixedCurrencies
                  ? t('pipeline.mixedCurrency')
                  : formatCurrency(report.wonValue, i18n.language, report.currency ?? 'USD')}
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
              <p
                className="text-[clamp(1rem,2.5vw,1.5rem)] font-bold text-red-600"
                data-testid="stat-lost-count-value"
              >
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
                className="text-[clamp(1rem,2.5vw,1.5rem)] font-bold text-red-600 break-words"
                data-testid="stat-lost-value-value"
              >
                {report.mixedCurrencies
                  ? t('pipeline.mixedCurrency')
                  : formatCurrency(report.lostValue, i18n.language, report.currency ?? 'USD')}
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
              <p
                className="text-[clamp(1rem,2.5vw,1.5rem)] font-bold text-gray-900 whitespace-nowrap"
                data-testid="stat-win-rate-value"
              >
                {formatWinRate(report.winRate)}
              </p>
            </div>
          </div>

          {/* Converted totals in home currency (MINCRM-253) — only shown when rates exist */}
          {report.hasRates && (
            <div
              className="bg-white rounded-lg border border-gray-200 p-4 mb-6 flex flex-col gap-2"
              data-testid="converted-totals-summary"
            >
              <div className="flex flex-wrap gap-6">
                <div>
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
                    {t('reports.winLoss.wonValueLabel')}
                    {' ('}
                    {report.homeCurrency}
                    {')'}
                  </p>
                  <p
                    className="text-[clamp(1rem,2.5vw,1.5rem)] font-bold text-green-600 break-words"
                    data-testid="stat-converted-won-value"
                  >
                    {report.convertedWonValue !== null
                      ? formatCurrency(
                          report.convertedWonValue,
                          i18n.language,
                          report.homeCurrency ?? 'USD',
                        )
                      : '—'}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-1">
                    {t('reports.winLoss.lostValueLabel')}
                    {' ('}
                    {report.homeCurrency}
                    {')'}
                  </p>
                  <p
                    className="text-[clamp(1rem,2.5vw,1.5rem)] font-bold text-red-600 break-words"
                    data-testid="stat-converted-lost-value"
                  >
                    {report.convertedLostValue !== null
                      ? formatCurrency(
                          report.convertedLostValue,
                          i18n.language,
                          report.homeCurrency ?? 'USD',
                        )
                      : '—'}
                  </p>
                </div>
              </div>
              {/* Rates footnote */}
              <p className="text-xs text-gray-500" data-testid="converted-totals-footnote">
                {t('reports.winLoss.convertedFootnote', {
                  currency: report.homeCurrency ?? '',
                  date: report.ratesLastUpdated
                    ? new Date(report.ratesLastUpdated).toLocaleDateString(i18n.language)
                    : '—',
                })}
              </p>
              {/* Unrated currencies note */}
              {report.unratedCount > 0 && (
                <p className="text-xs text-yellow-600" data-testid="converted-totals-unrated-note">
                  {t('reports.winLoss.unratedNote', { count: report.unratedCount })}
                </p>
              )}
            </div>
          )}

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
                className="px-6 py-8 text-sm text-gray-500 text-center"
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
                      className="px-6 py-3 text-start text-xs font-medium text-gray-500 uppercase tracking-wider"
                    >
                      {t('reports.winLoss.columnReason')}
                    </th>
                    <th
                      scope="col"
                      className="px-6 py-3 text-end text-xs font-medium text-gray-500 uppercase tracking-wider"
                    >
                      {t('reports.winLoss.columnCount')}
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-100">
                  {report.lossReasonBreakdown.map((row) => (
                    <tr key={row.reason} data-testid={`loss-reason-row-${row.reason}`}>
                      <td className="px-6 py-4 text-sm font-medium text-gray-900">{row.reason}</td>
                      <td
                        className="px-6 py-4 text-sm text-gray-600 text-end"
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

          {/* Per-rep breakdown — admin Team View only (MINCRM-264) */}
          {isAdmin && viewMode === 'team' && (
            <div
              className="bg-white rounded-lg border border-gray-200 mt-6"
              data-testid="rep-breakdown-table-container"
            >
              <div className="px-6 py-4 border-b border-gray-200">
                <h2 className="text-base font-semibold text-gray-900">
                  {t('reports.winLoss.repBreakdownHeading')}
                </h2>
              </div>
              {report.repRows.length === 0 ? (
                <p
                  className="px-6 py-8 text-sm text-gray-500 text-center"
                  data-testid="rep-breakdown-empty"
                >
                  {t('reports.winLoss.repBreakdownEmpty')}
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table
                    className="min-w-full divide-y divide-gray-100"
                    data-testid="rep-breakdown-table"
                  >
                    <thead className="bg-gray-50">
                      <tr>
                        <th
                          scope="col"
                          className="px-6 py-3 text-start text-xs font-medium text-gray-500 uppercase tracking-wider"
                        >
                          {t('reports.winLoss.columnRep')}
                        </th>
                        <th
                          scope="col"
                          className="px-4 py-3 text-end text-xs font-medium text-gray-500 uppercase tracking-wider"
                        >
                          {t('reports.winLoss.columnWon')}
                        </th>
                        <th
                          scope="col"
                          className="px-4 py-3 text-end text-xs font-medium text-gray-500 uppercase tracking-wider"
                        >
                          {t('reports.winLoss.columnWonValue')}
                        </th>
                        <th
                          scope="col"
                          className="px-4 py-3 text-end text-xs font-medium text-gray-500 uppercase tracking-wider"
                        >
                          {t('reports.winLoss.columnLost')}
                        </th>
                        <th
                          scope="col"
                          className="px-4 py-3 text-end text-xs font-medium text-gray-500 uppercase tracking-wider"
                        >
                          {t('reports.winLoss.columnLostValue')}
                        </th>
                        <th
                          scope="col"
                          className="px-4 py-3 text-end text-xs font-medium text-gray-500 uppercase tracking-wider"
                        >
                          {t('reports.winLoss.columnWinRate')}
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-100">
                      {report.repRows.map((row) => (
                        <tr key={row.ownerId} data-testid={`rep-breakdown-row-${row.ownerId}`}>
                          <td className="px-6 py-3 text-sm font-medium text-gray-900">
                            {row.ownerName}
                          </td>
                          <td
                            className="px-4 py-3 text-sm text-end text-gray-900"
                            data-testid={`rep-breakdown-won-count-${row.ownerId}`}
                          >
                            {row.wonCount}
                          </td>
                          <td
                            className="px-4 py-3 text-sm text-end text-gray-900 break-words"
                            data-testid={`rep-breakdown-won-value-${row.ownerId}`}
                          >
                            {formatCurrency(row.wonValue, i18n.language, report.currency ?? 'USD')}
                          </td>
                          <td
                            className="px-4 py-3 text-sm text-end text-gray-900"
                            data-testid={`rep-breakdown-lost-count-${row.ownerId}`}
                          >
                            {row.lostCount}
                          </td>
                          <td
                            className="px-4 py-3 text-sm text-end text-gray-900 break-words"
                            data-testid={`rep-breakdown-lost-value-${row.ownerId}`}
                          >
                            {formatCurrency(row.lostValue, i18n.language, report.currency ?? 'USD')}
                          </td>
                          <td
                            className="px-4 py-3 text-sm text-end text-gray-900"
                            data-testid={`rep-breakdown-win-rate-${row.ownerId}`}
                          >
                            {formatWinRate(row.winRate)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </main>
  );
}
