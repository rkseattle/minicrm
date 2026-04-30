/**
 * StageTrendReportPage component.
 * Displays stage entry and conversion rate data over a configurable look-back
 * window (last 30, 60, or 90 days):
 * - Grouped bar chart: "Entered" and "Advanced" per stage per time bucket
 * - Summary table below the chart
 *
 * Chart is drawn on a <canvas> element using the native Canvas 2D API — no
 * third-party charting library required.
 *
 * Localized date labels use Intl.DateTimeFormat with the active i18next locale.
 * Implements MINCRM-284.
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import NavBar from '@/components/NavBar.js';
import {
  getStageTrendReport,
  STAGE_TREND_REPORT_QUERY_KEY,
  type StageTrendDays,
  type StageTrendDataPoint,
} from '@/api/reports.js';

/** Allowed look-back window options */
const DAYS_OPTIONS: StageTrendDays[] = [30, 60, 90];

// ── Chart colours ────────────────────────────────────────────────────────────
const COLOR_ENTERED = 'rgba(99, 102, 241, 0.7)'; // indigo-500 semi-transparent
const COLOR_CONVERTED = 'rgba(34, 197, 94, 0.7)'; // green-500 semi-transparent
const COLOR_ENTERED_BORDER = 'rgb(99, 102, 241)';
const COLOR_CONVERTED_BORDER = 'rgb(34, 197, 94)';

/** Formats a conversion rate (0–1) as a percentage string, or "—" when denominator is 0 */
function formatRate(entered: number, converted: number): string {
  if (entered === 0) return '—';
  return `${Math.round((converted / entered) * 100)}%`;
}

// ── Chart drawing ────────────────────────────────────────────────────────────

interface ChartData {
  /** stages in display order */
  stages: string[];
  /** dataPoints keyed by stage then period */
  byStage: Map<string, Map<string, StageTrendDataPoint>>;
  /** all unique periods in ascending order */
  periods: string[];
}

function buildChartData(dataPoints: StageTrendDataPoint[], stages: string[]): ChartData {
  const periodSet = new Set<string>();
  for (const dp of dataPoints) periodSet.add(dp.period);
  const periods = Array.from(periodSet).sort();

  const byStage = new Map<string, Map<string, StageTrendDataPoint>>();
  for (const stage of stages) byStage.set(stage, new Map());
  for (const dp of dataPoints) {
    byStage.get(dp.stage)?.set(dp.period, dp);
  }

  return { stages, byStage, periods };
}

/**
 * Draws a grouped bar chart onto the given canvas context.
 * Groups are pipeline stages; within each group, two bars: entered + converted.
 */
