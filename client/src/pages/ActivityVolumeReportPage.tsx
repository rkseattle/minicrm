/**
 * ActivityVolumeReportPage component.
 * Displays an activity count matrix broken down by rep and activity type:
 * - Rows: one per rep (admin sees all reps; rep sees only their own row)
 * - Columns: Note, Call, Email, Meeting, Task, Total
 * - Totals row at the bottom
 * - Date range filter (this week / this month / this quarter / custom)
 * - Admin-only My View / Team View toggle
 * - Admin-only rep filter dropdown
 * - Clicking a count cell navigates to Activities filtered to that rep/type/range
 * - CSV export of the full table
 *
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import NavBar from '@/components/NavBar.js';
import ReportFilterBar from '@/components/ReportFilterBar.js';
import { ExportMenu } from '@/components/ui/ExportMenu.js';
import { useReportFilters } from '@/hooks/useReportFilters.js';
import {
  getActivityVolumeReport,
  exportActivityVolumeReportPdf,
  ACTIVITY_VOLUME_REPORT_QUERY_KEY,
  type ActivityVolumeReportParams,
  type ActivityTypeCounts,
  type ActivityVolumeRepRow,
} from '@/api/reports.js';

/** Ordered activity type columns */
const ACTIVITY_TYPE_COLUMNS: (keyof ActivityTypeCounts)[] = [
  'Note',
  'Call',
  'Email',
  'Meeting',
  'Task',
];

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
 * Standalone Activity Volume report page — includes NavBar.
 * When embedded in ReportsPage shell, use ActivityVolumeReportContent instead.
 */
export default function ActivityVolumeReportPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <NavBar />
      <ActivityVolumeReportContent />
    </div>
  );
}

/**
 * Activity volume report content — no NavBar wrapper.
 * Consumed by ReportsPage shell.
 */
export function ActivityVolumeReportContent() {
  const { t } = useTranslation();
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [exportPdfError, setExportPdfError] = useState('');

  const filters = useReportFilters('currentMonth');
  const { resolvedStart, resolvedEnd, effectiveOwnerId, isAdmin, viewMode } = filters;

  const reportParams: ActivityVolumeReportParams = {
    start: resolvedStart,
    end: resolvedEnd,
    ownerId: effectiveOwnerId,
  };

  const {
    data: report,
    isLoading,
    isError,
  } = useQuery({
    queryKey: [...ACTIVITY_VOLUME_REPORT_QUERY_KEY, reportParams],
    queryFn: () => getActivityVolumeReport(reportParams),
    enabled: resolvedStart <= resolvedEnd,
  });

  const headingKey =
    !isAdmin || viewMode === 'my'
      ? 'reports.activityVolume.pageTitleMy'
      : 'reports.activityVolume.pageTitleTeam';

  function handleExportCsv(): void {
    if (!report) return;
    const csv = buildCsv(report.rows, report.totals, t);
    downloadCsv(csv, `activity-report-${resolvedStart}-${resolvedEnd}.csv`);
  }

  async function handleExportPdf(): Promise<void> {
    setIsExportingPdf(true);
    setExportPdfError('');
    try {
      await exportActivityVolumeReportPdf(reportParams);
    } catch {
      setExportPdfError(t('reports.activityVolume.exportPdfError'));
    } finally {
      setIsExportingPdf(false);
    }
  }

  return (
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
          <div className="flex items-center gap-2 shrink-0">
            <ExportMenu
              label={t('common.export')}
              testId="activity-volume-export-menu-button"
              items={[
                {
                  key: 'csv',
                  testId: 'activity-volume-export-csv-button',
                  label: t('reports.activityVolume.exportCsv'),
                  onClick: handleExportCsv,
                },
                {
                  key: 'pdf',
                  testId: 'activity-volume-export-pdf-button',
                  label: isExportingPdf
                    ? t('reports.activityVolume.exporting')
                    : t('reports.activityVolume.exportPdf'),
                  disabled: isExportingPdf,
                  onClick: handleExportPdf,
                },
              ]}
            />
          </div>
        )}
      </div>

      {exportPdfError && (
        <p className="mb-4 text-sm text-red-600" data-testid="export-pdf-error">
          {exportPdfError}
        </p>
      )}

      <ReportFilterBar
        filters={filters}
        i18nPrefix="reports.activityVolume"
        availablePresets={['thisWeek', 'currentMonth', 'currentQuarter', 'custom']}
      />

      {/* Loading state */}
      {isLoading && (
        <p className="text-sm text-gray-500" data-testid="report-loading">
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
          {/* Per-rep breakdown heading — admin Team View only */}
          {isAdmin && viewMode === 'team' && report.rows.length > 0 && (
            <div className="px-6 py-4 border-b border-gray-200" data-testid="rep-breakdown-heading">
              <h2 className="text-base font-semibold text-gray-900">
                {t('reports.activityVolume.repBreakdownHeading')}
              </h2>
            </div>
          )}
          {report.rows.length === 0 ? (
            <p
              className="px-6 py-8 text-sm text-gray-500 text-center"
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
                              to={buildActivitiesUrl(row.ownerId, col, resolvedStart, resolvedEnd)}
                              className="text-primary-600 hover:underline font-medium"
                            >
                              {row.counts[col]}
                            </Link>
                          ) : (
                            <span className="text-gray-500">{row.counts[col]}</span>
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
  );
}
