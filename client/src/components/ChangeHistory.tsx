/**
 * ChangeHistory component.
 * Displays the audit log for a single record (contact, account, or deal).
 * Shows the 20 most recent entries with a "Show all" toggle.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { getRecordAuditLog, RECORD_AUDIT_LOG_QUERY_KEY } from '@/api/auditLog.js';
import type { AuditLogEntry } from '@shared/schemas/auditSchema.js';

/** Props for the ChangeHistory component */
export interface ChangeHistoryProps {
  /** Record type: contact, account, or deal */
  recordType: 'contact' | 'account' | 'deal';
  /** UUID of the record */
  recordId: string;
}

/**
 * Formats a timestamp as a relative string (e.g., "2 hours ago").
 * Falls back to the locale date/time string if the date is more than 7 days ago.
 *
 * @param dateStr - ISO date string
 * @param locale - Active i18n locale
 * @returns Relative or formatted date string
 */
function formatRelativeTime(dateStr: string, locale: string): string {
  const date = new Date(dateStr);
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSecs < 60) {
    return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(0, 'second');
  }
  if (diffMins < 60) {
    return new Intl.RelativeTimeFormat(locale, { numeric: 'always' }).format(-diffMins, 'minute');
  }
  if (diffHours < 24) {
    return new Intl.RelativeTimeFormat(locale, { numeric: 'always' }).format(-diffHours, 'hour');
  }
  if (diffDays < 7) {
    return new Intl.RelativeTimeFormat(locale, { numeric: 'always' }).format(-diffDays, 'day');
  }

  return date.toLocaleDateString(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Formats an absolute timestamp for the hover tooltip.
 *
 * @param dateStr - ISO date string
 * @param locale - Active i18n locale
 * @returns Formatted absolute date/time string
 */
function formatAbsoluteTime(dateStr: string, locale: string): string {
  return new Date(dateStr).toLocaleString(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Builds a human-readable summary string for a single audit log entry.
 *
 * @param entry - Audit log entry
 * @param t - i18n translation function
 * @returns Human-readable description
 */
function buildSummary(
  entry: AuditLogEntry,
  t: (key: string, opts?: Record<string, string>) => string,
): string {
  const actor = entry.changed_by_name ?? 'Unknown';
  const recordType = t(`auditLog.recordTypes.${entry.record_type}`);

  switch (entry.event_type) {
    case 'created':
      return t('auditLog.summary.created', { actor, recordType });
    case 'updated':
      return t('auditLog.summary.updated', {
        actor,
        field: entry.field_name ?? '',
        oldValue: entry.old_value ?? t('auditLog.summary.noOldValue'),
        newValue: entry.new_value ?? t('auditLog.summary.noNewValue'),
      });
    case 'deleted':
      return t('auditLog.summary.deleted', { actor, recordType });
    case 'login':
      return t('auditLog.summary.login', { actor });
    case 'logout':
      return t('auditLog.summary.logout', { actor });
    case 'password_changed':
      return t('auditLog.summary.password_changed', { actor });
    case 'role_changed':
      return t('auditLog.summary.role_changed', { actor, newValue: entry.new_value ?? '' });
    case 'deactivated':
      return t('auditLog.summary.deactivated', { actor });
    case 'reactivated':
      return t('auditLog.summary.reactivated', { actor });
    case 'ownership_reassigned':
      return t('auditLog.summary.ownership_reassigned', { actor });
    case 'note_created':
      return t('auditLog.summary.note_created', { actor });
    case 'note_updated':
      return t('auditLog.summary.note_updated', { actor });
    case 'note_visibility_changed':
      return t('auditLog.summary.note_visibility_changed', { actor });
    case 'note_deleted':
      return t('auditLog.summary.note_deleted', { actor });
    case 'merged':
      return t('auditLog.summary.merged', { actor });
    default:
      // Reached only by an event type with no case above, which renders its raw
      // identifier — visible to the user, so a new event type must be added here.
      return `${actor} — ${entry.event_type}`;
  }
}

/** Number of entries shown before the "Show all" toggle */
const PREVIEW_COUNT = 20;

/**
 * Displays the change history for a single contact, account, or deal.
 * Shows the 20 most recent entries; "Show all" fetches the full history.
 */
export default function ChangeHistory({ recordType, recordId }: ChangeHistoryProps) {
  const { t, i18n } = useTranslation();
  const [showAll, setShowAll] = useState(false);

  const queryKey = RECORD_AUDIT_LOG_QUERY_KEY(recordType, recordId);
  const queryKeyAll = [...queryKey, 'all'] as const;

  const { data: previewData, isLoading } = useQuery({
    queryKey,
    queryFn: () => getRecordAuditLog(recordType, recordId, false),
    enabled: Boolean(recordId),
  });

  const { data: allData, isFetching: allFetching } = useQuery({
    queryKey: queryKeyAll,
    queryFn: () => getRecordAuditLog(recordType, recordId, true),
    enabled: showAll && Boolean(recordId),
  });

  const entries: AuditLogEntry[] = showAll
    ? (allData?.entries ?? previewData?.entries ?? [])
    : (previewData?.entries ?? []);

  const totalCount = allData?.entries.length ?? previewData?.entries.length ?? 0;
  const hasMore = !showAll && (previewData?.entries.length ?? 0) >= PREVIEW_COUNT;

  return (
    <section
      className="mt-8"
      aria-labelledby="change-history-heading"
      data-testid="change-history-section"
    >
      <h2
        id="change-history-heading"
        className="text-sm font-semibold text-gray-900 mb-3"
        data-testid="change-history-heading"
      >
        {t('auditLog.changeHistory')}
      </h2>

      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        {isLoading ? (
          <p className="px-6 py-4 text-sm text-gray-500" data-testid="change-history-loading">
            {t('auditLog.loading')}
          </p>
        ) : entries.length === 0 ? (
          <p className="px-6 py-4 text-sm text-gray-500" data-testid="change-history-empty">
            {t('auditLog.noHistory')}
          </p>
        ) : (
          <ul className="divide-y divide-gray-100" data-testid="change-history-list">
            {entries.map((entry) => (
              <li
                key={entry.id}
                className="px-6 py-3"
                data-testid={`change-history-entry-${entry.id}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="text-sm text-gray-800 flex-1">{buildSummary(entry, t)}</span>
                  <time
                    dateTime={entry.created_at}
                    title={formatAbsoluteTime(entry.created_at, i18n.language)}
                    className="text-xs text-gray-500 whitespace-nowrap shrink-0 cursor-default"
                    data-testid={`change-history-time-${entry.id}`}
                  >
                    {formatRelativeTime(entry.created_at, i18n.language)}
                  </time>
                </div>
              </li>
            ))}
          </ul>
        )}

        {!isLoading && (hasMore || showAll) && (
          <div className="px-6 py-3 border-t border-gray-100">
            <button
              type="button"
              onClick={() => setShowAll((prev) => !prev)}
              disabled={allFetching}
              className="text-sm text-primary-600 hover:underline disabled:opacity-50"
              data-testid="change-history-toggle"
            >
              {showAll
                ? t('auditLog.showLess')
                : allFetching
                  ? t('auditLog.loading')
                  : t('auditLog.showAll')}
            </button>
            {showAll && (
              <span className="ms-2 text-xs text-gray-500" aria-label={String(totalCount)}>
                {t('auditLog.totalCount', { count: totalCount })}
              </span>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
