/**
 * AuditLogPage — admin-only page showing the system-wide audit log.
 * Supports filtering by date range, user, record type, and event type.
 * Paginated at 50 entries per page, with expandable rows for field detail.
 * (MINCRM-172)
 */

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useBreakpoint } from '@/context/BreakpointContext.js';
import NavBar from '@/components/NavBar.js';
import { Button } from '@/components/ui/Button.js';
import { Select } from '@/components/ui/Select.js';
import { Pagination } from '@/components/ui/Pagination.js';
import { listAuditLog, listAuditLogActors, AUDIT_LOG_ACTORS_QUERY_KEY } from '@/api/auditLog.js';
import type { AuditLogFilters } from '@/api/auditLog.js';
import type { AuditLogEntry } from '@shared/schemas/auditSchema.js';
import { AUDIT_RECORD_TYPES, AUDIT_EVENT_TYPES } from '@shared/schemas/auditSchema.js';

/** Number of entries per page */
const PAGE_SIZE = 50;

/**
 * Builds a human-readable one-line summary for an audit log entry row.
 *
 * @param entry - Audit log entry
 * @param t - i18n translation function
 * @returns Human-readable description
 */
function buildRowSummary(
  entry: AuditLogEntry,
  t: (key: string, opts?: Record<string, string>) => string,
): string {
  const actor = entry.changed_by_name ?? 'Unknown';
  const recordType = t(`auditLog.recordTypes.${entry.record_type}`);
  switch (entry.event_type) {
    case 'created':
      return t('auditLog.summary.created', { actor, recordType });
    case 'updated':
      return entry.field_name
        ? t('auditLog.summary.updated', {
            actor,
            field: entry.field_name,
            oldValue: entry.old_value ?? t('auditLog.summary.noOldValue'),
            newValue: entry.new_value ?? t('auditLog.summary.noNewValue'),
          })
        : t('auditLog.summary.updated', { actor, field: '', oldValue: '', newValue: '' });
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
    default:
      return `${actor} — ${entry.event_type}`;
  }
}

/**
 * Formats an ISO timestamp for display.
 *
 * @param dateStr - ISO date string
 * @param locale - Active i18n locale
 */
