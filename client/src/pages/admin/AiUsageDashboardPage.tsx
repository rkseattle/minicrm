/**
 * AiUsageDashboardPage — admin AI usage/cost visibility dashboard. (MINCRM-459)
 *
 * Shows current-range token totals, estimated cost, trend vs. the prior
 * equivalent-length period, per-user and per-feature breakdowns, a daily
 * token consumption chart, and CSV export.
 *
 * Cost estimates are computed from self-reported token counts x the
 * admin-configured rate (Admin Settings -> AI -> Cost Estimation Rates) —
 * there is no reconciliation against provider billing. See the disclaimer
 * rendered on this page and docs/admin-guide.md for the documented limitation.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import NavBar from '@/components/NavBar.js';
import { Button } from '@/components/ui/Button.js';
import {
  getAiUsageSummary,
  getAiUsageDaily,
  exportAiUsageCsv,
  AI_USAGE_SUMMARY_QUERY_KEY,
  AI_USAGE_DAILY_QUERY_KEY,
} from '@/api/ai.js';
import type { UsageDateRangeQuery } from '@/api/ai.js';
import type { UsageDateRangePreset } from '@shared/schemas/aiUsageSchema.js';

const PRESETS: UsageDateRangePreset[] = ['current_month', 'last_month', 'last_3_months'];

/** Maps each preset to its i18n key — explicit rather than derived to avoid
 * fragile string transforms (e.g. 'last_3_months' does not camel-case cleanly). */
const PRESET_I18N_KEYS: Record<UsageDateRangePreset, string> = {
  current_month: 'aiUsageDashboard.presetCurrentMonth',
  last_month: 'aiUsageDashboard.presetLastMonth',
  last_3_months: 'aiUsageDashboard.presetLast3Months',
};

function formatCost(cents: number): string {
  return (cents / 100).toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
  });
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function firstOfMonthIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
}

