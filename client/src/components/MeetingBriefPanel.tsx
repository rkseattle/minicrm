/**
 * MeetingBriefPanel component. (MINCRM-465)
 *
 * Sidebar panel for an AI-generated pre-meeting brief. Slides in from the
 * right edge of the viewport, matching EmailDraftPanel's dialog/focus-trap/
 * Escape-dismiss shape. Unlike EmailDraftPanel, the brief IS persisted
 * server-side (activity_meeting_briefs) so it can also be viewed at the
 * standalone /activities/:id/brief route.
 */

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button.js';
import type { MeetingBriefResponse } from '@shared/schemas/meetingBriefSchema.js';

interface MeetingBriefPanelProps {
  brief: MeetingBriefResponse;
  onDismiss: () => void;
  onRegenerate: () => void;
  isRegenerating: boolean;
}

/**
 * Sidebar panel showing an AI-generated pre-meeting brief with print/copy actions.
 * Focus moves into the panel on open.
 */
export default function MeetingBriefPanel({
  brief,
  onDismiss,
  onRegenerate,
  isRegenerating,
}: MeetingBriefPanelProps) {
  const { t } = useTranslation();
  const panelRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const [copySuccess, setCopySuccess] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);

  useEffect(() => {
    previousFocusRef.current = document.activeElement as HTMLElement;
    requestAnimationFrame(() => {
      panelRef.current?.focus();
    });
    return () => {
      previousFocusRef.current?.focus();
    };
  }, []);

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>): void {
    if (e.key === 'Escape') {
      onDismiss();
    }
  }

  function briefAsPlainText(): string {
    const { brief: content } = brief;
    const lines: string[] = [
      content.contact_snapshot.name,
      content.contact_snapshot.title ?? '',
      content.contact_snapshot.company ?? '',
      '',
      t('meetingBrief.accountSummaryLabel'),
      content.account_summary ?? '',
      '',
      t('meetingBrief.talkingPointsLabel'),
      ...content.suggested_talking_points.map((point) => `- ${point}`),
    ];
    return lines.join('\n');
  }

  async function handleCopyToClipboard(): Promise<void> {
    try {
      await navigator.clipboard.writeText(briefAsPlainText());
      setCopyError(null);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    } catch {
      setCopyError(t('meetingBrief.clipboardError'));
    }
  }

  const { brief: content } = brief;

  return (
    <div role="presentation" onKeyDown={handleKeyDown}>
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={t('meetingBrief.panelTitle')}
        tabIndex={-1}
        data-testid="meeting-brief-panel"
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col bg-white shadow-xl border-l border-gray-200"
      >
        <header className="flex items-center justify-between gap-3 border-b border-gray-200 px-5 py-4 shrink-0">
          <h2 className="text-base font-semibold text-gray-900">{t('meetingBrief.panelTitle')}</h2>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-testid="meeting-brief-dismiss"
            onClick={onDismiss}
          >
            {t('meetingBrief.dismiss')}
          </Button>
        </header>

        <div
          className="flex-1 overflow-y-auto px-5 py-4 space-y-4"
          data-testid="meeting-brief-content"
        >
          <div>
            <h3 className="text-sm font-semibold text-gray-900">{content.contact_snapshot.name}</h3>
            {content.contact_snapshot.title && (
              <p className="text-xs text-gray-500">{content.contact_snapshot.title}</p>
            )}
            {content.contact_snapshot.company && (
              <p className="text-xs text-gray-500">{content.contact_snapshot.company}</p>
            )}
          </div>

          {content.account_summary && (
            <div>
              <h4 className="text-xs font-medium text-gray-700 mb-1">
                {t('meetingBrief.accountSummaryLabel')}
              </h4>
              <p className="text-sm text-gray-700">{content.account_summary}</p>
            </div>
          )}

          {content.open_opportunities.length > 0 && (
            <div>
              <h4 className="text-xs font-medium text-gray-700 mb-1">
                {t('meetingBrief.opportunitiesLabel')}
              </h4>
              <ul className="space-y-2" data-testid="meeting-brief-opportunities">
                {content.open_opportunities.map((deal) => (
                  <li key={deal.deal_id} className="text-sm text-gray-700">
                    <p className="font-medium">
                      {deal.name} — {deal.stage}
                    </p>
                    {deal.next_step && <p className="text-xs text-gray-500">{deal.next_step}</p>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {content.recent_activity_summary.length > 0 && (
            <div>
              <h4 className="text-xs font-medium text-gray-700 mb-1">
                {t('meetingBrief.recentActivityLabel')}
              </h4>
              <ul className="list-disc ps-4 space-y-1">
                {content.recent_activity_summary.map((line, index) => (
                  <li key={index} className="text-sm text-gray-700">
                    {line}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div>
            <h4 className="text-xs font-medium text-gray-700 mb-1">
              {t('meetingBrief.talkingPointsLabel')}
            </h4>
            <ul className="list-disc ps-4 space-y-1" data-testid="meeting-brief-talking-points">
              {content.suggested_talking_points.map((point, index) => (
                <li key={index} className="text-sm text-gray-700">
                  {point}
                </li>
              ))}
            </ul>
          </div>

          {content.known_objections.length > 0 && (
            <div>
              <h4 className="text-xs font-medium text-gray-700 mb-1">
                {t('meetingBrief.objectionsLabel')}
              </h4>
              <ul className="list-disc ps-4 space-y-1">
                {content.known_objections.map((category, index) => (
                  <li key={index} className="text-sm text-gray-700">
                    {category}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {content.news_hook && content.news_hook.length > 0 && (
            <div>
              <h4 className="text-xs font-medium text-gray-700 mb-1">
                {t('meetingBrief.newsHookLabel')}
              </h4>
              <ul className="space-y-1">
                {content.news_hook.map((item, index) => (
                  <li key={item.url} className="text-sm">
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      data-testid={`meeting-brief-news-item-${index}`}
                      className="text-primary-600 hover:underline"
                    >
                      {item.title}
                    </a>
                    <span className="text-xs text-gray-500"> — {item.source}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {copyError && (
            <p role="alert" className="text-xs text-red-600" data-testid="meeting-brief-copy-error">
              {copyError}
            </p>
          )}
        </div>

        <footer className="border-t border-gray-200 px-5 py-4 shrink-0 flex items-center gap-2">
          <Button
            type="button"
            variant="primary"
            size="sm"
            data-testid="meeting-brief-copy-button"
            onClick={handleCopyToClipboard}
          >
            {copySuccess ? t('meetingBrief.copied') : t('meetingBrief.copyToClipboard')}
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            data-testid="meeting-brief-print-button"
            onClick={() => window.print()}
          >
            {t('meetingBrief.print')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-testid="meeting-brief-regenerate-button"
            onClick={onRegenerate}
            disabled={isRegenerating}
          >
            {isRegenerating ? t('meetingBrief.generating') : t('meetingBrief.regenerate')}
          </Button>
        </footer>
      </div>
    </div>
  );
}