function formatTimestamp(dateStr: string, locale: string): string {
  return new Date(dateStr).toLocaleString(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Admin-only system-wide audit log page.
 * (MINCRM-172)
 */
export default function AuditLogPage() {
  const { t, i18n } = useTranslation();
  const { isDesktop } = useBreakpoint();

  // ── Filter state ──────────────────────────────────────────────────────────────
  // Collapsed by default on mobile so filter fields don't consume most of the screen
  const [filtersOpen, setFiltersOpen] = useState(isDesktop);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [userId, setUserId] = useState('');
  const [recordType, setRecordType] = useState('');
  const [eventType, setEventType] = useState('');
  const [page, setPage] = useState(1);

  /** Active filters applied to the query (submitted state) */
  const [appliedFilters, setAppliedFilters] = useState<AuditLogFilters>({ limit: PAGE_SIZE });

  /** Row UUIDs that are currently expanded */
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  // ── Data queries ──────────────────────────────────────────────────────────────
  const queryKey = ['audit-log', 'list', appliedFilters, page] as const;

  const { data, isLoading, isError } = useQuery({
    queryKey,
    queryFn: () => listAuditLog({ ...appliedFilters, page }),
  });

  const { data: actorsData } = useQuery({
    queryKey: AUDIT_LOG_ACTORS_QUERY_KEY,
    queryFn: listAuditLogActors,
    staleTime: 5 * 60 * 1000,
  });

  const actors = actorsData?.actors ?? [];
  const entries = data?.data ?? [];
  const total = data?.total ?? 0;

  // ── Handlers ──────────────────────────────────────────────────────────────────

  function handleApplyFilters(): void {
    const filters: AuditLogFilters = { limit: PAGE_SIZE };
    if (from) filters.from = from;
    if (to) {
      // Set to end-of-day for the "to" date
      filters.to = `${to}T23:59:59.999Z`;
    }
    if (userId) filters.userId = userId;
    if (recordType) filters.recordType = recordType;
    if (eventType) filters.eventType = eventType;
    setAppliedFilters(filters);
    setPage(1);
  }

  function handleClearFilters(): void {
    setFrom('');
    setTo('');
    setUserId('');
    setRecordType('');
    setEventType('');
    setAppliedFilters({ limit: PAGE_SIZE });
    setPage(1);
  }

  function toggleExpanded(id: string): void {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className="h-screen flex flex-col bg-gray-50">
      <NavBar />
      <main className="flex-1 flex flex-col min-h-0 overflow-hidden max-w-7xl w-full mx-auto px-4 sm:px-6 pt-8">
        {/* Breadcrumb */}
        <div className="mb-6 flex items-center gap-2 text-sm">
          <Link to="/admin/settings" className="text-indigo-600 hover:underline">
            {t('nav.adminSettings')}
          </Link>
          <span className="text-gray-400" aria-hidden="true">
            {'/'}
          </span>
          <span className="text-gray-700">{t('auditLog.heading')}</span>
        </div>

        <h1 className="text-2xl font-bold text-gray-900 mb-6" data-testid="audit-log-heading">
          {t('auditLog.heading')}
        </h1>

        {/* Filter bar — collapsible on mobile (MINCRM-345) */}
        <div className="bg-white border border-gray-200 rounded-lg mb-6">
          <button
            type="button"
            className="w-full flex items-center justify-between px-4 py-3 text-start"
            aria-expanded={filtersOpen}
            data-testid="filters-toggle"
            onClick={() => setFiltersOpen((o) => !o)}
          >
            <span className="text-sm font-medium text-gray-700">{t('auditLog.filters.title')}</span>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className={`h-4 w-4 text-gray-400 transition-transform duration-200 ${filtersOpen ? 'rotate-180' : ''}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {filtersOpen && (
            <div className="px-4 pb-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                {/* Date from */}
                <div>
                  <label
                    htmlFor="filter-from"
                    className="block text-xs font-medium text-gray-500 mb-1"
                  >
                    {t('auditLog.filters.from')}
                  </label>
                  <input
                    id="filter-from"
                    type="date"
                    value={from}
                    onChange={(e) => setFrom(e.target.value)}
                    className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    data-testid="filter-from"
                  />
                </div>

                {/* Date to */}
                <div>
                  <label
                    htmlFor="filter-to"
                    className="block text-xs font-medium text-gray-500 mb-1"
                  >
                    {t('auditLog.filters.to')}
                  </label>
                  <input
                    id="filter-to"
                    type="date"
                    value={to}
                    onChange={(e) => setTo(e.target.value)}
                    className="w-full rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                    data-testid="filter-to"
                  />
                </div>

                {/* User filter */}
                <div>
                  <label
                    htmlFor="filter-user"
                    className="block text-xs font-medium text-gray-500 mb-1"
                  >
                    {t('auditLog.filters.user')}
                  </label>
                  <Select
                    id="filter-user"
                    value={userId}
                    onChange={(e) => setUserId(e.target.value)}
                    data-testid="filter-user"
                  >
                    <option value="">{t('auditLog.filters.allUsers')}</option>
                    {actors.map((actor) => (
                      <option key={actor.id} value={actor.id}>
                        {actor.name}
                      </option>
                    ))}
                  </Select>
                </div>

                {/* Record type filter */}
                <div>
                  <label
                    htmlFor="filter-record-type"
                    className="block text-xs font-medium text-gray-500 mb-1"
                  >
                    {t('auditLog.filters.recordType')}
                  </label>
                  <Select
                    id="filter-record-type"
                    value={recordType}
                    onChange={(e) => setRecordType(e.target.value)}
                    data-testid="filter-record-type"
                  >
                    <option value="">{t('auditLog.recordTypes.all')}</option>
                    {AUDIT_RECORD_TYPES.map((rt) => (
                      <option key={rt} value={rt}>
                        {t(`auditLog.recordTypes.${rt}`)}
                      </option>
                    ))}
                  </Select>
                </div>

                {/* Event type filter */}
                <div>
                  <label
                    htmlFor="filter-event-type"
                    className="block text-xs font-medium text-gray-500 mb-1"
                  >
                    {t('auditLog.filters.eventType')}
                  </label>
                  <Select
                    id="filter-event-type"
                    value={eventType}
                    onChange={(e) => setEventType(e.target.value)}
                    data-testid="filter-event-type"
                  >
                    <option value="">{t('auditLog.filters.allEvents')}</option>
                    {AUDIT_EVENT_TYPES.map((et) => (
                      <option key={et} value={et}>
                        {t(`auditLog.eventTypes.${et}`)}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>

              <div className="mt-3 flex items-center gap-2">
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  onClick={handleApplyFilters}
                  data-testid="apply-filters-button"
                >
                  {t('auditLog.filters.applyFilters')}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={handleClearFilters}
                  data-testid="clear-filters-button"
                >
                  {t('auditLog.filters.clearFilters')}
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Table */}
        <div className="flex-1 flex flex-col min-h-0 bg-white border border-gray-200 rounded-lg overflow-hidden mb-8">
          {isLoading && (
            <p
              className="px-6 py-8 text-sm text-gray-500 text-center"
              data-testid="audit-log-loading"
            >
              {t('auditLog.loading')}
            </p>
          )}

          {isError && (
            <p
              className="px-6 py-8 text-sm text-red-600 text-center"
              role="alert"
              data-testid="audit-log-error"
            >
              {t('errors.generic')}
            </p>
          )}

          {!isLoading && !isError && entries.length === 0 && (
            <p
              className="px-6 py-8 text-sm text-gray-500 text-center"
              data-testid="audit-log-empty"
            >
              {t('auditLog.table.noEntries')}
            </p>
          )}

          {!isLoading && !isError && entries.length > 0 && (
            <>
              {/* Table header — sticky inside the scroll area */}
              <div className="hidden md:grid grid-cols-[160px_140px_120px_120px_1fr] gap-3 px-6 py-3 border-b border-gray-200 bg-gray-50 text-xs font-semibold text-gray-500 uppercase tracking-wide sticky top-0 z-10">
                <span>{t('auditLog.table.timestamp')}</span>
                <span>{t('auditLog.table.user')}</span>
                <span>{t('auditLog.table.eventType')}</span>
                <span>{t('auditLog.table.recordType')}</span>
                <span>{t('auditLog.table.summary')}</span>
              </div>

              {/* Rows — scrollable */}
              <div className="flex-1 overflow-auto min-h-0">
                <ul data-testid="audit-log-list">
                  {entries.map((entry) => {
                    const isExpanded = expandedIds.has(entry.id);
                    const hasDetail =
                      entry.event_type === 'updated' &&
                      (entry.field_name !== null ||
                        entry.old_value !== null ||
                        entry.new_value !== null);

                    return (
                      <li
                        key={entry.id}
                        className="border-b border-gray-100 last:border-b-0"
                        data-testid={`audit-log-row-${entry.id}`}
                      >
                        {/* Row summary */}
                        <button
                          type="button"
                          onClick={hasDetail ? () => toggleExpanded(entry.id) : undefined}
                          className={`w-full text-start px-6 py-3 ${hasDetail ? 'cursor-pointer hover:bg-gray-50' : 'cursor-default'}`}
                          aria-expanded={hasDetail ? isExpanded : undefined}
                          data-testid={`audit-log-row-button-${entry.id}`}
                        >
                          <div className="md:grid md:grid-cols-[160px_140px_120px_120px_1fr] md:gap-3 flex flex-col gap-1">
                            <time
                              dateTime={entry.created_at}
                              className="text-xs text-gray-500 whitespace-nowrap"
                              data-testid={`audit-log-time-${entry.id}`}
                            >
                              {formatTimestamp(entry.created_at, i18n.language)}
                            </time>
                            <span
                              className="text-sm text-gray-800"
                              data-testid={`audit-log-actor-${entry.id}`}
                            >
                              {entry.changed_by_name ?? '—'}
                            </span>
                            <span
                              className="text-sm text-gray-700 capitalize"
                              data-testid={`audit-log-event-${entry.id}`}
                            >
                              {t(`auditLog.eventTypes.${entry.event_type}`)}
                            </span>
                            <span
                              className="text-sm text-gray-700 capitalize"
                              data-testid={`audit-log-record-type-${entry.id}`}
                            >
                              {t(`auditLog.recordTypes.${entry.record_type}`)}
                            </span>
                            <span
                              className="text-sm text-gray-900 font-medium"
                              data-testid={`audit-log-summary-${entry.id}`}
                            >
                              {buildRowSummary(entry, t)}
                              {entry.record_name && (
                                <span className="ms-1 text-sm text-gray-500 font-normal">
                                  — {entry.record_name}
                                </span>
                              )}
                            </span>
                          </div>
                        </button>

                        {/* Expandable field detail */}
                        {isExpanded && hasDetail && (
                          <div
                            className="px-6 pb-4 bg-gray-50 border-t border-gray-100"
                            data-testid={`audit-log-detail-${entry.id}`}
                          >
                            <table className="w-full text-sm mt-3">
                              <thead>
                                <tr className="text-xs text-gray-500 uppercase tracking-wide">
                                  <th className="text-start pb-1 pe-4 font-semibold">
                                    {t('auditLog.table.field')}
                                  </th>
                                  <th className="text-start pb-1 pe-4 font-semibold">
                                    {t('auditLog.table.oldValue')}
                                  </th>
                                  <th className="text-start pb-1 font-semibold">
                                    {t('auditLog.table.newValue')}
                                  </th>
                                </tr>
                              </thead>
                              <tbody>
                                <tr>
                                  <td className="pe-4 text-gray-700 align-top">
                                    {entry.field_name ?? '—'}
                                  </td>
                                  <td className="pe-4 text-gray-500 align-top line-through">
                                    {entry.old_value ?? (
                                      <span className="text-gray-300 no-underline">
                                        {t('auditLog.summary.noOldValue')}
                                      </span>
                                    )}
                                  </td>
                                  <td className="text-gray-900 align-top">
                                    {entry.new_value ?? (
                                      <span className="text-gray-300">
                                        {t('auditLog.summary.noNewValue')}
                                      </span>
                                    )}
                                  </td>
                                </tr>
                              </tbody>
                            </table>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              </div>
            </>
          )}

          {/* Pagination — always visible once data loads (MINCRM-345) */}
          {data && (
            <Pagination page={page} limit={PAGE_SIZE} total={total} onPageChange={setPage} />
          )}
        </div>
      </main>
    </div>
  );
}
