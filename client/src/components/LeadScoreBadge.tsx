/**
 * LeadScoreBadge component.
 * Displays the lead's rule-based quality score and a "Why this score?" action
 * that fetches and shows an AI narrative explanation inline below the score.
 * Not persisted — both the score and the narrative are recomputed on demand.
 */

import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button.js';
import { resolveApiError } from '@/utils/apiError.js';
import { getLeadScore, leadScoreQueryKey } from '@/api/leadScore.js';
import { getLeadScoreNarrative } from '@/api/leadScoreNarrative.js';
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
  const { enabled: narrativeEnabled } = useFeatureFlag('ai_lead_score_narrative');

  const [narrative, setNarrative] = useState<string | null>(null);
  const [narrativeError, setNarrativeError] = useState<string | null>(null);

  const { data: score, isLoading } = useQuery({
    queryKey: leadScoreQueryKey(leadId),
    queryFn: () => getLeadScore(leadId),
    enabled: scoringEnabled,
  });

  const narrativeMutation = useMutation({
    mutationFn: () => getLeadScoreNarrative(leadId),
    onSuccess: (result) => {
      setNarrative(result.insufficient_data ? t('leadScore.insufficientData') : result.narrative);
      setNarrativeError(null);
    },
    onError: (error: Parameters<typeof resolveApiError>[0]) => {
      setNarrativeError(resolveApiError(error, t));
    },
  });

  if (!scoringEnabled || isLoading || !score) return null;

  return (
    <div data-testid="lead-score-container">
      <div className="flex items-center gap-2">
        <span
          className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap shrink-0 ${scoreBadgeClasses(score.score)}`}
          data-testid="lead-score-badge"
        >
          {t('leadScore.badgeLabel', { score: score.score })}
        </span>
        {narrativeEnabled && !narrative && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-testid="lead-score-why-button"
            onClick={() => narrativeMutation.mutate()}
            disabled={narrativeMutation.isPending}
          >
            {narrativeMutation.isPending ? t('leadScore.explaining') : t('leadScore.whyThisScore')}
          </Button>
        )}
      </div>
      {narrativeError && (
        <p
          role="alert"
          className="mt-2 text-xs text-red-600"
          data-testid="lead-score-narrative-error"
        >
          {narrativeError}
        </p>
      )}
      {narrative && (
        <p className="mt-2 text-sm text-gray-700" data-testid="lead-score-narrative">
          {narrative}
        </p>
      )}
    </div>
  );
}
