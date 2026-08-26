/**
 * ObjectionInsights component.
 * Mounted per-activity inside ActivityTimeline when the activity has note
 * text and the ai_objection_pattern_matching flag is enabled. Classifies the
 * note on demand (cached server-side after the first call), shows a neutral
 * category badge (styled like TagBadge — a flat classification, not a
 * sentiment axis, so no per-category color), and a "How was this handled
 * before?" toggle revealing up to 3 precedents from past won deals — modeled
 * on ChampionBlockerBadge's showWhy toggle pattern.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import {
  classifyActivityObjection,
  getObjectionPrecedents,
  activityObjectionQueryKey,
  objectionPrecedentsQueryKey,
} from '@/api/objectionMatching.js';
import { useFeatureFlag } from '@/hooks/useFeatureFlag.js';
import { recordPath } from '@shared/types/recordPath.js';

interface ObjectionInsightsProps {
  activityId: string;
  hasNotes: boolean;
}

export default function ObjectionInsights({ activityId, hasNotes }: ObjectionInsightsProps) {
  const { t } = useTranslation();
  const { enabled: featureEnabled } = useFeatureFlag('ai_objection_pattern_matching');
  const [showPrecedents, setShowPrecedents] = useState(false);

  const classificationQuery = useQuery({
    queryKey: activityObjectionQueryKey(activityId),
    queryFn: () => classifyActivityObjection(activityId),
    enabled: featureEnabled && hasNotes,
    staleTime: Infinity,
  });

  const category = classificationQuery.data?.category;

  const precedentsQuery = useQuery({
    queryKey: category
      ? objectionPrecedentsQueryKey(activityId, category)
      : ['objectionPrecedents', activityId, 'none'],
    queryFn: () => getObjectionPrecedents(activityId, category!),
    enabled: showPrecedents && Boolean(category),
  });

  if (!featureEnabled || !hasNotes) {
    return null;
  }

  // Distinguish a genuine classification failure from "no objection detected" —
  // both otherwise render nothing, which hid provider/network errors from the rep.
  if (classificationQuery.isError) {
    return (
      <p
        role="alert"
        className="mt-2 text-xs text-red-600"
        data-testid={`objection-classification-error-${activityId}`}
      >
        {t('objections.classificationFailed')}
      </p>
    );
  }

  if (!category) {
    return null;
  }

  return (
    <div className="relative mt-2 inline-block">
      <div className="flex items-center gap-2">
        <span
          className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700 ring-1 ring-inset ring-gray-500/10 whitespace-nowrap"
          data-testid={`objection-category-badge-${activityId}`}
          title={t('objections.aiInferredLabel')}
        >
          {t(`objections.category.${category.replace(/\s+/g, '')}`)}
        </span>
        <button
          type="button"
          data-testid={`objection-precedents-toggle-${activityId}`}
          aria-expanded={showPrecedents}
          className="text-xs text-gray-400 hover:text-gray-600 underline decoration-dotted"
          onClick={() => setShowPrecedents((prev) => !prev)}
        >
          {t('objections.howHandledBefore')}
        </button>
      </div>

      {showPrecedents && (
        <div
          role="region"
          aria-label={t('objections.precedentsPanelLabel')}
          data-testid={`objection-precedents-panel-${activityId}`}
          className="absolute z-10 top-full mt-1 start-0 w-80 rounded-md border border-gray-200 bg-white p-3 text-xs text-gray-700 shadow-lg"
        >
          {precedentsQuery.isLoading && <p className="text-gray-400">{t('common.loading')}</p>}

          {precedentsQuery.isError && (
            <p role="alert" className="text-red-600">
              {t('objections.loadFailed')}
            </p>
          )}

          {precedentsQuery.data && !precedentsQuery.data.has_sufficient_data && (
            <p data-testid={`objection-precedents-insufficient-${activityId}`}>
              {t('objections.insufficientData', {
                required: precedentsQuery.data.min_closed_won_deals_required,
                count: precedentsQuery.data.closed_won_deals_count,
              })}
            </p>
          )}

          {precedentsQuery.data?.has_sufficient_data &&
            precedentsQuery.data.precedents.length === 0 && (
              <p data-testid={`objection-precedents-empty-${activityId}`}>
                {t('objections.noPrecedentsFound')}
              </p>
            )}

          {precedentsQuery.data?.has_sufficient_data &&
            precedentsQuery.data.precedents.length > 0 && (
              <ul className="space-y-2" data-testid={`objection-precedents-list-${activityId}`}>
                {precedentsQuery.data.precedents.map((precedent, index) => (
                  <li
                    key={index}
                    className="border-t border-gray-100 pt-2 first:border-0 first:pt-0"
                  >
                    <Link
                      to={recordPath('deal', precedent.deal_id)}
                      className="font-medium text-primary-600 hover:underline"
                    >
                      {precedent.deal_name}
                    </Link>
                    <p className="mt-0.5 italic text-gray-500">
                      {t('objections.objectionQuote', { quote: precedent.objection_quote })}
                    </p>
                    <p className="mt-0.5">{precedent.response_summary}</p>
                    <p className="mt-0.5 text-gray-400">
                      {t('objections.timeToClose', { days: precedent.time_to_close_days })}
                    </p>
                  </li>
                ))}
              </ul>
            )}
        </div>
      )}
    </div>
  );
}
