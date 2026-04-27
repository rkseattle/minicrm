/**
 * ActivityVolumeReportPage component.
 * Displays an activity count matrix broken down by rep and activity type:
 * - Rows: one per rep (admin sees all reps; rep sees only their own row)
 * - Columns: Note, Call, Email, Meeting, Task, Total
 * - Totals row at the bottom
 * - Date range filter (this week / this month / this quarter / custom)
 * - Admin-only My View / Team View toggle (MINCRM-264)
 * - Admin-only rep filter dropdown
 * - Clicking a count cell navigates to Activities filtered to that rep/type/range
 * - CSV export of the full table
 *
 * Implements MINCRM-181, MINCRM-264.
 */

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import NavBar from '@/components/NavBar.js';
import { useAuth } from '@/hooks/useAuth.js';
import { listActiveUsers, ACTIVE_USERS_QUERY_KEY } from '@/api/users.js';
import {
  getActivityVolumeReport,
  ACTIVITY_VOLUME_REPORT_QUERY_KEY,
  type ActivityVolumeReportParams,
  type ActivityTypeCounts,
  type ActivityVolumeRepRow,
} from '@/api/reports.js';

/** View mode for the admin toggle (MINCRM-264) */
type ViewMode = 'team' | 'my';

/** Date range preset identifier */
type DatePreset = 'thisWeek' | 'currentMonth' | 'currentQuarter' | 'custom';

/** Ordered activity type columns (MINCRM-181) */
const ACTIVITY_TYPE_COLUMNS: (keyof ActivityTypeCounts)[] = [
  'Note',
  'Call',
  'Email',
  'Meeting',
  'Task',
];

/** Returns the Monday of the current week as YYYY-MM-DD */
function startOfCurrentWeek(): string {
  const now = new Date();
  const day = now.getDay(); // 0 = Sunday
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const monday = new Date(now);
  monday.setDate(now.getDate() + diffToMonday);
  return monday.toISOString().slice(0, 10);
}

/** Returns today as YYYY-MM-DD */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Returns the first day of the current month as YYYY-MM-DD */
function startOfCurrentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
}

/** Returns the last day of the current month as YYYY-MM-DD */
function endOfCurrentMonth(): string {
  const now = new Date();
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return lastDay.toISOString().slice(0, 10);
}

/** Returns the first day of the current quarter as YYYY-MM-DD */
function startOfCurrentQuarter(): string {
  const now = new Date();
  const quarterStartMonth = Math.floor(now.getMonth() / 3) * 3;
  return `${now.getFullYear()}-${String(quarterStartMonth + 1).padStart(2, '0')}-01`;
}

/** Returns the last day of the current quarter as YYYY-MM-DD */
function endOfCurrentQuarter(): string {
  const now = new Date();
  const quarterEndMonth = Math.floor(now.getMonth() / 3) * 3 + 2;
  const lastDay = new Date(now.getFullYear(), quarterEndMonth + 1, 0);
  return lastDay.toISOString().slice(0, 10);
}

/**
 * Builds the Activities list URL for a cell link.
 * Passes owner, type, and date range as query params for the Activities page to consume.
 *
 * @param ownerId - UUID of the rep
 * @param type    - Activity type string
 * @param start   - Start date YYYY-MM-DD
 * @param end     - End date YYYY-MM-DD
 */
function buildActivitiesUrl(ownerId: string, type: string, start: string, end: string): string {
  const params = new URLSearchParams({
    owner: ownerId,
    type,
    start,
    end,
  });
  return `/activities?${params.toString()}`;
}

/**
 * Converts the report data to a CSV string for download.
 *
 * @param rows   - Rep rows from the report
 * @param totals - Column totals row
 * @param t      - i18next translation function
 */
