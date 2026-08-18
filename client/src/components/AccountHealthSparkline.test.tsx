/**
 * Tests for the AccountHealthSparkline component.
 */

import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import AccountHealthSparkline from './AccountHealthSparkline.js';

function renderSparkline(props: Partial<React.ComponentProps<typeof AccountHealthSparkline>> = {}) {
  return render(
    <AccountHealthSparkline
      accountId="a1"
      points={[
        { score: 62, state: 'healthy', computed_at: '2026-05-01T00:00:00.000Z' },
        { score: 70, state: 'healthy', computed_at: '2026-06-01T00:00:00.000Z' },
        { score: 45, state: 'cooling', computed_at: '2026-07-01T00:00:00.000Z' },
      ]}
      {...props}
    />,
  );
}

describe('AccountHealthSparkline', () => {
  it('renders nothing when there are fewer than 2 points', () => {
    const { container } = renderSparkline({ points: [] });
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing for a single point', () => {
    const { container } = renderSparkline({
      points: [{ score: 62, state: 'healthy', computed_at: '2026-05-01T00:00:00.000Z' }],
    });
    expect(container).toBeEmptyDOMElement();
  });

  it('renders an SVG sparkline for 2+ points', () => {
    renderSparkline();
    expect(screen.getByTestId('account-health-sparkline-a1')).toBeInTheDocument();
  });
});