function drawChart(
  canvas: HTMLCanvasElement,
  chartData: ChartData,
  enteredLabel: string,
  convertedLabel: string,
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const { stages, byStage, periods } = chartData;
  if (stages.length === 0 || periods.length === 0) return;

  const dpr = window.devicePixelRatio || 1;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  canvas.width = width * dpr;
  canvas.height = height * dpr;
  ctx.scale(dpr, dpr);

  const paddingTop = 32;
  const paddingBottom = 60; // room for x labels
  const paddingLeft = 40;
  const paddingRight = 16;
  const legendHeight = 24;

  const chartWidth = width - paddingLeft - paddingRight;
  const chartHeight = height - paddingTop - paddingBottom - legendHeight;

  ctx.clearRect(0, 0, width, height);

  // ── Compute max value for y-axis scale ──────────────────────────────────
  let maxVal = 1;
  for (const stage of stages) {
    const stageMap = byStage.get(stage)!;
    for (const period of periods) {
      const dp = stageMap.get(period);
      if (dp) maxVal = Math.max(maxVal, dp.entered, dp.converted);
    }
  }
  // Round up to a nice number
  const yTicks = 4;
  const rawStep = maxVal / yTicks;
  const step = Math.ceil(rawStep) || 1;
  const yMax = step * yTicks;

  // ── Y-axis gridlines and labels ──────────────────────────────────────────
  ctx.strokeStyle = '#e5e7eb'; // gray-200
  ctx.lineWidth = 1;
  ctx.font = '11px system-ui, sans-serif';
  ctx.fillStyle = '#6b7280'; // gray-500
  ctx.textAlign = 'right';
  for (let i = 0; i <= yTicks; i++) {
    const val = i * step;
    const y = paddingTop + legendHeight + chartHeight - (val / yMax) * chartHeight;
    ctx.beginPath();
    ctx.moveTo(paddingLeft, y);
    ctx.lineTo(paddingLeft + chartWidth, y);
    ctx.stroke();
    ctx.fillText(String(val), paddingLeft - 4, y + 4);
  }

  // ── Bars ──────────────────────────────────────────────────────────────────
  // Layout: one group per stage, spaced evenly. Within each group: one pair of
  // bars per period.
  const groupCount = stages.length;
  const groupWidth = chartWidth / groupCount;
  const innerPadding = groupWidth * 0.1;
  const pairWidth = (groupWidth - innerPadding * 2) / periods.length;
  const barPadding = pairWidth * 0.05;
  const barWidth = Math.max(2, (pairWidth - barPadding) / 2);

  for (let gi = 0; gi < stages.length; gi++) {
    const stage = stages[gi];
    const stageMap = byStage.get(stage)!;
    const groupX = paddingLeft + gi * groupWidth + innerPadding;

    for (let pi = 0; pi < periods.length; pi++) {
      const period = periods[pi];
      const dp = stageMap.get(period);
      const entered = dp?.entered ?? 0;
      const converted = dp?.converted ?? 0;

      const pairX = groupX + pi * pairWidth + barPadding;
      const baseY = paddingTop + legendHeight + chartHeight;

      // Entered bar
      const enteredH = (entered / yMax) * chartHeight;
      ctx.fillStyle = COLOR_ENTERED;
      ctx.fillRect(pairX, baseY - enteredH, barWidth, enteredH);
      ctx.strokeStyle = COLOR_ENTERED_BORDER;
      ctx.lineWidth = 1;
      ctx.strokeRect(pairX, baseY - enteredH, barWidth, enteredH);

      // Converted bar
      const convertedH = (converted / yMax) * chartHeight;
      ctx.fillStyle = COLOR_CONVERTED;
      ctx.fillRect(pairX + barWidth, baseY - convertedH, barWidth, convertedH);
      ctx.strokeStyle = COLOR_CONVERTED_BORDER;
      ctx.strokeRect(pairX + barWidth, baseY - convertedH, barWidth, convertedH);
    }

    // ── Stage label (x-axis, below group) ────────────────────────────────
    const labelX = paddingLeft + gi * groupWidth + groupWidth / 2;
    const labelY = paddingTop + legendHeight + chartHeight + 16;
    ctx.fillStyle = '#374151'; // gray-700
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    // Truncate long stage names
    const maxLabelWidth = groupWidth - 8;
    let label = stage;
    while (ctx.measureText(label).width > maxLabelWidth && label.length > 4) {
      label = label.slice(0, -1);
    }
    if (label !== stage) label = label.slice(0, -1) + '…';
    ctx.fillText(label, labelX, labelY);
  }

  // ── Legend ────────────────────────────────────────────────────────────────
  const legendY = paddingTop + 8;
  const swatchSize = 10;
  const legendGap = 80;
  const legendStartX = paddingLeft;

  ctx.fillStyle = COLOR_ENTERED;
  ctx.fillRect(legendStartX, legendY, swatchSize, swatchSize);
  ctx.fillStyle = '#374151';
  ctx.font = '11px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(enteredLabel, legendStartX + swatchSize + 4, legendY + 9);

  ctx.fillStyle = COLOR_CONVERTED;
  ctx.fillRect(legendStartX + legendGap, legendY, swatchSize, swatchSize);
  ctx.fillStyle = '#374151';
  ctx.fillText(convertedLabel, legendStartX + legendGap + swatchSize + 4, legendY + 9);
}

// ── Page component ───────────────────────────────────────────────────────────

/**
 * Stage trend report page.
 * Implements MINCRM-284.
 */
