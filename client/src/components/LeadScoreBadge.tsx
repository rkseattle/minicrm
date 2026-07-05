/**
 * LeadScoreBadge component. (MINCRM-441 prerequisite)
 * Displays the lead's rule-based quality score. Not persisted — recomputed
 * on every page load.
 */

import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getLeadScore, leadScoreQueryKey } from '@/api/leadScore.js';
import { useFeatureFlag } from '@/hooks/useFeatureFlag.js';

export interface LeadScoreBadgeProps {
  leadId: string;
}

/** Tailwind classes for the score badge, banded by score value. */
function scoreBadgeClasses(score: number): string {
  if (score >= 70) return 'bg-green-100 text-green-800';
  if (score >= 40) return 'bg-yellow-100 text-yellow-800';
  return 'bg-gray-100 text-gray-600';
}

export default function LeadScoreBadge({ leadId }: LeadScoreBadgeProps) {
  const { t } = useTranslation();
  const { enabled: scoringEnabled } = useFeatureFlag('ai_lead_scoring');

  const { data: score, isLoading } = useQuery({
    queryKey: leadScoreQueryKey(leadId),
    queryFn: () => getLeadScore(leadId),
    enabled: scoringEnabled,
  });

  if (!scoringEnabled || isLoading || !score) return null;

  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap shrink-0 ${scoreBadgeClasses(score.score)}`}
      data-testid="lead-score-badge"
    >
      {t('leadScore.badgeLabel', { score: score.score })}
    </span>
  );
}
