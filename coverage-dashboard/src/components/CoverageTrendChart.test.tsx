import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import CoverageTrendChart from './CoverageTrendChart.js';
import { MOCK_COVERAGE_SUMMARY } from '@/test/msw/handlers.js';

describe('CoverageTrendChart', () => {
  it('shows an empty state with no summaries', () => {
    render(<CoverageTrendChart summaries={[]} />);
    expect(screen.getByTestId('trend-chart-empty')).toBeInTheDocument();
  });

  it('renders one point per summary', () => {
    render(
      <CoverageTrendChart
        summaries={[MOCK_COVERAGE_SUMMARY, { ...MOCK_COVERAGE_SUMMARY, commitSha: 'def456' }]}
      />,
    );
    expect(screen.getByTestId('coverage-trend-chart')).toBeInTheDocument();
    // 2 summaries x 2 series (API, frontend) = 4 point markers
    expect(screen.getAllByTestId('trend-chart-point')).toHaveLength(4);
  });

  it('renders a single point without a division-by-zero NaN position', () => {
    render(<CoverageTrendChart summaries={[MOCK_COVERAGE_SUMMARY]} />);
    const points = screen.getAllByTestId('trend-chart-point');
    for (const point of points) {
      expect(point.getAttribute('cx')).not.toBe('NaN');
      expect(point.getAttribute('cy')).not.toBe('NaN');
    }
  });

  it('separates the API/frontend trailing labels vertically when both series have the same value', () => {
    // Regression test: with equal API/frontend coverage percentages, both
    // trailing direct-labels land at the same y-position and render on top
    // of each other, illegible (found via manual smoke test).
    render(
      <CoverageTrendChart
        summaries={[
          { ...MOCK_COVERAGE_SUMMARY, apiCoveragePercent: 80, frontendCoveragePercent: 80 },
        ]}
      />,
    );
    const apiLabel = screen.getByText(/API 80%/);
    const frontendLabel = screen.getByText(/Frontend 80%/);
    const apiY = Number(apiLabel.getAttribute('y'));
    const frontendY = Number(frontendLabel.getAttribute('y'));
    expect(Math.abs(apiY - frontendY)).toBeGreaterThanOrEqual(14);
  });
});
