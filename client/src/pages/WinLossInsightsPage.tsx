/**
 * WinLossInsightsPage component. (MINCRM-464)
 * Displays cached AI-generated win/loss pattern insights and loss reason
 * trends from the most recent nightly analysis run. Never triggers a
 * synchronous AI call — always reads the cached result.
 */

import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useState } from 'react';
import NavBar from '@/components/NavBar.js';
import { Button } from '@/components/ui/Button.js';
import { Badge } from '@/components/ui/Badge.js';
import {
  getWinLossInsights,
  exportWinLossInsightsCsv,
  exportWinLossInsightsPdf,
  WIN_LOSS_INSIGHTS_QUERY_KEY,
} from '@/api/winLossInsights.js';
import { useFeatureFlag } from '@/hooks/useFeatureFlag.js';
import type { WinLossInsight } from '@shared/schemas/winLossInsightSchema.js';

function formatWinRate(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

function InsightRow({ insight }: { insight: WinLossInsight }) {
  const { t } = useTranslation();
  return (
    <li className="px-6 py-4 flex flex-col gap-1" data-testid={`win-loss-insight-${insight.id}`}>
      <p className="text-sm text-gray-900">{insight.observation}</p>
      <p className="text-xs text-gray-500">
        {t('insights.insightStats', {
          winRateWith: formatWinRate(insight.win_rate_with),
          winRateWithout: formatWinRate(insight.win_rate_without),
          count: insight.sample_size,
        })}
      </p>
    </li>
  );
}

export default function WinLossInsightsPage() {
  const { t } = useTranslation();
  const { enabled: featureEnabled, isLoading: featureFlagLoading } =
    useFeatureFlag('ai_win_loss_insights');
  const [exportError, setExportError] = useState<string | null>(null);
  const [isExportingCsv, setIsExportingCsv] = useState(false);
  const [isExportingPdf, setIsExportingPdf] = useState(false);

  const { data, isLoading, isError } = useQuery({
    queryKey: WIN_LOSS_INSIGHTS_QUERY_KEY,
    queryFn: getWinLossInsights,
    enabled: featureEnabled,
  });

  if (featureFlagLoading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <NavBar />
        <div className="flex items-center justify-center h-64">
          <div className="text-gray-400 text-sm">{t('common.loading')}</div>
        </div>
      </div>
    );
  }

  if (!featureEnabled) {
    return (
      <div className="min-h-screen bg-gray-50">
        <NavBar />
        <div className="flex items-center justify-center h-64">
          <p className="text-gray-500 text-sm">{t('insights.notAvailable')}</p>
        </div>
      </div>
    );
  }

  const winPatterns = (data?.insights ?? []).filter((i) => i.is_win_pattern);
  const lossPatterns = (data?.insights ?? []).filter((i) => !i.is_win_pattern);

  return (
    <div className="min-h-screen bg-gray-50">
      <NavBar />
      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-gray-900" data-testid="win-loss-insights-heading">
            {t('insights.winLossHeading')}
          </h1>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              data-testid="win-loss-export-csv-button"
              disabled={isExportingCsv || !data?.has_sufficient_data}
              onClick={async () => {
                setExportError(null);
                setIsExportingCsv(true);
                try {
                  await exportWinLossInsightsCsv();
                } catch {
                  setExportError(t('insights.exportFailed'));
                } finally {
                  setIsExportingCsv(false);
                }
              }}
            >
              {isExportingCsv ? t('insights.exporting') : t('insights.exportCsv')}
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              data-testid="win-loss-export-pdf-button"
              disabled={isExportingPdf || !data?.has_sufficient_data}
              onClick={async () => {
                setExportError(null);
                setIsExportingPdf(true);
                try {
                  await exportWinLossInsightsPdf();
                } catch {
                  setExportError(t('insights.exportFailed'));
                } finally {
                  setIsExportingPdf(false);
                }
              }}
            >
              {isExportingPdf ? t('insights.exporting') : t('insights.exportPdf')}
            </Button>
          </div>
        </div>

        {exportError && (
          <p role="alert" className="mb-4 text-sm text-red-600" data-testid="win-loss-export-error">
            {exportError}
          </p>
        )}

        {isLoading && (
          <div className="space-y-2" aria-hidden="true">
            <div className="h-4 w-48 bg-gray-100 rounded animate-pulse" />
            <div className="h-24 w-full bg-gray-100 rounded animate-pulse" />
          </div>
        )}

        {isError && (
          <p role="alert" className="text-sm text-red-600" data-testid="win-loss-insights-error">
            {t('insights.loadFailed')}
          </p>
        )}

        {!isLoading && !isError && data && !data.has_sufficient_data && (
          <p className="text-sm text-gray-500" data-testid="win-loss-insufficient-data">
            {t('insights.insufficientData', { count: data.min_closed_deals_required })}
          </p>
        )}

        {!isLoading && !isError && data && data.has_sufficient_data && (
          <>
            <section className="mb-8" aria-labelledby="win-patterns-heading">
              <h2
                id="win-patterns-heading"
                className="text-sm font-semibold text-gray-900 mb-3"
                data-testid="win-patterns-heading"
              >
                {t('insights.winPatternsHeading')}
              </h2>
              <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                {winPatterns.length === 0 ? (
                  <p className="px-6 py-4 text-sm text-gray-500" data-testid="win-patterns-empty">
                    {t('insights.winPatternsEmpty')}
                  </p>
                ) : (
                  <ul className="divide-y divide-gray-100" data-testid="win-patterns-list">
                    {winPatterns.map((insight) => (
                      <InsightRow key={insight.id} insight={insight} />
                    ))}
                  </ul>
                )}
              </div>
            </section>

            <section className="mb-8" aria-labelledby="loss-patterns-heading">
              <h2
                id="loss-patterns-heading"
                className="text-sm font-semibold text-gray-900 mb-3"
                data-testid="loss-patterns-heading"
              >
                {t('insights.lossPatternsHeading')}
              </h2>
              <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                {lossPatterns.length === 0 ? (
                  <p className="px-6 py-4 text-sm text-gray-500" data-testid="loss-patterns-empty">
                    {t('insights.lossPatternsEmpty')}
                  </p>
                ) : (
                  <ul className="divide-y divide-gray-100" data-testid="loss-patterns-list">
                    {lossPatterns.map((insight) => (
                      <InsightRow key={insight.id} insight={insight} />
                    ))}
                  </ul>
                )}
              </div>
            </section>

            <section aria-labelledby="loss-reason-trends-heading">
              <h2
                id="loss-reason-trends-heading"
                className="text-sm font-semibold text-gray-900 mb-3"
                data-testid="loss-reason-trends-heading"
              >
                {t('insights.lossReasonTrendsHeading')}
              </h2>
              <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                {data.loss_reason_trends.length === 0 ? (
                  <p
                    className="px-6 py-4 text-sm text-gray-500"
                    data-testid="loss-reason-trends-empty"
                  >
                    {t('insights.lossReasonTrendsEmpty')}
                  </p>
                ) : (
                  <ul className="divide-y divide-gray-100" data-testid="loss-reason-trends-list">
                    {data.loss_reason_trends.map((trend, index) => (
                      <li key={index} className="px-6 py-4">
                        <Badge variant="warning">{t('insights.trendBadge')}</Badge>
                        <p className="mt-2 text-sm text-gray-900">{trend.observation}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
