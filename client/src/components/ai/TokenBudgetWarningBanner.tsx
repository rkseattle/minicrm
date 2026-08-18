/**
 * TokenBudgetWarningBanner — renders an in-app warning when the user approaches or
 * exceeds their monthly AI token budget. Renders nothing when status is 'ok'.
 *
 * - 'warning' (80–99%): amber banner informing the user they are approaching the limit.
 * - 'exceeded' (100%+): red banner with the prescribed message from the spec.
 *
 * Intended to be rendered near the top of any page that surfaces AI features.
 *
 */

import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getMyTokenBudgetStatus, MY_TOKEN_BUDGET_QUERY_KEY } from '@/api/ai.js';

export default function TokenBudgetWarningBanner() {
  const { t } = useTranslation();

  const { data, isLoading, isError } = useQuery({
    queryKey: MY_TOKEN_BUDGET_QUERY_KEY,
    queryFn: getMyTokenBudgetStatus,
    // Refresh every 5 minutes so the banner reflects recent usage without hammering the server.
    staleTime: 5 * 60 * 1000,
  });

  // Render nothing while loading, on error, or when status is ok.
  if (isLoading || isError || !data || data.status === 'ok') {
    return null;
  }

  if (data.status === 'exceeded') {
    return (
      <div
        role="alert"
        className="rounded-md bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-800"
        data-testid="ai-budget-exceeded-banner"
      >
        {t('aiTokenBudget.exceeded')}
      </div>
    );
  }

  // status === 'warning'
  return (
    <div
      role="alert"
      className="rounded-md bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800"
      data-testid="ai-budget-warning-banner"
    >
      {t('aiTokenBudget.warning', { percentage: data.percentage })}
    </div>
  );
}
