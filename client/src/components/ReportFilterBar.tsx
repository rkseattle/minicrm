/**
 * ReportFilterBar — shared filter bar for date-preset report pages.
 *
 * Renders: view toggle (admin only), date preset selector, custom date range
 * inputs (when preset === 'custom'), owner filter dropdown (admin + team view),
 * and an invalid-range warning.
 *
 * Used by WinLossReportPage and ActivityVolumeReportPage.
 */

import { useTranslation } from 'react-i18next';
import type { ReportFilters, DatePreset } from '@/hooks/useReportFilters.js';

interface ReportFilterBarProps {
  filters: ReportFilters;
  /**
   * i18n key prefix used to look up labels specific to the report page.
   * e.g. 'reports.winLoss' resolves 'reports.winLoss.viewToggleTeamView', etc.
   */
  i18nPrefix: string;
  /**
   * Which preset options to show in the dropdown (order is preserved).
   * Defaults to the common cross-report presets.
   */
  availablePresets?: DatePreset[];
}

const DEFAULT_PRESETS: DatePreset[] = ['currentMonth', 'currentQuarter', 'custom'];

export default function ReportFilterBar({
  filters,
  i18nPrefix,
  availablePresets = DEFAULT_PRESETS,
}: ReportFilterBarProps) {
  const { t } = useTranslation();

  const {
    preset,
    setPreset,
    customStart,
    setCustomStart,
    customEnd,
    setCustomEnd,
    resolvedStart,
    resolvedEnd,
    viewMode,
    setViewMode,
    selectedOwnerId,
    setSelectedOwnerId,
    activeUsers,
    isAdmin,
  } = filters;

  return (
    <>
      {/* My View / Team View toggle — admin only */}
      {isAdmin && (
        <div
          className="mb-4 inline-flex rounded-md border border-gray-300 overflow-hidden"
          data-testid="view-mode-toggle"
        >
          <button
            type="button"
            onClick={() => setViewMode('team')}
            className={`px-4 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-inset focus:ring-primary-500 ${
              viewMode === 'team'
                ? 'bg-primary-600 text-white'
                : 'bg-white text-gray-700 hover:bg-gray-50'
            }`}
            data-testid="view-mode-team"
          >
            {t(`${i18nPrefix}.viewToggleTeamView`)}
          </button>
          <button
            type="button"
            onClick={() => setViewMode('my')}
            className={`px-4 py-2 text-sm font-medium border-s border-gray-300 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-primary-500 ${
              viewMode === 'my'
                ? 'bg-primary-600 text-white'
                : 'bg-white text-gray-700 hover:bg-gray-50'
            }`}
            data-testid="view-mode-my"
          >
            {t(`${i18nPrefix}.viewToggleMyView`)}
          </button>
        </div>
      )}

      {/* Filters row */}
      <div
        className="bg-white rounded-lg border border-gray-200 p-4 mb-6 flex flex-wrap gap-4 items-end"
        data-testid="report-filters"
      >
        {/* Date preset selector */}
        <div className="flex flex-col gap-1">
          <label
            htmlFor="date-preset"
            className="text-xs font-medium text-gray-500 uppercase tracking-wide"
          >
            {t(`${i18nPrefix}.dateRangeLabel`)}
          </label>
          <select
            id="date-preset"
            data-testid="date-preset-select"
            value={preset}
            onChange={(e) => {
              const next = e.target.value as DatePreset;
              if (next !== preset) setPreset(next);
            }}
            className="border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 min-h-[44px] sm:min-h-0"
          >
            {availablePresets.map((p) => (
              <option key={p} value={p}>
                {t(`${i18nPrefix}.preset${p.charAt(0).toUpperCase()}${p.slice(1)}`)}
              </option>
            ))}
          </select>
        </div>

        {/* Custom date range inputs — only when 'custom' selected */}
        {preset === 'custom' && (
          <>
            <div className="flex flex-col gap-1">
              <label
                htmlFor="custom-start"
                className="text-xs font-medium text-gray-500 uppercase tracking-wide"
              >
                {t(`${i18nPrefix}.startDateLabel`)}
              </label>
              <input
                id="custom-start"
                type="date"
                data-testid="custom-start-input"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                className="border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 min-h-[44px] sm:min-h-0"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label
                htmlFor="custom-end"
                className="text-xs font-medium text-gray-500 uppercase tracking-wide"
              >
                {t(`${i18nPrefix}.endDateLabel`)}
              </label>
              <input
                id="custom-end"
                type="date"
                data-testid="custom-end-input"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 min-h-[44px] sm:min-h-0"
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
              {t(`${i18nPrefix}.ownerFilterLabel`)}
            </label>
            <select
              id="owner-filter"
              data-testid="owner-filter-select"
              value={selectedOwnerId}
              onChange={(e) => setSelectedOwnerId(e.target.value)}
              className="border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              <option value="">{t(`${i18nPrefix}.ownerFilterAll`)}</option>
              {activeUsers.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Invalid date range warning */}
      {preset === 'custom' && resolvedStart > resolvedEnd && (
        <p role="alert" className="mb-4 text-sm text-red-600" data-testid="date-range-error">
          {t(`${i18nPrefix}.dateRangeInvalid`)}
        </p>
      )}
    </>
  );
}
