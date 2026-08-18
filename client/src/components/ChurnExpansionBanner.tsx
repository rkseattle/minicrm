/**
 * ChurnExpansionBanner component.
 * Shows the active AI churn-risk or expansion signal for an account as a
 * top-of-page banner, following the TokenBudgetWarningBanner pattern:
 * self-contained, own query, renders nothing when there's nothing to show.
 */

import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  getAccountChurnExpansionSignal,
  accountChurnExpansionQueryKey,
} from '@/api/churnExpansion.js';
import { useFeatureFlag } from '@/hooks/useFeatureFlag.js';

interface ChurnExpansionBannerProps {
  accountId: string;
}

export default function ChurnExpansionBanner({ accountId }: ChurnExpansionBannerProps) {
  const { t } = useTranslation();
  const { enabled: featureEnabled } = useFeatureFlag('ai_churn_expansion_detection');

  const { data, isLoading, isError } = useQuery({
    queryKey: accountChurnExpansionQueryKey(accountId),
    queryFn: () => getAccountChurnExpansionSignal(accountId),
    enabled: Boolean(accountId) && featureEnabled,
  });

  if (!featureEnabled || isLoading || isError || !data?.signal) {
    return null;
  }

  const { signal } = data;
  const isChurnRisk = signal.signal_type === 'churn_risk';
  const factors = signal.contributing_factors.slice(0, 2).map((f) => f.description);

  return (
    <div
      role="alert"
      className={
        isChurnRisk
          ? 'mb-4 rounded-md bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800'
          : 'mb-4 rounded-md bg-emerald-50 border border-emerald-200 px-4 py-3 text-sm text-emerald-800'
      }
      data-testid={isChurnRisk ? 'churn-risk-banner' : 'expansion-signal-banner'}
    >
      <p className="font-medium">
        {isChurnRisk
          ? t('churnExpansion.churnRiskDetected')
          : t('churnExpansion.expansionSignalDetected')}
      </p>
      {factors.length > 0 && (
        <ul className="mt-1 list-disc ps-5">
          {factors.map((factor, index) => (
            <li key={index}>{factor}</li>
          ))}
        </ul>
      )}
      <p className="mt-1 text-xs opacity-75">
        {t('churnExpansion.detectedOn', {
          date: new Date(signal.detected_at).toLocaleDateString(),
        })}
      </p>
    </div>
  );
}
