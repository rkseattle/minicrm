/**
 * CoachingInsightsPage component. (MINCRM-474)
 * Displays cached AI rep coaching insights from the most recent nightly run.
 * Manager and admin roles only — reps view their own insights via the "My
 * Performance" section on the dashboard instead (DashboardPage.tsx).
 * Never triggers a synchronous AI call (there is no AI call in this feature
 * at all — see repCoachingService's doc comment).
 */

import { useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import NavBar from '@/components/NavBar.js';
import { useAuth } from '@/hooks/useAuth.js';
import { useFeatureFlag } from '@/hooks/useFeatureFlag.js';
import {
  getCoachingTeamOverview,
  getRepCoachingInsights,
  COACHING_TEAM_OVERVIEW_QUERY_KEY,
  repCoachingInsightsQueryKey,
} from '@/api/repCoaching.js';
import type { RepCoachingInsight } from '@shared/schemas/repCoachingSchema.js';

function InsightRow({ insight }: { insight: RepCoachingInsight }) {
  const { t } = useTranslation();
  return (
    <li
      className={`px-6 py-4 flex flex-col gap-1 ${insight.is_outlier ? 'bg-yellow-50' : ''}`}
      data-testid={`coaching-insight-${insight.metric_type}-${insight.segment ?? 'all'}`}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm text-gray-900">{insight.observation}</p>
        {insight.is_outlier && (
          <span
            className="shrink-0 inline-flex items-center rounded px-2 py-0.5 text-xs font-medium bg-yellow-100 text-yellow-800"
            data-testid={`coaching-insight-outlier-badge-${insight.metric_type}-${insight.segment ?? 'all'}`}
          >
            {t('coaching.outlierBadge')}
          </span>
        )}
      </div>
      <p className="text-sm text-gray-600">{insight.recommended_action}</p>
    </li>
  );
}

function RepInsightsList({ repId }: { repId: string }) {
  const { t } = useTranslation();
  const { data, isLoading, isError } = useQuery({
    queryKey: repCoachingInsightsQueryKey(repId),
    queryFn: () => getRepCoachingInsights(repId),
  });

  if (isLoading) {
    return (
      <div className="space-y-2 px-6 py-4" aria-hidden="true">
        <div className="h-4 w-48 bg-gray-100 rounded animate-pulse" />
        <div className="h-24 w-full bg-gray-100 rounded animate-pulse" />
      </div>
    );
  }

  if (isError) {
    return (
      <p
        role="alert"
        className="px-6 py-4 text-sm text-red-600"
        data-testid="coaching-insights-error"
      >
        {t('coaching.loadFailed')}
      </p>
    );
  }

  if (!data || !data.has_sufficient_data) {
    return (
      <p
        className="px-6 py-8 text-sm text-gray-500 text-center"
        data-testid="coaching-insights-insufficient-data"
      >
        {t('coaching.insufficientData', {
          count: data?.closed_deal_count ?? 0,
          required: data?.min_closed_deals_required ?? 0,
        })}
      </p>
    );
  }

  if (data.insights.length === 0) {
    return (
      <p
        className="px-6 py-8 text-sm text-gray-500 text-center"
        data-testid="coaching-insights-empty"
      >
        {t('coaching.noInsights')}
      </p>
    );
  }

  return (
    <ul className="divide-y divide-gray-100" data-testid="coaching-insights-list">
      {data.insights.map((insight) => (
        <InsightRow key={`${insight.metric_type}-${insight.segment ?? 'all'}`} insight={insight} />
      ))}
    </ul>
  );
}

export default function CoachingInsightsPage() {
  const { t } = useTranslation();
  const { user, isLoading: authLoading } = useAuth();
  const { enabled: featureEnabled, isLoading: featureFlagLoading } = useFeatureFlag(
    'ai_rep_coaching_insights',
  );
  const [selectedRepId, setSelectedRepId] = useState<string | null>(null);

  const { data: overview, isLoading: overviewLoading } = useQuery({
    queryKey: COACHING_TEAM_OVERVIEW_QUERY_KEY,
    queryFn: getCoachingTeamOverview,
    enabled: featureEnabled && (user?.role === 'admin' || user?.role === 'manager'),
  });

  if (authLoading || featureFlagLoading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <NavBar />
        <div className="flex items-center justify-center h-64">
          <div className="text-gray-400 text-sm">{t('common.loading')}</div>
        </div>
      </div>
    );
  }

  // Manager and admin roles only — reps use the dashboard's "My Performance" section (MINCRM-474 AC)
  if (user && user.role !== 'admin' && user.role !== 'manager') {
    return <Navigate to="/" replace />;
  }

  if (!featureEnabled) {
    return (
      <div className="min-h-screen bg-gray-50">
        <NavBar />
        <div className="flex items-center justify-center h-64">
          <p className="text-gray-500 text-sm">{t('coaching.notAvailable')}</p>
        </div>
      </div>
    );
  }

  const effectiveRepId = selectedRepId ?? overview?.reps[0]?.rep_id ?? null;

  return (
    <div className="min-h-screen bg-gray-50">
      <NavBar />
      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
        <h1
          className="text-2xl font-bold text-gray-900 mb-6"
          data-testid="coaching-insights-heading"
        >
          {t('coaching.insightsHeading')}
        </h1>

        <div className="mb-4">
          <label
            htmlFor="coaching-rep-select"
            className="block text-sm font-medium text-gray-700 mb-1"
          >
            {t('coaching.repSelectorLabel')}
          </label>
          {overviewLoading ? (
            <div className="h-9 w-64 bg-gray-100 rounded animate-pulse" aria-hidden="true" />
          ) : (
            <select
              id="coaching-rep-select"
              className="block w-full max-w-xs rounded-md border-gray-300 shadow-sm text-sm"
              data-testid="coaching-rep-select"
              value={effectiveRepId ?? ''}
              onChange={(e) => setSelectedRepId(e.target.value)}
            >
              {(overview?.reps ?? []).map((rep) => (
                <option key={rep.rep_id} value={rep.rep_id}>
                  {rep.rep_name}
                  {rep.has_sufficient_data ? '' : ` (${t('coaching.insufficientDataShort')})`}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          {effectiveRepId ? (
            <RepInsightsList repId={effectiveRepId} />
          ) : (
            <p
              className="px-6 py-8 text-sm text-gray-500 text-center"
              data-testid="coaching-insights-no-reps"
            >
              {t('coaching.noRepsAvailable')}
            </p>
          )}
        </div>
      </main>
    </div>
  );
}
