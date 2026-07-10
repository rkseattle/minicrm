/**
 * SentimentSparkline component. (MINCRM-472)
 * Renders a trend badge (Warming/Stable/Cooling) plus a hand-rolled SVG
 * sparkline of recent sentiment points. Renders nothing when there is
 * insufficient data (fewer than 2 non-flagged scores), per the ticket's
 * per-entity read endpoints already encoding that as has_sufficient_data.
 */

import { useTranslation } from 'react-i18next';
import type {
  SentimentScorePoint,
  SentimentTrendState,
} from '@shared/schemas/sentimentScoreSchema.js';

const TREND_CLASSES: Record<SentimentTrendState, string> = {
  warming: 'bg-emerald-100 text-emerald-800 ring-emerald-600/30',
  stable: 'bg-gray-100 text-gray-600 ring-gray-500/10',
  cooling: 'bg-red-100 text-red-800 ring-red-600/30',
};

const TREND_ARROWS: Record<SentimentTrendState, string> = {
  warming: '↗',
  stable: '→',
  cooling: '↘',
};

const SENTIMENT_Y: Record<SentimentScorePoint['sentiment'], number> = {
  positive: 4,
  neutral: 14,
  negative: 24,
};

const SPARKLINE_HEIGHT = 28;
const SPARKLINE_POINT_SPACING = 16;

function buildPolylinePoints(points: SentimentScorePoint[]): string {
  // points are ordered newest-first; render oldest-to-newest left-to-right.
  const chronological = [...points].reverse();
  return chronological
    .map((point, index) => `${index * SPARKLINE_POINT_SPACING},${SENTIMENT_Y[point.sentiment]}`)
    .join(' ');
}

interface SentimentSparklineProps {
  entityId: string;
  trend: SentimentTrendState | null;
  hasSufficientData: boolean;
  points: SentimentScorePoint[];
}

export default function SentimentSparkline({
  entityId,
  trend,
  hasSufficientData,
  points,
}: SentimentSparklineProps) {
  const { t } = useTranslation();

  if (!hasSufficientData || !trend) return null;

  const width = Math.max(SPARKLINE_POINT_SPACING, (points.length - 1) * SPARKLINE_POINT_SPACING);

  return (
    <span className="inline-flex items-center gap-2" data-testid={`sentiment-trend-${entityId}`}>
      <span
        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset whitespace-nowrap ${TREND_CLASSES[trend]}`}
        data-testid={`sentiment-trend-badge-${entityId}`}
      >
        <span aria-hidden="true">{TREND_ARROWS[trend]}</span>
        {t(`sentiment.trend.${trend}`)}
      </span>
      <svg
        role="img"
        aria-label={t('sentiment.sparklineLabel')}
        width={width}
        height={SPARKLINE_HEIGHT}
        viewBox={`0 0 ${width} ${SPARKLINE_HEIGHT}`}
        data-testid={`sentiment-sparkline-${entityId}`}
        className="shrink-0"
      >
        <polyline
          points={buildPolylinePoints(points)}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          className="text-gray-400"
        />
      </svg>
    </span>
  );
}