export default function StageTrendReportPage() {
  const { t } = useTranslation();
  const [days, setDays] = useState<StageTrendDays>(30);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const {
    data: report,
    isLoading,
    isError,
  } = useQuery({
    queryKey: [...STAGE_TREND_REPORT_QUERY_KEY, days],
    queryFn: () => getStageTrendReport({ days }),
  });

  const redrawChart = useCallback(() => {
    if (!canvasRef.current || !report || report.dataPoints.length === 0) return;
    const chartData = buildChartData(report.dataPoints, report.stages);
    drawChart(
      canvasRef.current,
      chartData,
      t('reports.stageTrend.chartEnteredLabel'),
      t('reports.stageTrend.chartConvertedLabel'),
    );
  }, [report, t]);

  // Redraw whenever data or locale changes
  useEffect(() => {
    redrawChart();
  }, [redrawChart]);

  // Redraw on resize
  useEffect(() => {
    const observer = new ResizeObserver(() => redrawChart());
    if (canvasRef.current) observer.observe(canvasRef.current);
    return () => observer.disconnect();
  }, [redrawChart]);

  // ── Build table data ──────────────────────────────────────────────────────
  // Group data points by stage for the summary table.
  const tableData = report
    ? report.stages.map((stage) => {
        const points = report.dataPoints.filter((dp) => dp.stage === stage);
        const totalEntered = points.reduce((sum, dp) => sum + dp.entered, 0);
        const totalConverted = points.reduce((sum, dp) => sum + dp.converted, 0);
        return { stage, totalEntered, totalConverted };
      })
    : [];

  return (
    <div className="min-h-screen bg-gray-50">
      <NavBar />
      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
        {/* Page header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900" data-testid="stage-trend-report-heading">
            {t('reports.stageTrend.pageTitle')}
          </h1>
          <p className="text-sm text-gray-500 mt-1">{t('reports.stageTrend.subtitle')}</p>
        </div>

        {/* Date range filter */}
        <div
          className="bg-white rounded-lg border border-gray-200 p-4 mb-6 flex flex-wrap gap-4 items-end"
          data-testid="report-filters"
        >
          <div className="flex flex-col gap-1">
            <label
              htmlFor="days-select"
              className="text-xs font-medium text-gray-500 uppercase tracking-wide"
            >
              {t('reports.stageTrend.dateRangeLabel')}
            </label>
            <select
              id="days-select"
              data-testid="days-select"
              value={days}
              onChange={(e) => setDays(parseInt(e.target.value, 10) as StageTrendDays)}
              className="border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 min-h-[44px] sm:min-h-0"
            >
              {DAYS_OPTIONS.map((d) => (
                <option key={d} value={d}>
                  {t(`reports.stageTrend.preset${d}`)}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Loading state */}
        {isLoading && (
          <p className="text-sm text-gray-400" data-testid="report-loading">
            {t('reports.stageTrend.loading')}
          </p>
        )}

        {/* Error state */}
        {isError && (
          <p role="alert" className="text-sm text-red-600" data-testid="report-error">
            {t('reports.stageTrend.errorLoad')}
          </p>
        )}

        {/* Results */}
        {report && (
          <>
            {report.dataPoints.length === 0 ? (
              <p
                className="text-sm text-gray-400 text-center py-12"
                data-testid="stage-trend-empty"
              >
                {t('reports.stageTrend.empty')}
              </p>
            ) : (
              <>
                {/* Bar chart */}
                <div
                  className="bg-white rounded-lg border border-gray-200 p-4 mb-6"
                  data-testid="stage-trend-chart-container"
                >
                  <canvas
                    ref={canvasRef}
                    data-testid="stage-trend-chart"
                    className="w-full"
                    style={{ height: '320px' }}
                    aria-label={t('reports.stageTrend.pageTitle')}
                    role="img"
                  />
                </div>

                {/* Summary table */}
                <div
                  className="bg-white rounded-lg border border-gray-200"
                  data-testid="stage-trend-table-container"
                >
                  <div className="px-6 py-4 border-b border-gray-200">
                    <h2 className="text-base font-semibold text-gray-900">
                      {t('reports.stageTrend.tableHeading')}
                    </h2>
                  </div>
                  <div className="overflow-x-auto">
                    <table
                      className="min-w-full divide-y divide-gray-100"
                      data-testid="stage-trend-table"
                    >
                      <thead className="bg-gray-50">
                        <tr>
                          <th
                            scope="col"
                            className="px-6 py-3 text-start text-xs font-medium text-gray-500 uppercase tracking-wider"
                          >
                            {t('reports.stageTrend.columnStage')}
                          </th>
                          <th
                            scope="col"
                            className="px-6 py-3 text-end text-xs font-medium text-gray-500 uppercase tracking-wider"
                          >
                            {t('reports.stageTrend.columnEntered')}
                          </th>
                          <th
                            scope="col"
                            className="px-6 py-3 text-end text-xs font-medium text-gray-500 uppercase tracking-wider"
                          >
                            {t('reports.stageTrend.columnConverted')}
                          </th>
                          <th
                            scope="col"
                            className="px-6 py-3 text-end text-xs font-medium text-gray-500 uppercase tracking-wider"
                          >
                            {t('reports.stageTrend.columnRate')}
                          </th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-100">
                        {tableData.map(({ stage, totalEntered, totalConverted }) => (
                          <tr
                            key={stage}
                            data-testid={`stage-trend-row-${stage.toLowerCase().replace(/\s+/g, '-')}`}
                          >
                            <td className="px-6 py-4 text-sm font-medium text-gray-900">{stage}</td>
                            <td
                              className="px-6 py-4 text-sm text-end text-gray-900"
                              data-testid={`stage-trend-entered-${stage.toLowerCase().replace(/\s+/g, '-')}`}
                            >
                              {totalEntered}
                            </td>
                            <td
                              className="px-6 py-4 text-sm text-end text-gray-900"
                              data-testid={`stage-trend-converted-${stage.toLowerCase().replace(/\s+/g, '-')}`}
                            >
                              {totalConverted}
                            </td>
                            <td
                              className="px-6 py-4 text-sm text-end text-gray-900"
                              data-testid={`stage-trend-rate-${stage.toLowerCase().replace(/\s+/g, '-')}`}
                            >
                              {formatRate(totalEntered, totalConverted)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}
          </>
        )}
      </main>
    </div>
  );
}
