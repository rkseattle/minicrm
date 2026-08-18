/**
 * ActivityBriefPage component.
 *
 * Standalone, authenticated view of the most recently generated AI
 * pre-meeting brief for an activity — the "shareable link" a rep can open
 * on mobile before a call. Same auth model as every other route in the app
 * (JWT cookie via ProtectedRoute); no new token-based access mechanism.
 */

import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import NavBar from '@/components/NavBar.js';
import { useFeatureFlag } from '@/hooks/useFeatureFlag.js';
import { getMeetingBrief, meetingBriefQueryKey } from '@/api/meetingBrief.js';

export default function ActivityBriefPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const { enabled, isLoading: flagLoading } = useFeatureFlag('ai_meeting_brief');

  const { data, isLoading, isError } = useQuery({
    queryKey: meetingBriefQueryKey(id ?? ''),
    queryFn: () => getMeetingBrief(id!),
    enabled: Boolean(id) && enabled,
  });

  if (flagLoading) {
    return (
      <div className="p-8">
        <div className="h-8 w-48 bg-gray-200 rounded animate-pulse mb-4" aria-hidden="true" />
        <div className="h-64 bg-gray-100 rounded animate-pulse" aria-hidden="true" />
      </div>
    );
  }

  if (!enabled) {
    return (
      <div className="p-8 text-center text-gray-500" data-testid="feature-disabled">
        {t('errors.FEATURE_FLAG_NOT_ENABLED')}
      </div>
    );
  }

  if (isLoading) {
    return (
      <div>
        <NavBar />
        <main className="mx-auto max-w-2xl px-4 py-8">
          <p className="text-sm text-gray-500" data-testid="activity-brief-loading">
            {t('meetingBrief.loading')}
          </p>
        </main>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div>
        <NavBar />
        <main className="mx-auto max-w-2xl px-4 py-8">
          <p className="text-sm text-red-600" role="alert" data-testid="activity-brief-error">
            {t('meetingBrief.notFound')}
          </p>
        </main>
      </div>
    );
  }

  const { brief: content } = data;

  return (
    <div>
      <NavBar />
      <main className="mx-auto max-w-2xl px-4 py-8" data-testid="activity-brief-page">
        <Link
          to="/activities"
          data-testid="back-to-activities"
          className="inline-flex items-center gap-1 text-sm text-primary-600 hover:underline mb-6"
        >
          {t('common.back')}
        </Link>

        <h1 className="text-2xl font-bold text-gray-900 mb-1">{content.contact_snapshot.name}</h1>
        {content.contact_snapshot.title && (
          <p className="text-sm text-gray-500">{content.contact_snapshot.title}</p>
        )}
        {content.contact_snapshot.company && (
          <p className="text-sm text-gray-500 mb-4">{content.contact_snapshot.company}</p>
        )}

        {content.account_summary && (
          <section className="mt-4">
            <h2 className="text-sm font-semibold text-gray-900 mb-1">
              {t('meetingBrief.accountSummaryLabel')}
            </h2>
            <p className="text-sm text-gray-700">{content.account_summary}</p>
          </section>
        )}

        {content.open_opportunities.length > 0 && (
          <section className="mt-4">
            <h2 className="text-sm font-semibold text-gray-900 mb-1">
              {t('meetingBrief.opportunitiesLabel')}
            </h2>
            <ul className="space-y-2">
              {content.open_opportunities.map((deal) => (
                <li key={deal.deal_id} className="text-sm text-gray-700">
                  <p className="font-medium">
                    {deal.name} — {deal.stage}
                  </p>
                  {deal.next_step && <p className="text-xs text-gray-500">{deal.next_step}</p>}
                </li>
              ))}
            </ul>
          </section>
        )}

        {content.recent_activity_summary.length > 0 && (
          <section className="mt-4">
            <h2 className="text-sm font-semibold text-gray-900 mb-1">
              {t('meetingBrief.recentActivityLabel')}
            </h2>
            <ul className="list-disc ps-4 space-y-1">
              {content.recent_activity_summary.map((line, index) => (
                <li key={index} className="text-sm text-gray-700">
                  {line}
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="mt-4">
          <h2 className="text-sm font-semibold text-gray-900 mb-1">
            {t('meetingBrief.talkingPointsLabel')}
          </h2>
          <ul className="list-disc ps-4 space-y-1">
            {content.suggested_talking_points.map((point, index) => (
              <li key={index} className="text-sm text-gray-700">
                {point}
              </li>
            ))}
          </ul>
        </section>

        {content.known_objections.length > 0 && (
          <section className="mt-4">
            <h2 className="text-sm font-semibold text-gray-900 mb-1">
              {t('meetingBrief.objectionsLabel')}
            </h2>
            <ul className="list-disc ps-4 space-y-1">
              {content.known_objections.map((category, index) => (
                <li key={index} className="text-sm text-gray-700">
                  {category}
                </li>
              ))}
            </ul>
          </section>
        )}

        {content.news_hook && content.news_hook.length > 0 && (
          <section className="mt-4">
            <h2 className="text-sm font-semibold text-gray-900 mb-1">
              {t('meetingBrief.newsHookLabel')}
            </h2>
            <ul className="space-y-1">
              {content.news_hook.map((item, index) => (
                <li key={item.url} className="text-sm">
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    data-testid={`activity-brief-news-item-${index}`}
                    className="text-primary-600 hover:underline"
                  >
                    {item.title}
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </div>
  );
}