function buildCsv(
  rows: ActivityVolumeRepRow[],
  totals: ActivityTypeCounts & { total: number },
  t: (key: string) => string,
): string {
  const header = [
    t('reports.activityVolume.columnRep'),
    ...ACTIVITY_TYPE_COLUMNS.map((col) => t(`reports.activityVolume.column${col}`)),
    t('reports.activityVolume.columnTotal'),
  ];

  const dataRows = rows.map((row) => [
    row.ownerName,
    ...ACTIVITY_TYPE_COLUMNS.map((col) => String(row.counts[col])),
    String(row.total),
  ]);

  const totalsRow = [
    t('reports.activityVolume.totalsRow'),
    ...ACTIVITY_TYPE_COLUMNS.map((col) => String(totals[col])),
    String(totals.total),
  ];

  const allRows = [header, ...dataRows, totalsRow];
  return allRows
    .map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(','))
    .join('\n');
}

/**
 * Triggers a browser CSV download.
 *
 * @param csv      - CSV string content
 * @param filename - File name for the download
 */
function downloadCsv(csv: string, filename: string): void {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Activity volume report page.
 * Implements MINCRM-181, MINCRM-264.
 */
export default function ActivityVolumeReportPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  // ── Date range state ────────────────────────────────────────────────────────
  const [preset, setPreset] = useState<DatePreset>('currentMonth');
  const [customStart, setCustomStart] = useState<string>(startOfCurrentMonth());
  const [customEnd, setCustomEnd] = useState<string>(endOfCurrentMonth());

  const { start, end } = useMemo<{ start: string; end: string }>(() => {
    if (preset === 'thisWeek') {
      return { start: startOfCurrentWeek(), end: today() };
    }
    if (preset === 'currentMonth') {
      return { start: startOfCurrentMonth(), end: endOfCurrentMonth() };
    }
    if (preset === 'currentQuarter') {
      return { start: startOfCurrentQuarter(), end: endOfCurrentQuarter() };
    }
    return { start: customStart, end: customEnd };
  }, [preset, customStart, customEnd]);

  // ── View mode toggle (admin only) — defaults to Team View, resets on mount ─
  const [viewMode, setViewMode] = useState<ViewMode>('team');

  // ── Owner filter state (admin only) ────────────────────────────────────────
  const [selectedOwnerId, setSelectedOwnerId] = useState<string>('');

  const { data: activeUsersData } = useQuery({
    queryKey: ACTIVE_USERS_QUERY_KEY,
    queryFn: listActiveUsers,
    enabled: isAdmin,
    staleTime: 5 * 60 * 1000,
  });

  // ── Report query ───────────────────────────────────────────────────────────
  // For reps: no ownerId in params (server always scopes to req.user.id).
  // For admin My View: pass the admin's own userId.
  // For admin Team View: no ownerId; server returns team-wide data.
  const adminOwnerId = isAdmin
    ? viewMode === 'my'
      ? (user?.id ?? undefined)
      : selectedOwnerId || undefined
    : undefined;

  const reportParams: ActivityVolumeReportParams = {
    start,
    end,
    ownerId: adminOwnerId,
  };

  const {
    data: report,
    isLoading,
    isError,
  } = useQuery({
    queryKey: [...ACTIVITY_VOLUME_REPORT_QUERY_KEY, reportParams],
    queryFn: () => getActivityVolumeReport(reportParams),
    enabled: start <= end,
  });

  // ── Dynamic heading key ────────────────────────────────────────────────────
  const headingKey =
    !isAdmin || viewMode === 'my'
      ? 'reports.activityVolume.pageTitleMy'
      : 'reports.activityVolume.pageTitleTeam';

  // ── CSV export ─────────────────────────────────────────────────────────────
  function handleExportCsv(): void {
    if (!report) return;
    const csv = buildCsv(report.rows, report.totals, t);
    downloadCsv(csv, `activity-report-${start}-${end}.csv`);
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <NavBar />
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
        {/* Page header */}
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1
              className="text-2xl font-bold text-gray-900"
              data-testid="activity-volume-report-heading"
            >
              {t(headingKey)}
            </h1>
            <p className="text-sm text-gray-500 mt-1">{t('reports.activityVolume.subtitle')}</p>
          </div>
          {report && report.rows.length > 0 && (
            <button
              type="button"
              onClick={handleExportCsv}
              className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 min-h-[44px] sm:min-h-0"
              data-testid="export-csv-button"
            >
              {t('reports.activityVolume.exportCsv')}
            </button>
          )}
        </div>

        {/* My View / Team View toggle — admin only (MINCRM-264) */}
        {isAdmin && (
          <div
            className="mb-4 inline-flex rounded-md border border-gray-300 overflow-hidden"
            data-testid="view-mode-toggle"
          >
            <button
              type="button"
              onClick={() => setViewMode('team')}
              className={`px-4 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-inset focus:ring-indigo-500 ${
                viewMode === 'team'
                  ? 'bg-indigo-600 text-white'
                  : 'bg-white text-gray-700 hover:bg-gray-50'
              }`}
              data-testid="view-mode-team"
            >
              {t('reports.activityVolume.viewToggleTeamView')}
            </button>
            <button
              type="button"
              onClick={() => setViewMode('my')}
              className={`px-4 py-2 text-sm font-medium border-s border-gray-300 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-indigo-500 ${
                viewMode === 'my'
                  ? 'bg-indigo-600 text-white'
                  : 'bg-white text-gray-700 hover:bg-gray-50'
              }`}
              data-testid="view-mode-my"
            >
              {t('reports.activityVolume.viewToggleMyView')}
            </button>
          </div>
        )}

        {/* Filters */}
        <div
          className="bg-white rounded-lg border border-gray-200 p-4 mb-6 flex flex-wrap gap-4 items-end"
          data-testid="report-filters"
        >
          {/* Date preset */}
          <div className="flex flex-col gap-1">
            <label
              htmlFor="date-preset"
              className="text-xs font-medium text-gray-500 uppercase tracking-wide"
            >
              {t('reports.activityVolume.dateRangeLabel')}
            </label>
            <select
              id="date-preset"
              data-testid="date-preset-select"
              value={preset}
              onChange={(e) => {
                if (e.target.value !== preset) setPreset(e.target.value as DatePreset);
              }}
              className="border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 min-h-[44px] sm:min-h-0"
            >
              <option value="thisWeek">{t('reports.activityVolume.presetThisWeek')}</option>
              <option value="currentMonth">{t('reports.activityVolume.presetCurrentMonth')}</option>
              <option value="currentQuarter">
                {t('reports.activityVolume.presetCurrentQuarter')}
              </option>
              <option value="custom">{t('reports.activityVolume.presetCustom')}</option>
            </select>
          </div>

          {/* Custom date range */}
          {preset === 'custom' && (
            <>
              <div className="flex flex-col gap-1">
                <label
                  htmlFor="custom-start"
                  className="text-xs font-medium text-gray-500 uppercase tracking-wide"
                >
                  {t('reports.activityVolume.startDateLabel')}
                </label>
                <input
                  id="custom-start"
                  type="date"
                  data-testid="custom-start-input"
                  value={customStart}
                  onChange={(e) => setCustomStart(e.target.value)}
                  className="border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 min-h-[44px] sm:min-h-0"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label
                  htmlFor="custom-end"
                  className="text-xs font-medium text-gray-500 uppercase tracking-wide"
                >
                  {t('reports.activityVolume.endDateLabel')}
                </label>
                <input
                  id="custom-end"
                  type="date"
                  data-testid="custom-end-input"
                  value={customEnd}
                  onChange={(e) => setCustomEnd(e.target.value)}
                  className="border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 min-h-[44px] sm:min-h-0"
                />
              </div>
            </>
          )}

          {/* Owner filter — admin only */}
          {isAdmin && (
            <div className="flex flex-col gap-1">
              <label
                htmlFor="owner-filter"
                className="text-xs font-medium text-gray-500 uppercase tracking-wide"
              >
                {t('reports.activityVolume.ownerFilterLabel')}
              </label>
              <select
                id="owner-filter"
                data-testid="owner-filter-select"
                value={selectedOwnerId}
                onChange={(e) => setSelectedOwnerId(e.target.value)}
                className="border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="">{t('reports.activityVolume.ownerFilterAll')}</option>
                {activeUsersData?.users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Invalid date range warning */}
        {preset === 'custom' && start > end && (
          <p role="alert" className="mb-4 text-sm text-red-600" data-testid="date-range-error">
            {t('reports.activityVolume.dateRangeInvalid')}
          </p>
        )}

        {/* Loading state */}
        {isLoading && (
          <p className="text-sm text-gray-400" data-testid="report-loading">
            {t('reports.activityVolume.loading')}
          </p>
        )}

        {/* Error state */}
        {isError && (
          <p role="alert" className="text-sm text-red-600" data-testid="report-error">
            {t('reports.activityVolume.errorLoad')}
          </p>
        )}

        {/* Report table */}
        {report && (
          <div
            className="bg-white rounded-lg border border-gray-200"
            data-testid="activity-volume-table-container"
          >
            {report.rows.length === 0 ? (
              <p
                className="px-6 py-8 text-sm text-gray-400 text-center"
                data-testid="activity-volume-empty"
              >
                {t('reports.activityVolume.empty')}
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table
                  className="min-w-full divide-y divide-gray-100"
                  data-testid="activity-volume-table"
                >
                  <thead className="bg-gray-50">
                    <tr>
                      <th
                        scope="col"
                        className="px-6 py-3 text-start text-xs font-medium text-gray-500 uppercase tracking-wider"
                      >
                        {t('reports.activityVolume.columnRep')}
                      </th>
                      {ACTIVITY_TYPE_COLUMNS.map((col) => (
                        <th
                          key={col}
                          scope="col"
                          className="px-4 py-3 text-end text-xs font-medium text-gray-500 uppercase tracking-wider"
                        >
                          {t(`reports.activityVolume.column${col}`)}
                        </th>
                      ))}
                      <th
                        scope="col"
                        className="px-4 py-3 text-end text-xs font-medium text-gray-500 uppercase tracking-wider"
                      >
                        {t('reports.activityVolume.columnTotal')}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-100">
                    {report.rows.map((row) => (
                      <tr key={row.ownerId} data-testid={`rep-row-${row.ownerId}`}>
                        <td className="px-6 py-3 text-sm font-medium text-gray-900">
                          {row.ownerName}
                        </td>
                        {ACTIVITY_TYPE_COLUMNS.map((col) => (
                          <td
                            key={col}
                            className="px-4 py-3 text-sm text-end"
                            data-testid={`cell-${row.ownerId}-${col}`}
                          >
                            {row.counts[col] > 0 ? (
                              <Link
                                to={buildActivitiesUrl(row.ownerId, col, start, end)}
                                className="text-indigo-600 hover:underline font-medium"
                              >
                                {row.counts[col]}
                              </Link>
                            ) : (
                              <span className="text-gray-400">{row.counts[col]}</span>
                            )}
                          </td>
                        ))}
                        <td
                          className="px-4 py-3 text-sm font-semibold text-gray-900 text-end"
                          data-testid={`cell-${row.ownerId}-total`}
                        >
                          {row.total}
                        </td>
                      </tr>
                    ))}
                    {/* Totals row */}
                    <tr className="bg-gray-50 font-semibold" data-testid="totals-row">
                      <td className="px-6 py-3 text-sm text-gray-900">
                        {t('reports.activityVolume.totalsRow')}
                      </td>
                      {ACTIVITY_TYPE_COLUMNS.map((col) => (
                        <td
                          key={col}
                          className="px-4 py-3 text-sm text-gray-900 text-end"
                          data-testid={`totals-${col}`}
                        >
                          {report.totals[col]}
                        </td>
                      ))}
                      <td
                        className="px-4 py-3 text-sm text-gray-900 text-end"
                        data-testid="totals-total"
                      >
                        {report.totals.total}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
