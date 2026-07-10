/**
 * Tests for the SentimentSparkline component. (MINCRM-472)
 */

import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import SentimentSparkline from './SentimentSparkline.js';

function renderSparkline(props: Partial<React.ComponentProps<typeof SentimentSparkline>> = {}) {
  return render(
    <SentimentSparkline
      entityId="c1"
      trend="stable"
      hasSufficientData
      points={[
        {
          activity_id: 'a1',
          sentiment: 'positive',
          flagged_inaccurate: false,
          created_at: '2026-07-01T00:00:00.000Z',
        },
        {
          activity_id: 'a2',
          sentiment: 'neutral',
          flagged_inaccurate: false,
          created_at: '2026-06-30T00:00:00.000Z',
        },
      ]}
      {...props}
    />,
  );
}

describe('SentimentSparkline', () => {
  it('renders nothing when there is insufficient data', () => {
    const { container } = renderSparkline({ hasSufficientData: false });
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing when trend is null', () => {
    const { container } = renderSparkline({ trend: null });
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the warming trend badge', () => {
    renderSparkline({ trend: 'warming' });
    expect(screen.getByTestId('sentiment-trend-badge-c1')).toHaveTextContent('Warming');
  });

  it('renders the cooling trend badge', () => {
    renderSparkline({ trend: 'cooling' });
    expect(screen.getByTestId('sentiment-trend-badge-c1')).toHaveTextContent('Cooling');
  });

  it('renders an SVG sparkline with the trend badge', () => {
    renderSparkline();
    expect(screen.getByTestId('sentiment-sparkline-c1')).toBeInTheDocument();
  });
});
