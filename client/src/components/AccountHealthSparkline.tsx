/**
 * AccountHealthSparkline component.
 * Renders a hand-rolled SVG sparkline of the account's 6-month health score
 * trend history. Renders nothing when there are fewer than 2 points — a
 * single point cannot show a trend.
 */

import { useTranslation } from 'react-i18next';
import type { AccountHealthScorePoint } from '@shared/schemas/accountHealthScoreSchema.js';

const SPARKLINE_HEIGHT = 28;
const SPARKLINE_POINT_SPACING = 16;
const SCORE_MAX = 100;

function buildPolylinePoints(points: AccountHealthScorePoint[]): string {
  // points are ordered oldest-first (chronological) already — render left-to-right as-is.
  return points
    .map((point, index) => {
      const y = SPARKLINE_HEIGHT - (point.score / SCORE_MAX) * SPARKLINE_HEIGHT;
      return `${index * SPARKLINE_POINT_SPACING},${y}`;
    })
    .join(' ');
}

interface AccountHealthSparklineProps {
  accountId: string;
  points: AccountHealthScorePoint[];
}

export default function AccountHealthSparkline({ accountId, points }: AccountHealthSparklineProps) {
  const { t } = useTranslation();

  if (points.length < 2) return null;

  const width = Math.max(SPARKLINE_POINT_SPACING, (points.length - 1) * SPARKLINE_POINT_SPACING);

  return (
    <svg
      role="img"
      aria-label={t('relationshipHealth.sparklineLabel')}
      width={width}
      height={SPARKLINE_HEIGHT}
      viewBox={`0 0 ${width} ${SPARKLINE_HEIGHT}`}
      data-testid={`account-health-sparkline-${accountId}`}
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
  );
}