export default function AiUsageDashboardPage() {
  const { t } = useTranslation();

  const [preset, setPreset] = useState<UsageDateRangePreset | 'custom'>('current_month');
  const [customStart, setCustomStart] = useState(firstOfMonthIso());
  const [customEnd, setCustomEnd] = useState(todayIso());
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState('');

  const range: UsageDateRangeQuery =
    preset === 'custom'
      ? { start: customStart, end: customEnd }
      : { preset: preset as UsageDateRangePreset };

  const {
    data: summary,
    isLoading: summaryLoading,
    isError: summaryError,
  } = useQuery({
    queryKey: [...AI_USAGE_SUMMARY_QUERY_KEY, range],
    queryFn: () => getAiUsageSummary(range),
  });

  const {
    data: daily,
    isLoading: dailyLoading,
    isError: dailyError,
  } = useQuery({
    queryKey: [...AI_USAGE_DAILY_QUERY_KEY, range],
    queryFn: () => getAiUsageDaily(range),
  });

  const handleExport = async () => {
    setIsExporting(true);
    setExportError('');
    try {
      await exportAiUsageCsv(range);
    } catch {
      setExportError(t('aiUsageDashboard.exportError'));
    } finally {
      setIsExporting(false);
    }
  };

  const trendPercentage =
    summary && summary.prior_period_estimated_cost_cents > 0
      ? Math.round(
          ((summary.estimated_cost_cents - summary.prior_period_estimated_cost_cents) /
            summary.prior_period_estimated_cost_cents) *
            100,
        )
      : null;

  const maxDailyTokens = daily
    ? Math.max(1, ...daily.points.map((p) => p.input_tokens + p.output_tokens))
    : 1;

  return (
    <div className="min-h-screen bg-gray-50">
      <NavBar />
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8" data-testid="ai-usage-dashboard-page">
        <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1
              className="text-2xl font-bold text-gray-900"
              data-testid="ai-usage-dashboard-heading"
            >
              {t('aiUsageDashboard.pageTitle')}
            </h1>
            <p className="mt-1 text-sm text-gray-600">{t('aiUsageDashboard.description')}</p>
          </div>
          <Button
            variant="secondary"
            onClick={handleExport}
            disabled={isExporting}
            data-testid="ai-usage-export-csv-button"
          >
            {isExporting ? t('aiUsageDashboard.exporting') : t('aiUsageDashboard.exportCsv')}
          </Button>
        </div>

        {exportError && (
          <p className="mb-4 text-sm text-red-600" data-testid="ai-usage-export-error">
            {exportError}
          </p>
        )}

        {/* Disclaimer about self-reported cost estimation (MINCRM-459 descope) */}
        <p
          className="mb-6 text-xs text-gray-500 bg-gray-100 border border-gray-200 rounded px-3 py-2"
          data-testid="ai-usage-disclaimer"
        >
          {t('aiUsageDashboard.disclaimer')}{' '}
          <Link
            to="/admin/settings?tab=ai"
            className="text-indigo-600 hover:text-indigo-800 underline"
          >
            {t('aiUsageDashboard.disclaimerLink')}
          </Link>
        </p>

        {/* Date range selector */}
        <div
          className="mb-6 inline-flex flex-wrap rounded-md border border-gray-300 overflow-hidden"
          data-testid="ai-usage-range-selector"
        >
          {PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPreset(p)}
              className={`px-4 py-2 text-sm font-medium border-e border-gray-300 last:border-e-0 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-primary-500 ${
                preset === p
                  ? 'bg-primary-600 text-white'
                  : 'bg-white text-gray-700 hover:bg-gray-50'
              }`}
              data-testid={`ai-usage-range-${p}`}
            >
              {t(PRESET_I18N_KEYS[p])}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setPreset('custom')}
            className={`px-4 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-inset focus:ring-primary-500 ${
              preset === 'custom'
                ? 'bg-primary-600 text-white'
                : 'bg-white text-gray-700 hover:bg-gray-50'
            }`}
            data-testid="ai-usage-range-custom"
          >
            {t('aiUsageDashboard.presetCustom')}
          </button>
        </div>

        {preset === 'custom' && (
          <div className="mb-6 flex gap-3 items-end">
            <div>
              <label htmlFor="ai-usage-custom-start" className="block text-xs text-gray-600 mb-1">
                {t('aiUsageDashboard.customStartLabel')}
              </label>
              <input
                id="ai-usage-custom-start"
                type="date"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                className="rounded-md border border-gray-300 px-3 py-2 text-sm"
                data-testid="ai-usage-custom-start-input"
              />
            </div>
            <div>
              <label htmlFor="ai-usage-custom-end" className="block text-xs text-gray-600 mb-1">
                {t('aiUsageDashboard.customEndLabel')}
              </label>
              <input
                id="ai-usage-custom-end"
                type="date"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="rounded-md border border-gray-300 px-3 py-2 text-sm"
                data-testid="ai-usage-custom-end-input"
              />
            </div>
          </div>
        )}

        {summaryLoading && (
          <div className="animate-pulse space-y-2 py-4" data-testid="ai-usage-summary-loading">
            <div className="h-6 bg-gray-200 rounded w-1/4" />
            <div className="h-24 bg-gray-200 rounded" />
          </div>
        )}

        {summaryError && (
          <p className="text-sm text-red-600" data-testid="ai-usage-summary-error">
            {t('aiUsageDashboard.loadError')}
          </p>
        )}

        {summary && !summaryLoading && !summaryError && (
          <>
            {/* Summary cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
              <div
                className="bg-white rounded-lg border border-gray-200 p-4"
                data-testid="ai-usage-total-tokens-card"
              >
                <p className="text-xs text-gray-500 uppercase tracking-wide">
                  {t('aiUsageDashboard.totalTokens')}
                </p>
                <p className="mt-1 text-2xl font-semibold text-gray-900">
                  {(summary.input_tokens + summary.output_tokens).toLocaleString()}
                </p>
                <p className="mt-1 text-xs text-gray-500">
                  {t('aiUsageDashboard.tokenBreakdown', {
                    input: summary.input_tokens.toLocaleString(),
                    output: summary.output_tokens.toLocaleString(),
                  })}
                </p>
              </div>
              <div
                className="bg-white rounded-lg border border-gray-200 p-4"
                data-testid="ai-usage-cost-card"
              >
                <p className="text-xs text-gray-500 uppercase tracking-wide">
                  {t('aiUsageDashboard.estimatedCost')}
                </p>
                <p className="mt-1 text-2xl font-semibold text-gray-900">
                  {formatCost(summary.estimated_cost_cents)}
                </p>
              </div>
              <div
                className="bg-white rounded-lg border border-gray-200 p-4"
                data-testid="ai-usage-trend-card"
              >
                <p className="text-xs text-gray-500 uppercase tracking-wide">
                  {t('aiUsageDashboard.trend')}
                </p>
                <p className="mt-1 text-2xl font-semibold text-gray-900">
                  {trendPercentage === null
                    ? t('aiUsageDashboard.trendUnavailable')
                    : `${trendPercentage > 0 ? '+' : ''}${trendPercentage}%`}
                </p>
              </div>
            </div>

            {/* Daily consumption chart */}
            <div
              className="bg-white rounded-lg border border-gray-200 p-4 mb-8"
              data-testid="ai-usage-daily-chart"
            >
              <h2 className="text-sm font-semibold text-gray-800 mb-3">
                {t('aiUsageDashboard.dailyChartHeading')}
              </h2>
              {dailyLoading && (
                <div
                  className="h-32 animate-pulse bg-gray-100 rounded"
                  data-testid="ai-usage-daily-loading"
                />
              )}
              {dailyError && (
                <p className="text-sm text-red-600" data-testid="ai-usage-daily-error">
                  {t('aiUsageDashboard.loadError')}
                </p>
              )}
              {daily && !dailyLoading && !dailyError && (
                <>
                  {daily.points.length === 0 ? (
                    <p className="text-sm text-gray-500" data-testid="ai-usage-daily-empty">
                      {t('aiUsageDashboard.noDailyData')}
                    </p>
                  ) : (
                    <div className="flex items-end gap-1 h-32" data-testid="ai-usage-daily-bars">
                      {daily.points.map((point) => {
                        const total = point.input_tokens + point.output_tokens;
                        const heightPct = Math.max(2, (total / maxDailyTokens) * 100);
                        return (
                          <div
                            key={point.date}
                            className="flex-1 bg-primary-500 rounded-t"
                            style={{ height: `${heightPct}%` }}
                            title={`${point.date}: ${total.toLocaleString()} tokens`}
                            data-testid={`ai-usage-daily-bar-${point.date}`}
                          />
                        );
                      })}
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Per-user breakdown */}
            <div className="mb-8">
              <h2 className="text-sm font-semibold text-gray-800 mb-3">
                {t('aiUsageDashboard.perUserHeading')}
              </h2>
              <div className="overflow-x-auto rounded-md border border-gray-200">
                <table
                  className="min-w-full divide-y divide-gray-200"
                  data-testid="ai-usage-per-user-table"
                >
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-2 text-start text-xs font-medium text-gray-500 uppercase tracking-wider">
                        {t('aiUsageDashboard.tableUser')}
                      </th>
                      <th className="px-4 py-2 text-start text-xs font-medium text-gray-500 uppercase tracking-wider">
                        {t('aiUsageDashboard.tableTokens')}
                      </th>
                      <th className="px-4 py-2 text-start text-xs font-medium text-gray-500 uppercase tracking-wider">
                        {t('aiUsageDashboard.tableCost')}
                      </th>
                      <th className="px-4 py-2 text-start text-xs font-medium text-gray-500 uppercase tracking-wider">
                        {t('aiUsageDashboard.tableBudget')}
                      </th>
                      <th className="px-4 py-2 text-start text-xs font-medium text-gray-500 uppercase tracking-wider">
                        {t('aiUsageDashboard.tableTopFeature')}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-100">
                    {summary.per_user.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-4 py-6 text-center text-sm text-gray-500">
                          {t('aiUsageDashboard.noUsageData')}
                        </td>
                      </tr>
                    ) : (
                      summary.per_user.map((row) => (
                        <tr key={row.user_id} data-testid={`ai-usage-user-row-${row.user_id}`}>
                          <td className="px-4 py-2 text-sm text-gray-900">
                            <div className="font-medium">{row.user_name}</div>
                            <div className="text-xs text-gray-500">{row.user_email}</div>
                          </td>
                          <td className="px-4 py-2 text-sm text-gray-600">
                            {(row.input_tokens + row.output_tokens).toLocaleString()}
                          </td>
                          <td className="px-4 py-2 text-sm text-gray-600">
                            {formatCost(row.estimated_cost_cents)}
                          </td>
                          <td className="px-4 py-2 text-sm text-gray-600">
                            {row.budget_percentage === null ? '—' : `${row.budget_percentage}%`}
                          </td>
                          <td className="px-4 py-2 text-sm text-gray-600">
                            {row.top_feature ?? '—'}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Per-feature breakdown */}
            <div>
              <h2 className="text-sm font-semibold text-gray-800 mb-3">
                {t('aiUsageDashboard.perFeatureHeading')}
              </h2>
              <div className="overflow-x-auto rounded-md border border-gray-200">
                <table
                  className="min-w-full divide-y divide-gray-200"
                  data-testid="ai-usage-per-feature-table"
                >
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-2 text-start text-xs font-medium text-gray-500 uppercase tracking-wider">
                        {t('aiUsageDashboard.tableFeature')}
                      </th>
                      <th className="px-4 py-2 text-start text-xs font-medium text-gray-500 uppercase tracking-wider">
                        {t('aiUsageDashboard.tableTokens')}
                      </th>
                      <th className="px-4 py-2 text-start text-xs font-medium text-gray-500 uppercase tracking-wider">
                        {t('aiUsageDashboard.tableCost')}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-100">
                    {summary.per_feature.length === 0 ? (
                      <tr>
                        <td colSpan={3} className="px-4 py-6 text-center text-sm text-gray-500">
                          {t('aiUsageDashboard.noUsageData')}
                        </td>
                      </tr>
                    ) : (
                      summary.per_feature.map((row) => (
                        <tr key={row.feature} data-testid={`ai-usage-feature-row-${row.feature}`}>
                          <td className="px-4 py-2 text-sm text-gray-900">{row.feature}</td>
                          <td className="px-4 py-2 text-sm text-gray-600">
                            {(row.input_tokens + row.output_tokens).toLocaleString()}
                          </td>
                          <td className="px-4 py-2 text-sm text-gray-600">
                            {formatCost(row.estimated_cost_cents)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
