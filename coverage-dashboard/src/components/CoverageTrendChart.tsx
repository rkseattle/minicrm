/**
 * Two-series (API/frontend) coverage-percent trend line chart.
 *
 * Categorical slots 1 (blue, API) and 2 (orange, frontend) from the
 * validated default palette (dataviz skill, references/palette.md) —
 * assigned in fixed order, never cycled. A legend is always shown (2
 * series), and both series are also direct-labeled at their trailing end
 * per the skill's "identity never color-alone" rule.
 */

import { useId, useState } from 'react';
import type { CoverageSummary } from '@shared/schemas/coverageReportingSchema.js';

const CHART_WIDTH = 640;
const CHART_HEIGHT = 220;
const PADDING = { top: 16, right: 72, bottom: 24, left: 36 };

const SERIES_API_COLOR = '#2a78d6';
const SERIES_FRONTEND_COLOR = '#eb6834';

interface Point {
  x: number;
  y: number;
  commitSha: string;
  value: number;
}

function buildPoints(
  summaries: readonly CoverageSummary[],
  valueOf: (s: CoverageSummary) => number,
): Point[] {
  const plotWidth = CHART_WIDTH - PADDING.left - PADDING.right;
  const plotHeight = CHART_HEIGHT - PADDING.top - PADDING.bottom;
  // Trend data arrives most-recent-first (see coverageBuildSummaryService's
  // own ordering) — reversed here so the chart reads left-to-right in time,
  // the reader's natural expectation for a trend view.
  const chronological = [...summaries].reverse();
  return chronological.map((summary, index) => {
    const x =
      chronological.length <= 1
        ? PADDING.left
        : PADDING.left + (index / (chronological.length - 1)) * plotWidth;
    const y = PADDING.top + plotHeight * (1 - valueOf(summary) / 100);
    return { x, y, commitSha: summary.commitSha, value: valueOf(summary) };
  });
}

function toPath(points: readonly Point[]): string {
  if (points.length === 0) return '';
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ');
}

interface SeriesProps {
  points: Point[];
  color: string;
  gradientId: string;
  onHover: (point: Point | null) => void;
}

function Series({ points, color, gradientId, onHover }: SeriesProps) {
  return (
    <g>
      <defs>
        <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.1" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {points.length > 1 && (
        <path
          d={`${toPath(points)} L${points[points.length - 1].x},${CHART_HEIGHT - PADDING.bottom} L${points[0].x},${CHART_HEIGHT - PADDING.bottom} Z`}
          fill={`url(#${gradientId})`}
        />
      )}
      <path
        d={toPath(points)}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {points.map((point) => (
        <circle
          key={point.commitSha}
          cx={point.x}
          cy={point.y}
          r={4}
          fill={color}
          stroke="#fcfcfb"
          strokeWidth={2}
          onMouseEnter={() => onHover(point)}
          onMouseLeave={() => onHover(null)}
          data-testid="trend-chart-point"
        />
      ))}
    </g>
  );
}

/**
 * Trailing direct-labels for both series, rendered together (not per-Series)
 * so overlapping labels — e.g. API and frontend coverage landing at the same
 * y-position, common when both are exactly equal — can be detected and
 * vertically separated. Rendering each series' label independently (the
 * prior approach) let them draw on top of each other with no way to know
 * the other series' position.
 */
function TrailingLabels({
  apiLastPoint,
  frontendLastPoint,
}: {
  apiLastPoint?: Point;
  frontendLastPoint?: Point;
}) {
  const MIN_LABEL_SEPARATION = 14;
  let apiY = apiLastPoint?.y ?? 0;
  let frontendY = frontendLastPoint?.y ?? 0;

  if (apiLastPoint && frontendLastPoint && Math.abs(apiY - frontendY) < MIN_LABEL_SEPARATION) {
    const midpoint = (apiY + frontendY) / 2;
    apiY = midpoint - MIN_LABEL_SEPARATION / 2;
    frontendY = midpoint + MIN_LABEL_SEPARATION / 2;
  }

  return (
    <>
      {apiLastPoint && (
        <text
          x={apiLastPoint.x + 8}
          y={apiY + 4}
          fontSize={11}
          fill="#52514e"
          className="font-medium"
        >
          API {apiLastPoint.value.toFixed(0)}%
        </text>
      )}
      {frontendLastPoint && (
        <text
          x={frontendLastPoint.x + 8}
          y={frontendY + 4}
          fontSize={11}
          fill="#52514e"
          className="font-medium"
        >
          Frontend {frontendLastPoint.value.toFixed(0)}%
        </text>
      )}
    </>
  );
}

interface CoverageTrendChartProps {
  summaries: CoverageSummary[];
}

export default function CoverageTrendChart({ summaries }: CoverageTrendChartProps) {
  const gradientIdBase = useId();
  const [hovered, setHovered] = useState<{ point: Point; seriesLabel: string } | null>(null);

  if (summaries.length === 0) {
    return (
      <div
        className="flex h-[220px] items-center justify-center text-sm text-gray-500"
        data-testid="trend-chart-empty"
      >
        No trend data yet
      </div>
    );
  }

  const apiPoints = buildPoints(summaries, (s) => s.apiCoveragePercent);
  const frontendPoints = buildPoints(summaries, (s) => s.frontendCoveragePercent);

  return (
    <div className="relative" data-testid="coverage-trend-chart">
      <div className="mb-2 flex gap-4 text-xs text-gray-600">
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ backgroundColor: SERIES_API_COLOR }}
          />
          API coverage
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ backgroundColor: SERIES_FRONTEND_COLOR }}
          />
          Frontend coverage
        </span>
      </div>
      <svg
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        className="w-full"
        role="img"
        aria-label="Coverage trend over recent builds"
      >
        {[0, 25, 50, 75, 100].map((tick) => {
          const y = PADDING.top + (CHART_HEIGHT - PADDING.top - PADDING.bottom) * (1 - tick / 100);
          return (
            <g key={tick}>
              <line
                x1={PADDING.left}
                x2={CHART_WIDTH - PADDING.right}
                y1={y}
                y2={y}
                stroke="#e5e5e3"
                strokeWidth={1}
              />
              <text x={4} y={y + 3} fontSize={10} fill="#8a8a86">
                {tick}%
              </text>
            </g>
          );
        })}
        <Series
          points={apiPoints}
          color={SERIES_API_COLOR}
          gradientId={`${gradientIdBase}-api`}
          onHover={(point) => setHovered(point ? { point, seriesLabel: 'API' } : null)}
        />
        <Series
          points={frontendPoints}
          color={SERIES_FRONTEND_COLOR}
          gradientId={`${gradientIdBase}-frontend`}
          onHover={(point) => setHovered(point ? { point, seriesLabel: 'Frontend' } : null)}
        />
        <TrailingLabels
          apiLastPoint={apiPoints[apiPoints.length - 1]}
          frontendLastPoint={frontendPoints[frontendPoints.length - 1]}
        />
      </svg>
      {hovered && (
        <div
          className="pointer-events-none absolute rounded-md border border-gray-200 bg-white px-2 py-1 text-xs shadow-md"
          style={{ left: hovered.point.x, top: hovered.point.y - 36 }}
          data-testid="trend-chart-tooltip"
        >
          <div className="font-medium">
            {hovered.seriesLabel}: {hovered.point.value.toFixed(1)}%
          </div>
          <div className="text-gray-500">{hovered.point.commitSha.slice(0, 8)}</div>
        </div>
      )}
    </div>
  );
}
