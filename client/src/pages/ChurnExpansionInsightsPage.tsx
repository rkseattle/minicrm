/**
 * ChurnExpansionInsightsPage component.
 * Displays the cached AI churn-risk and expansion-opportunity signals from
 * the most recent nightly detection run. Never triggers a synchronous AI call.
 */

import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import NavBar from '@/components/NavBar.js';
import { listChurnExpansionSignals, CHURN_EXPANSION_LIST_QUERY_KEY } from '@/api/churnExpansion.js';
import { useFeatureFlag } from '@/hooks/useFeatureFlag.js';
import type { ChurnExpansionAccountSummary } from '@shared/schemas/churnExpansionSchema.js';

function AccountSignalRow({ summary }: { summary: ChurnExpansionAccountSummary }) {
  const { t } = useTranslation();
  return (
    <li
      className="px-6 py-4 flex flex-col gap-1"
      data-testid={`churn-expansion-account-${summary.account_id}`}
    >
      <Link
        to={`/accounts/${summary.account_id}`}
        className="text-sm font-medium text-primary-600 hover:underline"
      >
        {summary.account_name}
      </Link>
      {summary.signal.contributing_factors.slice(0, 2).map((factor, index) => (
        <p key={index} className="text-sm text-gray-700">
          {factor.description}
        </p>
      ))}
      <p className="text-xs text-gray-500">
        {t('churnExpansion.confidenceLabel', {
          confidence: Math.round(summary.signal.confidence * 100),
        })}
      </p>
    </li>
  );
}

export default function ChurnExpansionInsightsPage() {
  const { t } = useTranslation();
  const { enabled: featureEnabled, isLoading: featureFlagLoading } = useFeatureFlag(
    'ai_churn_expansion_detection',
  );

  const { data, isLoading, isError } = useQuery({
    queryKey: CHURN_EXPANSION_LIST_QUERY_KEY,
    queryFn: listChurnExpansionSignals,
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
          <p className="text-gray-500 text-sm">{t('churnExpansion.notAvailable')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <NavBar />
      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
        <h1
          className="text-2xl font-bold text-gray-900 mb-6"
          data-testid="churn-expansion-insights-heading"
        >
          {t('churnExpansion.insightsHeading')}
        </h1>

        {isLoading && (
          <div className="space-y-2" aria-hidden="true">
            <div className="h-4 w-48 bg-gray-100 rounded animate-pulse" />
            <div className="h-24 w-full bg-gray-100 rounded animate-pulse" />
          </div>
        )}

        {isError && (
          <p
            role="alert"
            className="text-sm text-red-600"
            data-testid="churn-expansion-insights-error"
          >
            {t('churnExpansion.loadFailed')}
          </p>
        )}

        {!isLoading && !isError && data && (
          <>
            <section className="mb-8" aria-labelledby="at-risk-accounts-heading">
              <h2
                id="at-risk-accounts-heading"
                className="text-sm font-semibold text-gray-900 mb-3"
                data-testid="at-risk-accounts-heading"
              >
                {t('churnExpansion.atRiskHeading')}
              </h2>
              <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                {data.at_risk.length === 0 ? (
                  <p
                    className="px-6 py-4 text-sm text-gray-500"
                    data-testid="at-risk-accounts-empty"
                  >
                    {t('churnExpansion.atRiskEmpty')}
                  </p>
                ) : (
                  <ul className="divide-y divide-gray-100" data-testid="at-risk-accounts-list">
                    {data.at_risk.map((summary) => (
                      <AccountSignalRow key={summary.account_id} summary={summary} />
                    ))}
                  </ul>
                )}
              </div>
            </section>

            <section aria-labelledby="expansion-accounts-heading">
              <h2
                id="expansion-accounts-heading"
                className="text-sm font-semibold text-gray-900 mb-3"
                data-testid="expansion-accounts-heading"
              >
                {t('churnExpansion.expansionHeading')}
              </h2>
              <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                {data.expansion.length === 0 ? (
                  <p
                    className="px-6 py-4 text-sm text-gray-500"
                    data-testid="expansion-accounts-empty"
                  >
                    {t('churnExpansion.expansionEmpty')}
                  </p>
                ) : (
                  <ul className="divide-y divide-gray-100" data-testid="expansion-accounts-list">
                    {data.expansion.map((summary) => (
                      <AccountSignalRow key={summary.account_id} summary={summary} />
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
